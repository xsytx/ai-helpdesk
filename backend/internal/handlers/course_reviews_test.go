package handlers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"campus-forum/internal/middleware"
)

// Course reviews (stories 17-18). Real database and the fake ML of
// moderation_queue_test.go ("BADWORD" = blocked at once, "MAYBE" = held by the
// background check). Skipped without TEST_DATABASE_URL.

func newReviewsEnv(t *testing.T) *modEnv {
	t.Helper()
	e := newModEnv(t)
	authMw := middleware.Auth(e.secret)
	mux := http.NewServeMux()
	mux.Handle("POST /api/admin/curricula", authMw(http.HandlerFunc(e.h.ImportCurriculum)))
	mux.Handle("GET /api/courses/{code}/reviews", authMw(http.HandlerFunc(e.h.ListCourseReviews)))
	mux.Handle("PUT /api/courses/{code}/review", authMw(http.HandlerFunc(e.h.SaveCourseReview)))
	mux.Handle("DELETE /api/courses/{code}/review", authMw(http.HandlerFunc(e.h.DeleteCourseReview)))
	mux.Handle("PUT /api/reviews/{id}/helpful", authMw(http.HandlerFunc(e.h.SetReviewHelpful)))
	mux.Handle("POST /api/reviews/{id}/report", authMw(http.HandlerFunc(e.h.ReportReview)))
	mux.Handle("GET /api/admin/reviews", authMw(http.HandlerFunc(e.h.ListReviewsForAdmin)))
	mux.Handle("POST /api/admin/reviews/{id}/{action}", authMw(http.HandlerFunc(e.h.DecideReview)))
	e.srv.Close()
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

func goodReview(text string) map[string]any {
	return map[string]any{"difficulty": 4, "workload": 3, "usefulness": 5, "recommend": true, "text": text, "taken_year": time.Now().Year() - 1, "taken_term": "fall"}
}

// reviewsSeenBy returns the reviews of a course as u sees them, and the summary.
func (e *modEnv) reviewsSeenBy(u modUser, code string) ([]map[string]any, map[string]any) {
	e.t.Helper()
	status, out := e.call(u, http.MethodGet, "/api/courses/"+code+"/reviews", nil)
	if status != http.StatusOK {
		e.t.Fatalf("list reviews: %d %v", status, out)
	}
	return list(out["reviews"]), out["summary"].(map[string]any)
}

// waitReview waits until review id has the moderation status want.
func (e *modEnv) waitReview(id int64, want string) {
	e.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		r, err := e.pg.GetCourseReview(context.Background(), id, 0)
		if err == nil && r.Status == want {
			return
		}
		if time.Now().After(deadline) {
			e.t.Fatalf("review %d: status %q (err %v), want %q", id, r.Status, err, want)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func findReview(list []map[string]any, id int64) map[string]any {
	for _, r := range list {
		if num(r["id"]) == id {
			return r
		}
	}
	return nil
}

func TestCourseReviews(t *testing.T) {
	e := newReviewsEnv(t)
	a, b, admin := e.user("user"), e.user("user"), e.user("admin")
	if code, out := e.call(admin, http.MethodPost, "/api/admin/curricula", map[string]any{"text": sampleCurriculum(t)}); code != http.StatusCreated {
		t.Fatalf("import: %d %v", code, out)
	}
	// Earlier runs of this test (the test database is kept) may have left reviews of MAT 101: start clean.
	old, err := e.pg.ListCourseReviews(context.Background(), "MAT 101", 0, true, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range old {
		if err := e.pg.DeleteMyCourseReview(context.Background(), "MAT 101", r.UserID); err != nil {
			t.Fatal(err)
		}
	}

	// Checks of the input; an unknown course.
	for _, bad := range []map[string]any{
		{"difficulty": 0, "workload": 3, "usefulness": 3, "recommend": true, "text": "A clear and fair course overall.", "taken_year": time.Now().Year(), "taken_term": "fall"},
		{"difficulty": 3, "workload": 6, "usefulness": 3, "recommend": true, "text": "A clear and fair course overall.", "taken_year": time.Now().Year(), "taken_term": "fall"},
		{"difficulty": 3, "workload": 3, "usefulness": 3, "recommend": true, "text": "too short", "taken_year": time.Now().Year(), "taken_term": "fall"},
		{"difficulty": 3, "workload": 3, "usefulness": 3, "recommend": true, "text": "A clear and fair course overall.", "taken_year": time.Now().Year() + 1, "taken_term": "fall"},
		{"difficulty": 3, "workload": 3, "usefulness": 3, "recommend": true, "text": "A clear and fair course overall.", "taken_year": time.Now().Year(), "taken_term": "winter"},
	} {
		if code, _ := e.call(a, http.MethodPut, "/api/courses/MAT-101/review", bad); code != http.StatusBadRequest {
			t.Fatalf("bad review %v: %d, want 400", bad, code)
		}
	}
	if code, _ := e.call(a, http.MethodPut, "/api/courses/ZZZ-999/review", goodReview("A clear and fair course overall.")); code != http.StatusNotFound {
		t.Fatalf("unknown course: %d", code)
	}

	// The instant filter refuses abuse before saving.
	if code, out := e.call(a, http.MethodPut, "/api/courses/MAT-101/review", goodReview("This course is BADWORD and so is everyone.")); code != http.StatusUnprocessableEntity || out["code"] != "breaks_rules" {
		t.Fatalf("abusive review: %d %v", code, out)
	}
	if list, _ := e.reviewsSeenBy(b, "MAT-101"); len(list) != 0 {
		t.Fatalf("a refused review was saved: %v", list)
	}

	// A clean review: shown at once (checking), then ok. Anonymous for students.
	code, rev := e.call(a, http.MethodPut, "/api/courses/MAT-101/review", goodReview("Hard but fair; the weekly problem sets help a lot."))
	if code != http.StatusOK || rev["status"] != "checking" || rev["mine"] != true {
		t.Fatalf("save: %d %v", code, rev)
	}
	id := num(rev["id"])
	e.waitReview(id, "ok")
	seen, summary := e.reviewsSeenBy(b, "MAT-101")
	r := findReview(seen, id)
	if r == nil || r["mine"] != false || r["text"] != "Hard but fair; the weekly problem sets help a lot." {
		t.Fatalf("another student's view: %v", seen)
	}
	for _, key := range []string{"author_id", "author_name", "moderation_reason", "open_reports", "report_reasons", "user_id"} {
		if _, leaked := r[key]; leaked {
			t.Fatalf("students see %q of a review: %v", key, r)
		}
	}
	if num(summary["count"]) != 1 || summary["difficulty"] != 4.0 || num(summary["recommend_pct"]) != 100 {
		t.Fatalf("summary: %v", summary)
	}
	staffView, _ := e.reviewsSeenBy(admin, "MAT-101")
	if s := findReview(staffView, id); s == nil || s["author_name"] == "" || num(s["author_id"]) == 0 {
		t.Fatalf("staff should see the author: %v", s)
	}

	// One review per student: saving again replaces it.
	if code, again := e.call(a, http.MethodPut, "/api/courses/MAT-101/review", goodReview("Edited: hard but fair, do every problem set.")); code != http.StatusOK || num(again["id"]) != id || again["edited_at"] == nil {
		t.Fatalf("edit: %d %v", code, again)
	}
	e.waitReview(id, "ok")
	if list, _ := e.reviewsSeenBy(b, "MAT-101"); len(list) != 1 {
		t.Fatalf("still one review: %v", list)
	}

	// Helpful: not your own; on, off.
	path := fmt.Sprintf("/api/reviews/%d/helpful", id)
	if code, _ := e.call(a, http.MethodPut, path, map[string]any{"helpful": true}); code != http.StatusForbidden {
		t.Fatalf("own review helpful: %d", code)
	}
	if code, out := e.call(b, http.MethodPut, path, map[string]any{"helpful": true}); code != http.StatusOK || num(out["helpful"]) != 1 {
		t.Fatalf("helpful: %d %v", code, out)
	}
	if seen, _ := e.reviewsSeenBy(b, "MAT-101"); findReview(seen, id)["helped_by_me"] != true {
		t.Fatal("helped_by_me not set")
	}
	if code, out := e.call(b, http.MethodPut, path, map[string]any{"helpful": false}); code != http.StatusOK || num(out["helpful"]) != 0 {
		t.Fatalf("not helpful: %d %v", code, out)
	}

	// Reports: once per student, not your own; the admin keeps the review.
	report := fmt.Sprintf("/api/reviews/%d/report", id)
	if code, _ := e.call(a, http.MethodPost, report, map[string]any{"reason": "mine"}); code != http.StatusForbidden {
		t.Fatalf("report own: %d", code)
	}
	if code, _ := e.call(b, http.MethodPost, report, map[string]any{"reason": "names a teacher"}); code != http.StatusNoContent {
		t.Fatalf("report: %d", code)
	}
	if code, _ := e.call(b, http.MethodPost, report, map[string]any{"reason": "again"}); code != http.StatusConflict {
		t.Fatalf("report twice: %d", code)
	}
	if code, _ := e.call(b, http.MethodGet, "/api/admin/reviews", nil); code != http.StatusForbidden {
		t.Fatalf("a student lists reviews to check: %d", code)
	}
	_, queue := e.call(admin, http.MethodGet, "/api/admin/reviews", nil)
	if q := findReview(list(queue["reviews"]), id); q == nil || num(q["open_reports"]) != 1 || q["author_name"] == "" {
		t.Fatalf("reported review in the admin list: %v", q)
	}
	if code, _ := e.call(b, http.MethodPost, fmt.Sprintf("/api/admin/reviews/%d/keep", id), nil); code != http.StatusForbidden {
		t.Fatalf("a student decides: %d", code)
	}
	// The admin decides on the text they read: a stale text is refused.
	if code, out := e.call(admin, http.MethodPost, fmt.Sprintf("/api/admin/reviews/%d/keep", id), map[string]any{"text": "an older text"}); code != http.StatusConflict || out["code"] != "changed" {
		t.Fatalf("keep with a stale text: %d %v", code, out)
	}
	if code, out := e.call(admin, http.MethodPost, fmt.Sprintf("/api/admin/reviews/%d/keep", id), map[string]any{"text": "Edited: hard but fair, do every problem set."}); code != http.StatusOK || out["status"] != "ok" {
		t.Fatalf("keep: %d %v", code, out)
	}
	if _, queue := e.call(admin, http.MethodGet, "/api/admin/reviews", nil); findReview(list(queue["reviews"]), id) != nil {
		t.Fatal("a kept review stays in the admin list")
	}

	// A doubtful review is held: hidden from others, shown to its author and staff; an admin publishes it.
	code, held := e.call(b, http.MethodPut, "/api/courses/MAT-101/review", goodReview("MAYBE this course is not for everyone."))
	if code != http.StatusOK {
		t.Fatalf("save: %d %v", code, held)
	}
	heldID := num(held["id"])
	e.waitReview(heldID, "held")
	if seen, _ := e.reviewsSeenBy(a, "MAT-101"); findReview(seen, heldID) != nil {
		t.Fatal("a held review is shown to other students")
	}
	if seen, _ := e.reviewsSeenBy(b, "MAT-101"); findReview(seen, heldID)["status"] != "held" {
		t.Fatal("the author should see their held review")
	}
	if code, _ := e.call(a, http.MethodPut, fmt.Sprintf("/api/reviews/%d/helpful", heldID), map[string]any{"helpful": true}); code != http.StatusNotFound {
		t.Fatalf("helpful on a hidden review: %d", code)
	}
	if _, s := e.reviewsSeenBy(a, "MAT-101"); num(s["count"]) != 1 {
		t.Fatalf("a held review is counted: %v", s)
	}
	_, queue = e.call(admin, http.MethodGet, "/api/admin/reviews", nil)
	if q := findReview(list(queue["reviews"]), heldID); q == nil || q["moderation_reason"] != "uncertain" {
		t.Fatalf("held review in the admin list: %v", q)
	}
	// The author edits while the admin reads the old text: publishing the old text is refused.
	if code, _ := e.call(b, http.MethodPut, "/api/courses/MAT-101/review", goodReview("MAYBE this course is not for everyone, really.")); code != http.StatusOK {
		t.Fatalf("edit while held: %d", code)
	}
	if code, out := e.call(admin, http.MethodPost, fmt.Sprintf("/api/admin/reviews/%d/publish", heldID), map[string]any{"text": "MAYBE this course is not for everyone."}); code != http.StatusConflict {
		t.Fatalf("publish a version the admin didn't read: %d %v", code, out)
	}
	e.waitReview(heldID, "held")
	if code, _ := e.call(admin, http.MethodPost, fmt.Sprintf("/api/admin/reviews/%d/publish", heldID), map[string]any{"text": "MAYBE this course is not for everyone, really."}); code != http.StatusOK {
		t.Fatalf("publish: %d", code)
	}
	if seen, s := e.reviewsSeenBy(a, "MAT-101"); findReview(seen, heldID) == nil || num(s["count"]) != 2 {
		t.Fatalf("published review: %v %v", seen, s)
	}

	// Reject hides it for good.
	if code, _ := e.call(admin, http.MethodPost, fmt.Sprintf("/api/admin/reviews/%d/reject", heldID), nil); code != http.StatusOK {
		t.Fatalf("reject: %d", code)
	}
	if seen, _ := e.reviewsSeenBy(a, "MAT-101"); findReview(seen, heldID) != nil {
		t.Fatal("a rejected review is shown")
	}
	// Saving a rejected review again (even unchanged) doesn't make it public: an admin decides again.
	if code, again := e.call(b, http.MethodPut, "/api/courses/MAT-101/review", goodReview("MAYBE this course is not for everyone, really.")); code != http.StatusOK || again["status"] != "held" {
		t.Fatalf("re-saving a rejected review: %d %v", code, again)
	}
	if seen, _ := e.reviewsSeenBy(a, "MAT-101"); findReview(seen, heldID) != nil {
		t.Fatal("a re-saved rejected review is shown")
	}
	// A banned student can't mark reviews helpful or report them.
	if err := e.pg.RestrictUser(context.Background(), b.id, "ban", nil, "test"); err != nil {
		t.Fatal(err)
	}
	if code, _ := e.call(b, http.MethodPut, fmt.Sprintf("/api/reviews/%d/helpful", id), map[string]any{"helpful": true}); code != http.StatusForbidden {
		t.Fatalf("banned helpful: %d", code)
	}
	if code, _ := e.call(b, http.MethodPost, fmt.Sprintf("/api/reviews/%d/report", id), map[string]any{"reason": "x"}); code != http.StatusForbidden {
		t.Fatalf("banned report: %d", code)
	}
	if code, _ := e.call(admin, http.MethodPost, fmt.Sprintf("/api/admin/reviews/%d/destroy", heldID), nil); code != http.StatusBadRequest {
		t.Fatalf("unknown action: %d", code)
	}

	// Sorting by helpful; deleting your own.
	if code, _ := e.call(a, http.MethodGet, "/api/courses/MAT-101/reviews?sort=best", nil); code != http.StatusBadRequest {
		t.Fatalf("bad sort: %d", code)
	}
	if code, _ := e.call(a, http.MethodDelete, "/api/courses/MAT-101/review", nil); code != http.StatusNoContent {
		t.Fatalf("delete: %d", code)
	}
	if code, _ := e.call(a, http.MethodDelete, "/api/courses/MAT-101/review", nil); code != http.StatusNotFound {
		t.Fatalf("delete twice: %d", code)
	}
}
