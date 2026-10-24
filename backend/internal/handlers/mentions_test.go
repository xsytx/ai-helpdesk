package handlers

import (
	"fmt"
	"net/http"
	"net/url"
	"testing"
)

// @mentions in questions and answers. Real database, skipped without
// TEST_DATABASE_URL.

func mention(u modUser) string { return fmt.Sprintf("@[%s](u%d)", u.name, u.id) }

func (e *modEnv) notificationTypes(u modUser) []string {
	e.t.Helper()
	_, out := e.call(u, http.MethodGet, "/api/notifications", nil)
	var types []string
	for _, n := range out["notifications"].([]any) {
		if m := n.(map[string]any); m["read"] != true {
			types = append(types, fmt.Sprint(m["type"]))
		}
	}
	return types
}

func TestMentionsNotifyOnceAndUserSearch(t *testing.T) {
	e := newForumEnv(t)
	alice, bob, carol := e.user("user"), e.user("user"), e.user("user")

	// "@" + the start of a name suggests people.
	_, found := e.call(bob, http.MethodGet, "/api/users/search?q="+url.QueryEscape(alice.name[:len(alice.name)-1]), nil)
	ok := false
	for _, u := range found["users"].([]any) {
		if num(u.(map[string]any)["id"]) == alice.id {
			ok = true
		}
	}
	if !ok {
		t.Fatalf("search did not find %s: %v", alice.name, found)
	}

	// A question mentioning alice (and bob himself, which is ignored).
	tid := e.newThread(bob, "Who knows the dorm rules?", "Maybe "+mention(alice)+" knows, asks "+mention(bob))
	if got := fmt.Sprint(e.notificationTypes(alice)); got != "[mention]" {
		t.Fatalf("alice after the question: %v", got)
	}
	if n := e.unread(bob); n != 0 {
		t.Fatalf("mentioning yourself must not notify: %d", n)
	}
	e.call(alice, http.MethodPost, "/api/notifications/read-all", nil)

	// An answer mentioning alice; then an edit that keeps her and adds carol.
	cid := e.newAnswer(bob, tid, "I asked "+mention(alice))
	if n := e.unread(alice); n != 1 {
		t.Fatalf("alice after the answer: %d unread", n)
	}
	e.call(alice, http.MethodPost, "/api/notifications/read-all", nil)
	code, _ := e.call(bob, http.MethodPatch, fmt.Sprintf("/api/comments/%d", cid), map[string]any{"body": "I asked " + mention(alice) + " and " + mention(carol)})
	if code != http.StatusOK {
		t.Fatalf("edit: %d", code)
	}
	e.waitStatus("comment", cid, "ok")
	if n := e.unread(alice); n != 0 {
		t.Fatalf("an edit must not notify alice again: %d", n)
	}
	if got := fmt.Sprint(e.notificationTypes(carol)); got != "[mention]" {
		t.Fatalf("carol after the edit: %v", got)
	}
}
