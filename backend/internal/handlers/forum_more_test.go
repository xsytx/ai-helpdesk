package handlers

import (
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"
)

// "Maybe already asked", Solved, Unanswered and reports. Real database,
// skipped without TEST_DATABASE_URL.

func (e *modEnv) newThread(u modUser, title, body string) int64 {
	e.t.Helper()
	code, th := e.call(u, http.MethodPost, "/api/threads", map[string]any{"title": title, "body": body})
	if code != http.StatusCreated {
		e.t.Fatalf("create %q: %d %v", title, code, th)
	}
	id := num(th["id"])
	e.waitStatus("thread", id, "ok")
	return id
}

func (e *modEnv) newAnswer(u modUser, threadID int64, body string) int64 {
	e.t.Helper()
	_, c := e.call(u, http.MethodPost, fmt.Sprintf("/api/threads/%d/comments", threadID), map[string]any{"body": body})
	id := num(c["id"])
	e.waitStatus("comment", id, "ok")
	return id
}

func threadIDs(out map[string]any) []int64 {
	var ids []int64
	for _, th := range out["threads"].([]any) {
		ids = append(ids, num(th.(map[string]any)["id"]))
	}
	return ids
}

func contains(ids []int64, id int64) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

func TestSimilarQuestions(t *testing.T) {
	e := newForumEnv(t)
	u := e.user("user")
	w := fmt.Sprintf("zq%d", time.Now().UnixNano()%1_000_000)
	library := e.newThread(u, "Где находится библиотека "+w+"?", "Ищу библиотеку")
	canteen := e.newThread(u, "Где столовая "+w+"?", "Хочу поесть")

	similar := func(q string) []int64 {
		_, out := e.call(u, http.MethodGet, "/api/threads/similar?q="+url.QueryEscape(q), nil)
		return threadIDs(out)
	}
	// Other words around, another word form ("библиотеку"), "SDU": still the
	// same topic, and it shares more words than the canteen question.
	ids := similar("Как найти библиотеку в SDU " + w)
	if len(ids) == 0 || ids[0] != library {
		t.Fatalf("similar to the library question: %v (library=%d canteen=%d)", ids, library, canteen)
	}
	if ids := similar("Где купить спортивную форму"); contains(ids, library) || contains(ids, canteen) {
		t.Fatalf("unrelated title matched: %v", ids)
	}
	// Only question words: nothing to compare.
	if ids := similar("Как где когда?"); len(ids) != 0 {
		t.Fatalf("stop words only: %v", ids)
	}
}

func TestAcceptedAnswerAndUnansweredFilter(t *testing.T) {
	e := newForumEnv(t)
	author, other := e.user("user"), e.user("user")
	tid := e.newThread(author, "Exam retake rules?", "How do retakes work at SDU?")
	other2 := e.newThread(other, "Another question here", "Some body text")

	_, feed := e.call(author, http.MethodGet, "/api/feed?sort=unanswered&page_size=50", nil)
	if !contains(threadIDs(feed), tid) {
		t.Fatal("a new question must be in the unanswered list")
	}
	cid := e.newAnswer(other, tid, "Write to the Student Service Center.")
	_, feed = e.call(author, http.MethodGet, "/api/feed?sort=unanswered&page_size=50", nil)
	if contains(threadIDs(feed), tid) {
		t.Fatal("an answered question must leave the unanswered list")
	}

	path := fmt.Sprintf("/api/threads/%d/accept", tid)
	if code, _ := e.call(other, http.MethodPost, path, map[string]any{"comment_id": cid}); code != http.StatusForbidden {
		t.Fatalf("non-author accepts: %d, want 403", code)
	}
	foreign := e.newAnswer(author, other2, "An answer elsewhere")
	if code, _ := e.call(author, http.MethodPost, path, map[string]any{"comment_id": foreign}); code != http.StatusBadRequest {
		t.Fatalf("accepting an answer of another thread: %d, want 400", code)
	}
	if code, _ := e.call(author, http.MethodPost, path, map[string]any{"comment_id": cid}); code != http.StatusNoContent {
		t.Fatalf("accept: %d", code)
	}
	_, got := e.call(other, http.MethodGet, fmt.Sprintf("/api/threads/%d", tid), nil)
	if num(got["thread"].(map[string]any)["accepted_comment_id"]) != cid {
		t.Fatalf("accepted answer not shown: %v", got["thread"])
	}
	if code, _ := e.call(author, http.MethodPost, path, map[string]any{"comment_id": nil}); code != http.StatusNoContent {
		t.Fatalf("clear: %d", code)
	}
	_, got = e.call(other, http.MethodGet, fmt.Sprintf("/api/threads/%d", tid), nil)
	if _, set := got["thread"].(map[string]any)["accepted_comment_id"]; set {
		t.Fatalf("cleared answer still accepted: %v", got["thread"])
	}
}

func TestReportsOncePerStudentAndResolvedOnDelete(t *testing.T) {
	e := newForumEnv(t)
	author, reporter, admin := e.user("user"), e.user("user"), e.user("admin")
	tid := e.newThread(author, "Selling my notes", "Cheap notes for sale")
	cid := e.newAnswer(author, tid, "DM me for the price")

	rpath := fmt.Sprintf("/api/comments/%d/report", cid)
	for _, reason := range []string{"spam", "spam: selling things"} {
		if code, _ := e.call(reporter, http.MethodPost, rpath, map[string]any{"reason": reason}); code != http.StatusCreated {
			t.Fatalf("report: %d", code)
		}
	}
	mine := func() []map[string]any {
		_, out := e.call(admin, http.MethodGet, "/api/reports?status=open&page_size=50", nil)
		var found []map[string]any
		for _, r := range out["reports"].([]any) {
			m := r.(map[string]any)
			if num(m["target_id"]) == cid && m["target_type"] == "comment" {
				found = append(found, m)
			}
		}
		return found
	}
	if got := mine(); len(got) != 1 || got[0]["reason"] != "spam: selling things" || num(got[0]["thread_id"]) != tid {
		t.Fatalf("one open report per student, with the latest reason: %v", got)
	}
	if code, _ := e.call(reporter, http.MethodGet, "/api/reports", nil); code != http.StatusForbidden {
		t.Fatalf("student lists reports: %d, want 403", code)
	}
	if code, _ := e.call(admin, http.MethodDelete, fmt.Sprintf("/api/comments/%d", cid), nil); code != http.StatusNoContent {
		t.Fatalf("admin delete: %d", code)
	}
	if got := mine(); len(got) != 0 {
		t.Fatalf("reports about a deleted post must be closed: %v", got)
	}
}
