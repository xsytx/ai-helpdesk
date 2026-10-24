package handlers

import (
	"fmt"
	"net/http"
	"testing"
)

// Replies to answers (one level). Real database, skipped without
// TEST_DATABASE_URL.

func TestRepliesToAnswers(t *testing.T) {
	e := newForumEnv(t)
	asker, helper, other := e.user("user"), e.user("user"), e.user("user")
	tid := e.newThread(asker, "Where is the gym?", "Looking for the gym on campus")
	answer := e.newAnswer(helper, tid, "Block G, ground floor.")
	e.call(helper, http.MethodPost, "/api/notifications/read-all", nil)

	reply := func(u modUser, parent int64, body string) int64 {
		t.Helper()
		_, c := e.call(u, http.MethodPost, fmt.Sprintf("/api/threads/%d/comments", tid), map[string]any{"body": body, "parent_comment_id": parent})
		id := num(c["id"])
		e.waitStatus("comment", id, "ok")
		return id
	}
	// The answer's author is @-mentioned in the reply but gets one notice, not two.
	first := reply(asker, answer, mention(helper)+" thanks, is it open on Sunday?")
	if got := fmt.Sprint(e.notificationTypes(helper)); got != "[reply_to_comment]" {
		t.Fatalf("helper's notifications: %v", got)
	}
	// A reply to a reply goes under the same answer; its author is mentioned.
	e.call(asker, http.MethodPost, "/api/notifications/read-all", nil)
	second := reply(other, first, mention(asker)+" yes, until 20:00")
	_, th := e.call(asker, http.MethodGet, fmt.Sprintf("/api/threads/%d", tid), nil)
	parents := map[int64]int64{}
	for _, c := range th["comments"].([]any) {
		m := c.(map[string]any)
		parents[num(m["id"])] = num(m["parent_comment_id"])
	}
	if parents[first] != answer || parents[second] != answer {
		t.Fatalf("parents: %v (answer %d)", parents, answer)
	}
	// The question's author follows it, but gets only "mentioned you" for this reply.
	if got := fmt.Sprint(e.notificationTypes(asker)); got != "[mention]" {
		t.Fatalf("asker's notifications: %v", got)
	}

	// Replies are not counted as answers, but a correct reply can be the solution.
	if n := num(th["thread"].(map[string]any)["comment_count"]); n != 1 {
		t.Fatalf("answer count %d, want 1", n)
	}
	if code, _ := e.call(asker, http.MethodPost, fmt.Sprintf("/api/threads/%d/accept", tid), map[string]any{"comment_id": second}); code >= 300 {
		t.Fatalf("accepting a reply: %d", code)
	}
	_, th = e.call(asker, http.MethodGet, fmt.Sprintf("/api/threads/%d", tid), nil)
	if got := num(th["thread"].(map[string]any)["accepted_comment_id"]); got != second {
		t.Fatalf("accepted %d, want the reply %d", got, second)
	}
}
