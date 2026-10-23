package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"campus-forum/internal/middleware"
)

// Search, tags, editing/deleting own posts and the notification bell, as the
// website uses them. Real database, skipped without TEST_DATABASE_URL.

func newForumEnv(t *testing.T) *modEnv {
	t.Helper()
	e := newModEnv(t)
	authMw := middleware.Auth(e.secret)
	optionalAuthMw := middleware.OptionalAuth(e.secret)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/search", e.h.Search)
	mux.HandleFunc("GET /api/tags/trending", e.h.TrendingTags)
	mux.HandleFunc("GET /api/tags/{name}/threads", e.h.ListThreadsByTag)
	mux.Handle("GET /api/threads/{id}", optionalAuthMw(http.HandlerFunc(e.h.GetThread)))
	mux.Handle("POST /api/threads", authMw(http.HandlerFunc(e.h.CreateThread)))
	mux.Handle("PATCH /api/threads/{id}", authMw(http.HandlerFunc(e.h.UpdateThread)))
	mux.Handle("DELETE /api/threads/{id}", authMw(http.HandlerFunc(e.h.DeleteThread)))
	mux.Handle("POST /api/threads/{id}/comments", authMw(http.HandlerFunc(e.h.CreateComment)))
	mux.Handle("PATCH /api/comments/{id}", authMw(http.HandlerFunc(e.h.UpdateComment)))
	mux.Handle("DELETE /api/comments/{id}", authMw(http.HandlerFunc(e.h.DeleteComment)))
	mux.Handle("GET /api/notifications", authMw(http.HandlerFunc(e.h.ListNotifications)))
	mux.Handle("GET /api/notifications/unread-count", authMw(http.HandlerFunc(e.h.UnreadNotificationCount)))
	mux.Handle("POST /api/notifications/read-all", authMw(http.HandlerFunc(e.h.MarkAllNotificationsRead)))
	mux.Handle("GET /api/moderation/queue", authMw(http.HandlerFunc(e.h.ListModerationQueue)))
	mux.Handle("POST /api/moderation/queue/{id}/approve", authMw(http.HandlerFunc(e.h.ApproveModeration)))
	e.srv.Close()
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

func (e *modEnv) unread(u modUser) int64 {
	e.t.Helper()
	_, out := e.call(u, http.MethodGet, "/api/notifications/unread-count", nil)
	return num(out["unread"])
}

func TestNotificationAboutHeldAnswerIsHidden(t *testing.T) {
	e := newForumEnv(t)
	author, other, mod := e.user("user"), e.user("user"), e.user("moderator")
	_, th := e.call(author, http.MethodPost, "/api/threads", map[string]any{"title": "Where is room D116?", "body": "Looking for room D116"})
	tid := num(th["id"])
	e.waitStatus("thread", tid, "ok")
	path := fmt.Sprintf("/api/threads/%d/comments", tid)

	_, c := e.call(other, http.MethodPost, path, map[string]any{"body": "Block D, first floor"})
	e.waitStatus("comment", num(c["id"]), "ok")
	if n := e.unread(author); n != 1 {
		t.Fatalf("unread after a normal answer: %d, want 1", n)
	}
	_, list := e.call(author, http.MethodGet, "/api/notifications", nil)
	items := list["notifications"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["thread_title"] != "Where is room D116?" {
		t.Fatalf("list %v", list)
	}
	e.call(author, http.MethodPost, "/api/notifications/read-all", nil)

	_, held := e.call(other, http.MethodPost, path, map[string]any{"body": "MAYBE a strange answer"})
	hid := num(held["id"])
	e.waitStatus("comment", hid, "held")
	if n := e.unread(author); n != 0 {
		t.Fatalf("unread for a held answer: %d, want 0", n)
	}
	item := e.queueItemFor("comment", hid)
	if code, _ := e.call(mod, http.MethodPost, fmt.Sprintf("/api/moderation/queue/%d/approve", num(item["id"])), map[string]any{}); code != http.StatusOK {
		t.Fatalf("approve: %d", code)
	}
	if n := e.unread(author); n != 1 {
		t.Fatalf("unread once a moderator published it: %d, want 1", n)
	}
}

func TestSearchTagsAndOwnPostEditing(t *testing.T) {
	e := newForumEnv(t)
	author, other, admin := e.user("user"), e.user("user"), e.user("admin")
	word := fmt.Sprintf("zebra%d", time.Now().UnixNano()%1_000_000)
	tag := "t" + word
	code, th := e.call(author, http.MethodPost, "/api/threads", map[string]any{
		"title": "How to find the " + word + " office", "body": "Asking about the office", "tags": []string{"#" + tag, tag, " Campus "},
	})
	if code != http.StatusCreated {
		t.Fatalf("create: %d %v", code, th)
	}
	tid := num(th["id"])
	e.waitStatus("thread", tid, "ok")

	_, found := e.call(other, http.MethodGet, "/api/search?q="+url.QueryEscape(word), nil)
	if threads := found["threads"].([]any); len(threads) != 1 || num(threads[0].(map[string]any)["id"]) != tid {
		t.Fatalf("search: %v", found)
	}
	_, byTag := e.call(other, http.MethodGet, "/api/tags/"+tag+"/threads", nil)
	if threads := byTag["threads"].([]any); len(threads) != 1 {
		t.Fatalf("tag filter: %v", byTag)
	} else if tags := threads[0].(map[string]any)["tags"].([]any); len(tags) != 2 {
		t.Fatalf("tags should be normalized and deduplicated: %v", tags)
	}

	// Edit: only the author; the tags sent replace the old ones.
	tpath := fmt.Sprintf("/api/threads/%d", tid)
	edit := map[string]any{"title": "How to find the " + word + " office?", "body": "Edited body", "tags": []string{tag}}
	if code, _ := e.call(other, http.MethodPatch, tpath, edit); code != http.StatusForbidden {
		t.Fatalf("other user edit: %d, want 403", code)
	}
	if code, out := e.call(author, http.MethodPatch, tpath, edit); code != http.StatusOK || out["body"] != "Edited body" {
		t.Fatalf("author edit: %d %v", code, out)
	}

	_, c := e.call(other, http.MethodPost, tpath+"/comments", map[string]any{"body": "Second floor"})
	cpath := fmt.Sprintf("/api/comments/%d", num(c["id"]))
	if code, _ := e.call(author, http.MethodPatch, cpath, map[string]any{"body": "hijacked"}); code != http.StatusForbidden {
		t.Fatalf("editing someone else's answer: %d, want 403", code)
	}
	if code, out := e.call(other, http.MethodPatch, cpath, map[string]any{"body": "Second floor, room 205"}); code != http.StatusOK || out["body"] != "Second floor, room 205" {
		t.Fatalf("own answer edit: %d %v", code, out)
	}
	if code, _ := e.call(author, http.MethodDelete, cpath, nil); code != http.StatusForbidden {
		t.Fatalf("deleting someone else's answer: %d, want 403", code)
	}
	// Admins may delete any post.
	if code, _ := e.call(admin, http.MethodDelete, cpath, nil); code != http.StatusNoContent {
		t.Fatalf("admin delete answer: %d", code)
	}
	if code, _ := e.call(author, http.MethodDelete, tpath, nil); code != http.StatusNoContent {
		t.Fatalf("author delete thread: %d", code)
	}
	if code, _ := e.call(other, http.MethodGet, tpath, nil); code != http.StatusNotFound {
		t.Fatalf("deleted thread: %d, want 404", code)
	}
}
