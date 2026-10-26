package handlers

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// Saved questions, mute and ban. Real database, skipped without
// TEST_DATABASE_URL.

func TestSavedQuestions(t *testing.T) {
	e := newForumEnv(t)
	u, author := e.user("user"), e.user("user")
	tid := e.newThread(author, "Where is the gym?", "Looking for the gym on campus")
	path := fmt.Sprintf("/api/threads/%d/save", tid)

	if code, _ := e.call(u, http.MethodPut, path, nil); code != http.StatusOK {
		t.Fatalf("save: %d", code)
	}
	e.call(u, http.MethodPut, path, nil) // twice is fine
	if _, th := e.call(u, http.MethodGet, fmt.Sprintf("/api/threads/%d", tid), nil); th["saved"] != true {
		t.Fatalf("thread page: saved = %v", th["saved"])
	}
	if _, th := e.call(author, http.MethodGet, fmt.Sprintf("/api/threads/%d", tid), nil); th["saved"] != false {
		t.Fatal("saved is per user")
	}
	if _, list := e.call(u, http.MethodGet, "/api/me/saved", nil); !contains(threadIDs(list), tid) || len(threadIDs(list)) != 1 {
		t.Fatalf("saved list: %v", list)
	}
	e.call(u, http.MethodDelete, path, nil)
	if _, list := e.call(u, http.MethodGet, "/api/me/saved", nil); len(threadIDs(list)) != 0 {
		t.Fatalf("after removing: %v", list)
	}
	if code, _ := e.call(u, http.MethodPut, "/api/threads/999999999/save", nil); code != http.StatusNotFound {
		t.Fatalf("saving a missing question: %d, want 404", code)
	}
}

func TestMuteAndBan(t *testing.T) {
	e := newForumEnv(t)
	admin, student, other := e.user("admin"), e.user("user"), e.user("user")
	restrict := func(by modUser, target modUser, kind string, days int) int {
		code, _ := e.call(by, http.MethodPost, fmt.Sprintf("/api/admin/users/%d/restriction", target.id),
			map[string]any{"kind": kind, "days": days, "reason": "Rude answers"})
		return code
	}
	post := func(u modUser) (int, map[string]any) {
		return e.call(u, http.MethodPost, "/api/threads", map[string]any{"title": "A normal question", "body": "Where is the library located?"})
	}

	if code := restrict(other, student, "mute", 1); code != http.StatusForbidden {
		t.Fatalf("a student restricting: %d, want 403", code)
	}
	if code := restrict(admin, e.user("admin"), "ban", 1); code != http.StatusBadRequest {
		t.Fatalf("restricting staff: %d, want 400", code)
	}

	// Mute: can't post, sees why; still logged in.
	if code := restrict(admin, student, "mute", 1); code != http.StatusNoContent {
		t.Fatalf("mute: %d", code)
	}
	code, out := post(student)
	if code != http.StatusForbidden || out["code"] != "muted" || out["reason"] != "Rude answers" || out["until"] == nil {
		t.Fatalf("muted post: %d %v", code, out)
	}
	if _, me := e.call(student, http.MethodGet, "/api/me", nil); me["muted"] != true || me["mute_reason"] != "Rude answers" {
		t.Fatalf("me while muted: %v", me)
	}
	_, list := e.call(admin, http.MethodGet, "/api/admin/restrictions", nil)
	found := false
	for _, x := range list["users"].([]any) {
		if m := x.(map[string]any); num(m["user_id"]) == student.id && m["kind"] == "mute" {
			found = true
		}
	}
	if !found {
		t.Fatalf("restrictions list: %v", list)
	}
	e.call(admin, http.MethodDelete, fmt.Sprintf("/api/admin/users/%d/restriction?kind=mute", student.id), nil)
	if code, _ := post(student); code != http.StatusCreated {
		t.Fatalf("after unmute: %d", code)
	}

	// Ban without an end: /api/me refuses (the website logs out).
	if code := restrict(admin, student, "ban", 0); code != http.StatusNoContent {
		t.Fatalf("ban: %d", code)
	}
	if code, me := e.call(student, http.MethodGet, "/api/me", nil); code != http.StatusForbidden || me["code"] != "banned" || me["until"] != nil {
		t.Fatalf("me while banned: %d %v", code, me)
	}
	// A ban whose end has passed no longer counts.
	past := time.Now().Add(-time.Hour)
	if err := e.pg.RestrictUser(context.Background(), student.id, "ban", &past, "old"); err != nil {
		t.Fatal(err)
	}
	if code, _ := e.call(student, http.MethodGet, "/api/me", nil); code != http.StatusOK {
		t.Fatalf("after the ban ended: %d", code)
	}
}
