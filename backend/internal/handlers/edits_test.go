package handlers

import (
	"fmt"
	"net/http"
	"testing"
)

// Like/solution notifications and edited posts. Real database, skipped
// without TEST_DATABASE_URL.

func TestLikeAndSolutionNotifications(t *testing.T) {
	e := newForumEnv(t)
	asker, helper, liker := e.user("user"), e.user("user"), e.user("user")
	tid := e.newThread(asker, "Where is the library?", "Which block is the library in?")
	aid := e.newAnswer(helper, tid, "Block C, second floor.")
	e.call(helper, http.MethodPost, "/api/notifications/read-all", nil)
	vote := func(u modUser) {
		e.call(u, http.MethodPost, fmt.Sprintf("/api/comments/%d/vote", aid), map[string]any{"value": 1})
	}

	vote(liker)
	if got := fmt.Sprint(e.notificationTypes(helper)); got != "[answer_liked]" {
		t.Fatalf("after a like: %v", got)
	}
	vote(liker) // takes the like back: the unread notice goes too
	if n := e.unread(helper); n != 0 {
		t.Fatalf("after taking the like back: %d unread", n)
	}
	vote(helper) // your own like: no notice
	if n := e.unread(helper); n != 0 {
		t.Fatalf("own like: %d unread", n)
	}

	accept := func(id any) {
		if code, _ := e.call(asker, http.MethodPost, fmt.Sprintf("/api/threads/%d/accept", tid), map[string]any{"comment_id": id}); code >= 300 {
			t.Fatalf("accept: %d", code)
		}
	}
	accept(aid)
	if got := fmt.Sprint(e.notificationTypes(helper)); got != "[answer_accepted]" {
		t.Fatalf("after accepting: %v", got)
	}
	accept(nil)
	if n := e.unread(helper); n != 0 {
		t.Fatalf("after un-accepting: %d unread", n)
	}
}

func TestEditedPostsAndHistory(t *testing.T) {
	e := newForumEnv(t)
	asker, helper, other, admin := e.user("user"), e.user("user"), e.user("user"), e.user("admin")
	tid := e.newThread(asker, "Where is the library?", "Which block is the library in?")
	aid := e.newAnswer(helper, tid, "Block C, second floor.")
	e.call(asker, http.MethodPost, fmt.Sprintf("/api/threads/%d/accept", tid), map[string]any{"comment_id": aid})

	editAnswer := func(body string) {
		if code, _ := e.call(helper, http.MethodPatch, fmt.Sprintf("/api/comments/%d", aid), map[string]any{"body": body}); code != http.StatusOK {
			t.Fatalf("edit answer: %d", code)
		}
		e.waitStatus("comment", aid, "ok")
	}
	answerOf := func() map[string]any {
		_, th := e.call(asker, http.MethodGet, fmt.Sprintf("/api/threads/%d", tid), nil)
		for _, c := range th["comments"].([]any) {
			if m := c.(map[string]any); num(m["id"]) == aid {
				return m
			}
		}
		t.Fatal("answer not found")
		return nil
	}
	if answerOf()["edited_at"] != nil {
		t.Fatal("a new answer is not edited")
	}
	editAnswer("Block C, third floor.")
	if answerOf()["edited_at"] == nil {
		t.Fatal("edited_at not set after an edit")
	}
	editAnswer("Block C, third floor.") // the same text: no new version

	path := fmt.Sprintf("/api/comments/%d/revisions", aid)
	_, out := e.call(helper, http.MethodGet, path, nil)
	revs, _ := out["revisions"].([]any)
	if len(revs) != 1 || revs[0].(map[string]any)["body"] != "Block C, second floor." {
		t.Fatalf("history for the author: %v", out)
	}
	if code, _ := e.call(other, http.MethodGet, path, nil); code != http.StatusForbidden {
		t.Fatalf("someone else: %d, want 403", code)
	}
	if code, _ := e.call(admin, http.MethodGet, path, nil); code != http.StatusOK {
		t.Fatalf("staff: %d", code)
	}

	// The question: changing only the tags is not an edit of the text.
	_, th := e.call(asker, http.MethodGet, fmt.Sprintf("/api/threads/%d", tid), nil)
	if th["thread"].(map[string]any)["accepted_at"] == nil {
		t.Fatal("accepted_at missing")
	}
	code, _ := e.call(asker, http.MethodPatch, fmt.Sprintf("/api/threads/%d", tid),
		map[string]any{"title": "Where is the library?", "body": "Which block is the library in?", "tags": []string{"campus"}})
	if code != http.StatusOK {
		t.Fatalf("edit tags: %d", code)
	}
	e.waitStatus("thread", tid, "ok")
	_, th = e.call(asker, http.MethodGet, fmt.Sprintf("/api/threads/%d", tid), nil)
	if th["thread"].(map[string]any)["edited_at"] != nil {
		t.Fatal("changing tags must not mark the question edited")
	}
}
