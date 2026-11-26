package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/middleware"
	"campus-forum/internal/mlclient"
)

// The AI chat answers questions about a course: a question naming it by code
// or full name (or a follow-up of one) sends the course's facts and published
// reviews to the model, and the answer carries a link to the course.
// Real database, skipped without TEST_DATABASE_URL.

func TestChatQuestionsAboutCourses(t *testing.T) {
	e := newReviewsEnv(t)
	authMw := middleware.Auth(e.secret)
	mux := e.srv.Config.Handler.(*http.ServeMux)
	mux.Handle("POST /api/chat/ask", authMw(http.HandlerFunc(e.h.ChatAsk)))
	mux.Handle("GET /api/chat/conversations/{id}/messages", authMw(http.HandlerFunc(e.h.GetChatConversationMessages)))

	var mu sync.Mutex
	var last struct {
		Courses []mlclient.CourseFacts `json:"courses"`
	}
	ml := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/generate-answer" {
			e.fakeML().ServeHTTP(w, r)
			return
		}
		mu.Lock()
		last.Courses = nil
		_ = json.NewDecoder(r.Body).Decode(&last)
		mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"request_id": "rid", "status": "answered", "answer": "Students say it is hard.",
			"forum_answer": nil, "ai_explanation": "Students say it is hard.", "language": "en", "basis": "general",
			"reason": nil, "source": nil, "source_type": nil, "retrieval_score": nil})
	}))
	t.Cleanup(ml.Close)
	e.h.ML = mlclient.New(ml.URL, 5*time.Second)

	admin := e.user("admin")
	if code, out := e.call(admin, http.MethodPost, "/api/admin/curricula", map[string]any{"text": sampleCurriculum(t)}); code != http.StatusCreated {
		t.Fatalf("import: %d %v", code, out)
	}
	ctx := context.Background()
	old, _ := e.pg.ListCourseReviews(ctx, "MAT 101", 0, true, "")
	for _, r := range old {
		_ = e.pg.DeleteMyCourseReview(ctx, "MAT 101", r.UserID)
	}
	reviewer := e.user("user")
	code, rev := e.call(reviewer, http.MethodPut, "/api/courses/MAT-101/review", goodReview("Hard but fair; the weekly problem sets help a lot."))
	if code != http.StatusOK {
		t.Fatalf("review: %d %v", code, rev)
	}
	e.waitReview(num(rev["id"]), "ok")

	student := e.user("user")
	ask := func(q string, conv any) map[string]any {
		t.Helper()
		body := map[string]any{"question": q}
		if conv != nil {
			body["conversation_id"] = conv
		}
		code, out := e.call(student, http.MethodPost, "/api/chat/ask", body)
		if code != http.StatusOK {
			t.Fatalf("ask %q: %d %v", q, code, out)
		}
		return out
	}
	sent := func() []mlclient.CourseFacts {
		mu.Lock()
		defer mu.Unlock()
		return last.Courses
	}

	out := ask("Is mat101 hard?", nil)
	c := sent()
	if len(c) != 1 || c[0].Code != "MAT 101" || c[0].Name != "Mathematical analysis 1" || c[0].ECTS != 5 {
		t.Fatalf("course sent to the AI: %+v", c)
	}
	if c[0].ReviewCount != 1 || len(c[0].Reviews) != 1 || !strings.Contains(c[0].Reviews[0].Text, "problem sets") ||
		c[0].Averages["difficulty"] != 4 || c[0].RecommendPct == nil || *c[0].RecommendPct != 100 {
		t.Fatalf("reviews sent to the AI: %+v", c[0])
	}
	if len(c[0].TaughtIn) == 0 || !strings.Contains(c[0].TaughtIn[0], "semester 1, required") {
		t.Fatalf("where it is taught: %v", c[0].TaughtIn)
	}
	links := list(out["courses"])
	if len(links) != 1 || links[0]["code"] != "MAT 101" || links[0]["name"] != "Mathematical analysis 1" {
		t.Fatalf("links in the answer: %v", out["courses"])
	}

	// A follow-up keeps the course; saved with the answer.
	conv := out["conversation"].(map[string]any)["id"]
	ask("And how heavy is the workload?", conv)
	if c := sent(); len(c) != 1 || c[0].Code != "MAT 101" {
		t.Fatalf("follow-up: %+v", c)
	}
	code, msgs := e.call(student, http.MethodGet, "/api/chat/conversations/"+jsonNum(conv)+"/messages", nil)
	if code != http.StatusOK {
		t.Fatalf("messages: %d %v", code, msgs)
	}
	saved := list(msgs["messages"])
	if len(saved) != 4 || len(list(saved[3]["courses"])) != 1 || saved[0]["courses"] != nil {
		t.Fatalf("saved messages: %v", saved)
	}

	// By the full name (not "Mathematical analysis 1" inside "... 10"), two at once; unknown codes and other questions: none.
	// Another course with the same name that no program teaches loses to the one in the plan.
	conn, err := pgx.Connect(ctx, e.dsn)
	if err != nil {
		t.Fatal(err)
	}
	_, err = conn.Exec(ctx, `INSERT INTO courses (code, name) VALUES ('AAA 141', 'Mathematical analysis 2') ON CONFLICT DO NOTHING`)
	conn.Close(ctx)
	if err != nil {
		t.Fatal(err)
	}
	ask("Compare mathematical analysis 2 and MAT 203", nil)
	if c := sent(); len(c) != 2 || c[0].Code != "MAT 203" || c[1].Code != "MAT 141" {
		t.Fatalf("two courses: %+v", c)
	}
	for _, q := range []string{"Where is the library?", "Is ZZZ 999 hard?", "Mathematical analysis 10 exam?"} {
		if out := ask(q, nil); len(sent()) != 0 || out["courses"] != nil {
			t.Fatalf("%q: sent %+v, links %v", q, sent(), out["courses"])
		}
	}
}

func jsonNum(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
