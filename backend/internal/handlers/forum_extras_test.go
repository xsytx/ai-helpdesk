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
	mux.HandleFunc("GET /api/threads/similar", e.h.SimilarThreads)
	mux.HandleFunc("GET /api/leaderboard", e.h.Leaderboard)
	mux.HandleFunc("GET /api/users/{id}", e.h.GetUserProfile)
	mux.HandleFunc("GET /api/users/{id}/comments", e.h.ListUserComments)
	mux.Handle("GET /api/me", authMw(http.HandlerFunc(e.h.Me)))
	mux.Handle("PUT /api/me/avatar", authMw(http.HandlerFunc(e.h.SetAvatar)))
	mux.Handle("POST /api/me/avatar", authMw(http.HandlerFunc(e.h.UploadAvatar)))
	mux.Handle("POST /api/comments/{id}/attachments", authMw(http.HandlerFunc(e.h.UploadAnswerAttachment)))
	mux.Handle("GET /api/me/reputation", authMw(http.HandlerFunc(e.h.MyReputation)))
	mux.Handle("POST /api/comments/{id}/vote", authMw(http.HandlerFunc(e.h.VoteComment)))
	mux.Handle("POST /api/threads/{id}/attachments", authMw(http.HandlerFunc(e.h.UploadAttachment)))
	mux.Handle("DELETE /api/attachments/{id}", authMw(http.HandlerFunc(e.h.DeleteAttachment)))
	mux.HandleFunc("GET /api/feed", e.h.ListFeed)
	mux.Handle("POST /api/threads/{id}/accept", authMw(http.HandlerFunc(e.h.AcceptAnswer)))
	mux.Handle("POST /api/threads/{id}/report", authMw(http.HandlerFunc(e.h.ReportThread)))
	mux.Handle("POST /api/comments/{id}/report", authMw(http.HandlerFunc(e.h.ReportComment)))
	mux.Handle("GET /api/reports", authMw(http.HandlerFunc(e.h.ListReports)))
	mux.Handle("POST /api/reports/{id}/resolve", authMw(http.HandlerFunc(e.h.ResolveReport)))
	mux.Handle("GET /api/moderation/queue", authMw(http.HandlerFunc(e.h.ListModerationQueue)))
	mux.Handle("POST /api/moderation/queue/{id}/approve", authMw(http.HandlerFunc(e.h.ApproveModeration)))
	mux.Handle("POST /api/chat/ask/stream", authMw(http.HandlerFunc(e.h.ChatAskStream)))
	mux.Handle("GET /api/chat/conversations/{id}/messages", authMw(http.HandlerFunc(e.h.GetChatConversationMessages)))
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
	code, th := e.call(author, http.MethodPost, "/api/threads", map[string]any{
		"title": "How to find the " + word + " office", "body": "Asking about the office",
		// Only listed tags count: no repeats, unknown ones dropped, at most 5.
		"tags": []string{"#dorm", "Dorm", " Campus ", "my-own-tag", "exams", "food", "clubs", "it"},
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
	_, byTag := e.call(other, http.MethodGet, "/api/tags/campus/threads?page_size=50", nil)
	var tagged map[string]any
	for _, th := range byTag["threads"].([]any) {
		if num(th.(map[string]any)["id"]) == tid {
			tagged = th.(map[string]any)
		}
	}
	if tagged == nil {
		t.Fatalf("tag filter: %v", byTag)
	}
	if tags := fmt.Sprint(tagged["tags"]); tags != "[campus clubs dorm exams food]" {
		t.Fatalf("tags should be the first 5 listed ones: %v", tags)
	}
	// The feed takes several tags (any of them) together with a sort.
	for query, want := range map[string]bool{
		"sort=top&tags=scholarship,Food":        true,
		"sort=unanswered&tags=dorm":             true,
		"sort=new&tags=scholarship,documents":   false,
		"sort=new&tags=my-own-tag,scholarship":  false,
	} {
		_, feed := e.call(other, http.MethodGet, "/api/feed?page_size=50&"+query, nil)
		if contains(threadIDs(feed), tid) != want {
			t.Fatalf("feed %s: has the question = %v, want %v", query, !want, want)
		}
	}

	// Edit: only the author; the tags sent replace the old ones.
	tpath := fmt.Sprintf("/api/threads/%d", tid)
	edit := map[string]any{"title": "How to find the " + word + " office?", "body": "Edited body", "tags": []string{"campus"}}
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

func TestSearchFindsPartialWordsTyposAnswersAndTags(t *testing.T) {
	e := newForumEnv(t)
	u, other := e.user("user"), e.user("user")
	// A made-up word per run, so other test data never matches.
	n := time.Now().UnixNano() % 1_000_000
	word := fmt.Sprintf("canteenx%dq", n)
	post := func(title, body string, tags ...string) int64 {
		code, th := e.call(u, http.MethodPost, "/api/threads", map[string]any{"title": title, "body": body, "tags": tags})
		if code != http.StatusCreated {
			t.Fatalf("create: %d %v", code, th)
		}
		id := num(th["id"])
		e.waitStatus("thread", id, "ok")
		return id
	}
	inTitle := post("Where is the "+word+"?", "Looking for lunch")
	inBody := post("Lunch question", "Is the "+word+" open on Sunday?")
	inAnswer := post("Food on campus", "Where can I eat?")
	_, c := e.call(other, http.MethodPost, fmt.Sprintf("/api/threads/%d/comments", inAnswer), map[string]any{"body": "Try the " + word + " in block A"})
	e.waitStatus("comment", num(c["id"]), "ok")
	inTag := post("Opening hours", "When does it open?", "scholarship")

	search := func(q string) ([]int64, []string) {
		_, out := e.call(u, http.MethodGet, "/api/search?q="+url.QueryEscape(q), nil)
		var ids []int64
		var how []string
		for _, th := range out["threads"].([]any) {
			m := th.(map[string]any)
			id := num(m["id"])
			if id == inTitle || id == inBody || id == inAnswer || id == inTag {
				ids = append(ids, id)
				how = append(how, fmt.Sprint(m["search_match"]))
			}
		}
		return ids, how
	}

	// Half a word finds all three, title match first, then body, then answer.
	ids, how := search(word[:len(word)-3])
	if len(ids) != 3 || fmt.Sprint(how) != "[title body answer]" {
		t.Fatalf("prefix search: ids %v (title=%d body=%d answer=%d), matched %v", ids, inTitle, inBody, inAnswer, how)
	}
	// Part of a tag's name finds questions with that tag.
	if ids, how := search("scholarsh"); len(ids) != 1 || ids[0] != inTag || how[0] != "tag" {
		t.Fatalf("tag search: %v %v", ids, how)
	}
	// A typo (first letter wrong) still finds the title and the body.
	typo := "k" + word[1:]
	ids, how = search(typo)
	if len(ids) < 2 || ids[0] != inTitle || how[0] != "similar" {
		t.Fatalf("typo search %q: %v %v", typo, ids, how)
	}
	// One-letter "words" alone don't match everything.
	if ids, _ := search("a"); len(ids) != 0 {
		t.Fatalf("one letter matched %v", ids)
	}
}
