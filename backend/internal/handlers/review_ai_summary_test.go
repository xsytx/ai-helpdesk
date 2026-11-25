package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/middleware"
	"campus-forum/internal/mlclient"
)

// AI summary of a course's reviews: needs 3 published reviews, made once per
// course and language and again only when the reviews change, never from a
// held review. Real database, skipped without TEST_DATABASE_URL.

func TestReviewAISummary(t *testing.T) {
	e := newReviewsEnv(t)
	authMw := middleware.Auth(e.secret)
	mux := e.srv.Config.Handler.(*http.ServeMux)
	mux.Handle("GET /api/courses/{code}/reviews/ai-summary", authMw(http.HandlerFunc(e.h.ReviewAISummary)))

	var calls int32
	var last mlclient.SummaryRequest
	failing := atomic.Bool{}
	ml := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/summarize-reviews" {
			e.fakeML().ServeHTTP(w, r)
			return
		}
		atomic.AddInt32(&calls, 1)
		if failing.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&last)
		writeJSON(w, http.StatusOK, map[string]any{"request_id": "x", "summary": "Hard but useful, students say.",
			"liked": []string{"problem sets"}, "warnings": []string{"start early"}})
	}))
	t.Cleanup(ml.Close)
	e.h.ML = mlclient.New(ml.URL, 5*time.Second)

	admin := e.user("admin")
	if code, out := e.call(admin, http.MethodPost, "/api/admin/curricula", map[string]any{"text": sampleCurriculum(t)}); code != http.StatusCreated {
		t.Fatalf("import: %d %v", code, out)
	}
	ctx := context.Background()
	old, _ := e.pg.ListCourseReviews(ctx, "MAT 106", 0, true, "")
	for _, r := range old {
		_ = e.pg.DeleteMyCourseReview(ctx, "MAT 106", r.UserID)
	}
	conn, err := pgx.Connect(ctx, e.dsn)
	if err != nil {
		t.Fatal(err)
	}
	_, err = conn.Exec(ctx, `DELETE FROM course_review_summaries WHERE course_code = 'MAT 106'`)
	conn.Close(ctx)
	if err != nil {
		t.Fatal(err)
	}

	summary := func(lang string) map[string]any {
		t.Helper()
		code, out := e.call(admin, http.MethodGet, "/api/courses/MAT-106/reviews/ai-summary?lang="+lang, nil)
		if code != http.StatusOK {
			t.Fatalf("summary: %d %v", code, out)
		}
		return out
	}
	write := func(text string) int64 {
		t.Helper()
		u := e.user("user")
		code, rev := e.call(u, http.MethodPut, "/api/courses/MAT-106/review", goodReview(text))
		if code != http.StatusOK {
			t.Fatalf("save review: %d %v", code, rev)
		}
		return num(rev["id"])
	}

	if out := summary("en"); out["status"] != "too_few" || num(out["review_count"]) != 0 || num(out["min"]) != 3 {
		t.Fatalf("no reviews: %v", out)
	}
	for _, text := range []string{"Hard but fair; the weekly problem sets help a lot.", "Lots of homework, start the problem sets early."} {
		e.waitReview(write(text), "ok")
	}
	// A held review doesn't count and never reaches the AI.
	held := write("MAYBE this course is fine, the lectures are clear enough.")
	e.waitReview(held, "held")
	if out := summary("en"); out["status"] != "too_few" || num(out["review_count"]) != 2 {
		t.Fatalf("two published + one held: %v", out)
	}
	if calls != 0 {
		t.Fatalf("the AI was asked with too few reviews")
	}

	e.waitReview(write("Useful for later courses, the exams are fair."), "ok")
	out := summary("kz")
	s, _ := out["summary"].(map[string]any)
	if out["status"] != "ready" || s["summary"] != "Hard but useful, students say." || num(s["review_count"]) != 3 || calls != 1 {
		t.Fatalf("first summary: %v (calls %d)", out, calls)
	}
	if last.Language != "kk" || len(last.Reviews) != 3 || !strings.HasPrefix(last.Course, "MAT 106") || last.Averages["difficulty"] != 4 {
		t.Fatalf("sent to the AI: %+v", last)
	}
	for _, r := range last.Reviews {
		if strings.Contains(r.Text, "MAYBE") {
			t.Fatalf("a held review was sent to the AI: %+v", last.Reviews)
		}
	}
	if _, leaked := s["fingerprint"]; leaked {
		t.Fatalf("fingerprint sent to the browser: %v", s)
	}

	// Saved: the same language again doesn't ask the AI; another language does.
	summary("kz")
	if calls != 1 {
		t.Fatalf("cached summary asked the AI again: %d", calls)
	}
	summary("ru")
	if calls != 2 || last.Language != "ru" {
		t.Fatalf("russian summary: calls %d, %+v", calls, last)
	}

	// A new published review: made again on the next view.
	e.waitReview(write("Clear lectures and a fair final exam overall."), "ok")
	if out := summary("kz"); num(out["summary"].(map[string]any)["review_count"]) != 4 || calls != 3 {
		t.Fatalf("after a new review: %v (calls %d)", out, calls)
	}

	// The AI is down: no summary, no error page.
	e.waitReview(write("Another fair review of the course for the test."), "ok")
	failing.Store(true)
	if out := summary("kz"); out["status"] != "unavailable" {
		t.Fatalf("AI down: %v", out)
	}
	if code, _ := e.call(admin, http.MethodGet, "/api/courses/MAT-106/reviews/ai-summary?lang=de", nil); code != http.StatusBadRequest {
		t.Fatalf("unknown language: %d", code)
	}
}
