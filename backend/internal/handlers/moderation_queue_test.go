package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/auth"
	"campus-forum/internal/mailer"
	"campus-forum/internal/middleware"
	"campus-forum/internal/mlclient"
	"campus-forum/internal/store"
)

// These tests run the real handlers against a real PostgreSQL database and a
// fake ML service. They are skipped unless TEST_DATABASE_URL is set, e.g.
//
//	TEST_DATABASE_URL="postgres://campus_forum:campus_forum@localhost:5433/campus_forum?sslmode=disable" go test ./internal/handlers
//
// Use a separate test database: the tests create their own users/threads (with
// unique names) but do not delete them. With docker compose running:
//
//	docker exec sdu_ai_helpdesk-db-1 createdb -U campus_forum campus_forum_test
//	TEST_DATABASE_URL="postgres://campus_forum:campus_forum@localhost:5432/campus_forum_test?sslmode=disable" go test ./internal/handlers

type modEnv struct {
	t      *testing.T
	srv    *httptest.Server
	pg     *store.PostgresStore
	dsn    string
	secret []byte
	h      *Handlers
	mlHits int32
	mlMode atomic.Value // string: "ok" (default), "down"
}

// fakeML mimics POST /moderate: text with BADWORD -> block, MAYBE -> review
// (full check only; the instant "fast" check is a word filter and only knows
// BADWORD), otherwise allow.
func (e *modEnv) fakeML() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&e.mlHits, 1)
		if r.URL.Path != "/moderate" {
			http.NotFound(w, r)
			return
		}
		if mode, _ := e.mlMode.Load().(string); mode == "down" {
			http.Error(w, `{"error":"moderation_unavailable"}`, http.StatusServiceUnavailable)
			return
		}
		var in struct {
			Text string `json:"text"`
			Mode string `json:"mode"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		out := map[string]any{"request_id": "ml-1", "policy_version": "toxicity-v2", "categories": []string{}, "decision": "allow", "publish_allowed": true, "reason": "ok"}
		switch {
		case strings.Contains(in.Text, "BADWORD"):
			out["decision"], out["publish_allowed"], out["categories"], out["reason"] = "block", false, []string{"profanity"}, "profanity_filter"
		case strings.Contains(in.Text, "MAYBE") && in.Mode != "fast":
			out["decision"], out["publish_allowed"], out["reason"] = "review", false, "uncertain"
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	})
}

func newModEnv(t *testing.T) *modEnv {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run the moderation integration tests")
	}
	ctx := context.Background()
	pg, err := store.NewPostgresStore(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pg.Close)
	if err := pg.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err := pg.MigrateModeration(ctx); err != nil {
		t.Fatal(err)
	}

	e := &modEnv{t: t, pg: pg, dsn: dsn, secret: []byte("test-secret-test-secret-test-secret")}
	ml := httptest.NewServer(e.fakeML())
	t.Cleanup(ml.Close)

	e.h = New(pg, e.secret, mailer.New(), t.TempDir(), "http://test", nil)
	e.h.ML = mlclient.New(ml.URL, 5*time.Second)
	e.h.Mod = pg
	e.h.ModCfg = DefaultModerationConfig()

	authMw := middleware.Auth(e.secret)
	optionalAuthMw := middleware.OptionalAuth(e.secret)
	mux := http.NewServeMux()
	mux.Handle("GET /api/threads/{id}", optionalAuthMw(http.HandlerFunc(e.h.GetThread)))
	mux.Handle("POST /api/threads", authMw(http.HandlerFunc(e.h.CreateThread)))
	mux.Handle("PATCH /api/threads/{id}", authMw(http.HandlerFunc(e.h.UpdateThread)))
	mux.Handle("POST /api/threads/{id}/comments", authMw(http.HandlerFunc(e.h.CreateComment)))
	mux.Handle("PATCH /api/comments/{id}", authMw(http.HandlerFunc(e.h.UpdateComment)))
	mux.Handle("POST /api/threads/{id}/lock", authMw(http.HandlerFunc(e.h.LockThread)))
	mux.Handle("GET /api/moderation/queue", authMw(http.HandlerFunc(e.h.ListModerationQueue)))
	mux.Handle("POST /api/moderation/queue/{id}/approve", authMw(http.HandlerFunc(e.h.ApproveModeration)))
	mux.Handle("POST /api/moderation/queue/{id}/reject", authMw(http.HandlerFunc(e.h.RejectModeration)))
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

type modUser struct {
	id    int64
	name  string
	token string
}

var uniq int64

func (e *modEnv) user(role string) modUser {
	e.t.Helper()
	n := atomic.AddInt64(&uniq, 1)
	name := fmt.Sprintf("u%d_%d", time.Now().UnixNano()%1_000_000_000, n)
	u, err := e.pg.CreateUser(context.Background(), name+"@sdu.edu.kz", name, "hash", "salt")
	if err != nil {
		e.t.Fatal(err)
	}
	conn, err := pgx.Connect(context.Background(), e.dsn)
	if err != nil {
		e.t.Fatal(err)
	}
	defer conn.Close(context.Background())
	if _, err := conn.Exec(context.Background(), `UPDATE users SET email_verified_at = now(), role = $2 WHERE id = $1`, u.ID, role); err != nil {
		e.t.Fatal(err)
	}
	tok, err := auth.IssueToken(e.secret, u.ID, u.Email, time.Hour)
	if err != nil {
		e.t.Fatal(err)
	}
	return modUser{id: u.ID, name: name, token: tok}
}

func (e *modEnv) call(u modUser, method, path string, body any) (int, map[string]any) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
	req.Header.Set("Authorization", "Bearer "+u.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out
}

func (e *modEnv) threadCount(u modUser) int {
	_, total, err := e.pg.ListThreadsByUser(context.Background(), u.id, 1, 50)
	if err != nil {
		e.t.Fatal(err)
	}
	return total
}

func (e *modEnv) commentCount(u modUser) int {
	_, total, err := e.pg.ListCommentsByUser(context.Background(), u.id, 1, 50)
	if err != nil {
		e.t.Fatal(err)
	}
	return total
}

func num(v any) int64 { f, _ := v.(float64); return int64(f) }

// waitStatus polls a post's moderation_status until it equals want (the AI
// check runs in the background) or fails the test after a few seconds.
func (e *modEnv) waitStatus(kind string, id int64, want string) {
	e.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		got, err := e.pg.PostModerationStatus(context.Background(), kind, id)
		if err == nil && got == want {
			return
		}
		if time.Now().After(deadline) {
			e.t.Fatalf("%s %d: moderation_status=%q (err %v), want %q", kind, id, got, err, want)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// queueItemFor finds the queue row created for a published post.
func (e *modEnv) queueItemFor(kind string, id int64) map[string]any {
	e.t.Helper()
	mod := e.user("moderator")
	_, list := e.call(mod, "GET", "/api/moderation/queue?status=all&page_size=100", nil)
	key := "published_thread_id"
	if kind == "comment" {
		key = "published_comment_id"
	}
	for _, it := range list["items"].([]any) {
		m := it.(map[string]any)
		if num(m[key]) == id {
			return m
		}
	}
	e.t.Fatalf("no queue item for %s %d", kind, id)
	return nil
}

func TestAllowedThreadIsPublishedAtOnceAndChecked(t *testing.T) {
	e := newModEnv(t)
	u := e.user("user")
	code, body := e.call(u, "POST", "/api/threads", map[string]any{"title": "How to register?", "body": "Where do I register for courses?"})
	if code != http.StatusCreated || num(body["id"]) == 0 || body["moderation_status"] != "checking" {
		t.Fatalf("got %d %v", code, body)
	}
	if e.threadCount(u) != 1 {
		t.Fatal("thread should be visible while it is being checked")
	}
	e.waitStatus("thread", num(body["id"]), "ok")
}

func TestObviousSwearingIsRefusedBeforePublishing(t *testing.T) {
	e := newModEnv(t)
	u := e.user("user")
	code, body := e.call(u, "POST", "/api/threads", map[string]any{"title": "Title BADWORD here", "body": "some body text", "tags": []string{"exams"}})
	if code != http.StatusAccepted || body["status"] != "pending_moderation" || body["decision"] != "block" {
		t.Fatalf("got %d %v", code, body)
	}
	if cats, _ := body["categories"].([]any); len(cats) != 1 || cats[0] != "profanity" {
		t.Fatalf("categories: %v", body["categories"])
	}
	if e.threadCount(u) != 0 {
		t.Fatal("blocked thread must never be published")
	}
	item, err := e.pg.GetModerationItem(context.Background(), num(body["queue_id"]))
	if err != nil {
		t.Fatal(err)
	}
	if item.Status != "pending" || item.Decision != "block" || item.Kind != "thread" || item.Title != "Title BADWORD here" ||
		item.Body != "some body text" || item.AuthorName != u.name || len(item.Tags) != 1 || item.Tags[0] != "exams" ||
		item.PolicyVersion != "toxicity-v2" || item.PublishedThreadID != nil || item.HiddenAfterPublish {
		t.Fatalf("saved item: %+v", item)
	}
}

func TestReviewPostIsPublishedThenHiddenAndQueued(t *testing.T) {
	e := newModEnv(t)
	u := e.user("user")
	code, body := e.call(u, "POST", "/api/threads", map[string]any{"title": "Something MAYBE odd", "body": "body body body"})
	if code != http.StatusCreated {
		t.Fatalf("got %d %v", code, body)
	}
	id := num(body["id"])
	e.waitStatus("thread", id, "held")
	if e.threadCount(u) != 0 {
		t.Fatal("a held thread must disappear from public listings")
	}
	item := e.queueItemFor("thread", id)
	if item["decision"] != "review" || item["status"] != "pending" || item["title"] != "Something MAYBE odd" || item["hidden_after_publish"] != true {
		t.Fatalf("queue item: %v", item)
	}
}

func TestHiddenPostVisibleOnlyToAuthorAndModerators(t *testing.T) {
	e := newModEnv(t)
	author, other, mod := e.user("user"), e.user("user"), e.user("moderator")
	_, body := e.call(author, "POST", "/api/threads", map[string]any{"title": "Held MAYBE question", "body": "body body body"})
	id := num(body["id"])
	e.waitStatus("thread", id, "held")
	path := fmt.Sprintf("/api/threads/%d", id)
	if code, _ := e.call(other, "GET", path, nil); code != http.StatusNotFound {
		t.Fatalf("other user should get 404, got %d", code)
	}
	if code, got := e.call(author, "GET", path, nil); code != http.StatusOK || got["thread"].(map[string]any)["moderation_status"] != "held" {
		t.Fatalf("author: %d %v", code, got)
	}
	if code, _ := e.call(mod, "GET", path, nil); code != http.StatusOK {
		t.Fatalf("moderator: %d", code)
	}
}

func TestComments(t *testing.T) {
	e := newModEnv(t)
	author, other := e.user("user"), e.user("user")
	_, th := e.call(author, "POST", "/api/threads", map[string]any{"title": "A fine question", "body": "A fine body of text"})
	tid := num(th["id"])
	path := fmt.Sprintf("/api/threads/%d/comments", tid)

	if code, _ := e.call(other, "POST", path, map[string]any{"body": "a helpful answer"}); code != http.StatusCreated {
		t.Fatalf("allowed comment: %d", code)
	}
	code, body := e.call(other, "POST", path, map[string]any{"body": "BADWORD answer"})
	if code != http.StatusAccepted || body["decision"] != "block" {
		t.Fatalf("blocked comment: %d %v", code, body)
	}
	item, _ := e.pg.GetModerationItem(context.Background(), num(body["queue_id"]))
	if item.Kind != "comment" || item.ThreadID == nil || *item.ThreadID != tid || item.ThreadTitle != "A fine question" {
		t.Fatalf("queued comment: %+v", item)
	}
	_, held := e.call(other, "POST", path, map[string]any{"body": "MAYBE rude answer"})
	e.waitStatus("comment", num(held["id"]), "held")
	if e.commentCount(other) != 1 {
		t.Fatalf("only the allowed comment may be public, have %d", e.commentCount(other))
	}
	// Thread page: the held comment is shown to its author only.
	countComments := func(u modUser) int {
		_, got := e.call(u, "GET", fmt.Sprintf("/api/threads/%d", tid), nil)
		return len(got["comments"].([]any))
	}
	if n := countComments(author); n != 1 {
		t.Fatalf("thread author should see 1 comment, sees %d", n)
	}
	if n := countComments(other); n != 2 {
		t.Fatalf("comment author should see 2 comments, sees %d", n)
	}

	// A locked thread refuses new comments before anything is sent to the AI or the queue.
	mod := e.user("moderator")
	if code, _ := e.call(mod, "POST", fmt.Sprintf("/api/threads/%d/lock", tid), map[string]any{"locked": true}); code != http.StatusNoContent {
		t.Fatalf("lock: %d", code)
	}
	hits := atomic.LoadInt32(&e.mlHits)
	if code, _ := e.call(other, "POST", path, map[string]any{"body": "BADWORD again"}); code != http.StatusLocked {
		t.Fatalf("locked thread should give 423, got %d", code)
	}
	if atomic.LoadInt32(&e.mlHits) != hits {
		t.Fatal("locked thread must not call the ML service")
	}
	// A comment on a thread that does not exist is a plain 404, not a queue row.
	if code, _ := e.call(other, "POST", "/api/threads/99999999/comments", map[string]any{"body": "BADWORD"}); code != http.StatusNotFound {
		t.Fatalf("missing thread should give 404, got %d", code)
	}
}

func TestMLDownPublishesThenHidesForReview(t *testing.T) {
	e := newModEnv(t)
	u := e.user("user")
	e.mlMode.Store("down")
	code, body := e.call(u, "POST", "/api/threads", map[string]any{"title": "Question while ML is off", "body": "text text text"})
	if code != http.StatusCreated {
		t.Fatalf("got %d %v", code, body)
	}
	id := num(body["id"])
	e.waitStatus("thread", id, "held")
	if item := e.queueItemFor("thread", id); item["reason"] != "moderation_unavailable" || item["decision"] != "review" {
		t.Fatalf("queue item: %v", item)
	}
}

func TestModerationDisabledPublishesWithoutCallingML(t *testing.T) {
	e := newModEnv(t)
	e.h.ModCfg.Enabled = false
	u := e.user("user")
	hits := atomic.LoadInt32(&e.mlHits)
	code, body := e.call(u, "POST", "/api/threads", map[string]any{"title": "BADWORD but disabled", "body": "body body body"})
	if code != http.StatusCreated || body["moderation_status"] != "ok" {
		t.Fatalf("got %d %v", code, body)
	}
	if atomic.LoadInt32(&e.mlHits) != hits {
		t.Fatal("ML must not be called when moderation is disabled")
	}
}

func TestTooLongTextGoesToReview(t *testing.T) {
	e := newModEnv(t)
	u := e.user("user")
	hits := atomic.LoadInt32(&e.mlHits)
	code, body := e.call(u, "POST", "/api/threads", map[string]any{"title": "Very long question", "body": strings.Repeat("x", maxModerationChars+10)})
	if code != http.StatusCreated {
		t.Fatalf("got %d %v", code, body)
	}
	e.waitStatus("thread", num(body["id"]), "held")
	if atomic.LoadInt32(&e.mlHits) != hits {
		t.Fatal("text over the ML limit must not be sent to ML")
	}
}

func TestQueueIsForModeratorsOnly(t *testing.T) {
	e := newModEnv(t)
	u, mod := e.user("user"), e.user("moderator")
	if code, _ := e.call(u, "GET", "/api/moderation/queue", nil); code != http.StatusForbidden {
		t.Fatalf("plain user: %d", code)
	}
	if code, _ := e.call(u, "POST", "/api/moderation/queue/1/approve", nil); code != http.StatusForbidden {
		t.Fatalf("plain user approve: %d", code)
	}
	if code, _ := e.call(u, "POST", "/api/moderation/queue/1/reject", nil); code != http.StatusForbidden {
		t.Fatalf("plain user reject: %d", code)
	}
	if code, body := e.call(mod, "GET", "/api/moderation/queue?status=pending", nil); code != http.StatusOK || body["items"] == nil {
		t.Fatalf("moderator: %d %v", code, body)
	}
	if code, _ := e.call(mod, "GET", "/api/moderation/queue?status=bogus", nil); code != http.StatusBadRequest {
		t.Fatalf("bad status: %d", code)
	}
}

func TestQueueDateFilter(t *testing.T) {
	e := newModEnv(t)
	u, mod := e.user("user"), e.user("moderator")
	_, q := e.call(u, "POST", "/api/threads", map[string]any{"title": "Dated BADWORD post", "body": "body body body"})
	qid := num(q["queue_id"])
	has := func(query string) bool {
		code, list := e.call(mod, "GET", "/api/moderation/queue?status=all&page_size=100&"+query, nil)
		if code != http.StatusOK {
			t.Fatalf("%s: %d %v", query, code, list)
		}
		for _, it := range list["items"].([]any) {
			if num(it.(map[string]any)["id"]) == qid {
				return true
			}
		}
		return false
	}
	today := time.Now().UTC().Format("2006-01-02")
	if !has("from=" + today + "&to=" + today) {
		t.Fatal("today's item must match from=today&to=today")
	}
	if has("to=2000-01-01") || has("from=2999-01-01") {
		t.Fatal("item must not match a range that excludes it")
	}
	if code, _ := e.call(mod, "GET", "/api/moderation/queue?from=yesterday", nil); code != http.StatusBadRequest {
		t.Fatalf("bad date: %d", code)
	}
}

func TestApproveBlockedThreadPublishesAsOriginalAuthor(t *testing.T) {
	e := newModEnv(t)
	author, mod := e.user("user"), e.user("admin")
	_, q := e.call(author, "POST", "/api/threads", map[string]any{"title": "Held BADWORD title", "body": "held body text", "tags": []string{"one", "two"}})
	qid := num(q["queue_id"])

	code, item := e.call(mod, "POST", fmt.Sprintf("/api/moderation/queue/%d/approve", qid), map[string]any{"note": "fine, it was a quote"})
	if code != http.StatusOK || item["status"] != "approved" || num(item["published_thread_id"]) == 0 || item["reviewer_name"] != mod.name || item["admin_note"] != "fine, it was a quote" {
		t.Fatalf("approve: %d %v", code, item)
	}
	th, err := e.pg.GetThread(context.Background(), num(item["published_thread_id"]))
	if err != nil {
		t.Fatal(err)
	}
	if th.UserID != author.id || th.Title != "Held BADWORD title" || len(th.Tags) != 2 || th.ModerationStatus != "ok" {
		t.Fatalf("published thread: %+v", th)
	}
	// Decided items cannot be decided again.
	if code, _ := e.call(mod, "POST", fmt.Sprintf("/api/moderation/queue/%d/approve", qid), nil); code != http.StatusConflict {
		t.Fatalf("second approve: %d", code)
	}
	if code, _ := e.call(mod, "POST", fmt.Sprintf("/api/moderation/queue/%d/reject", qid), nil); code != http.StatusConflict {
		t.Fatalf("reject after approve: %d", code)
	}
	if e.threadCount(author) != 1 {
		t.Fatal("exactly one thread")
	}
}

func TestApproveHeldThreadShowsItAgain(t *testing.T) {
	e := newModEnv(t)
	author, mod := e.user("user"), e.user("moderator")
	_, body := e.call(author, "POST", "/api/threads", map[string]any{"title": "Borderline MAYBE thread", "body": "body body body"})
	id := num(body["id"])
	e.waitStatus("thread", id, "held")
	item := e.queueItemFor("thread", id)
	code, got := e.call(mod, "POST", fmt.Sprintf("/api/moderation/queue/%d/approve", num(item["id"])), nil)
	if code != http.StatusOK || got["status"] != "approved" || num(got["published_thread_id"]) != id {
		t.Fatalf("approve: %d %v", code, got)
	}
	e.waitStatus("thread", id, "ok")
	if e.threadCount(author) != 1 {
		t.Fatal("approving must show the same thread again, not create a copy")
	}
}

func TestApproveHeldCommentShowsItAgain(t *testing.T) {
	e := newModEnv(t)
	owner, writer, mod := e.user("user"), e.user("user"), e.user("moderator")
	_, th := e.call(owner, "POST", "/api/threads", map[string]any{"title": "Thread for comments", "body": "thread body text"})
	tid := num(th["id"])
	_, c := e.call(writer, "POST", fmt.Sprintf("/api/threads/%d/comments", tid), map[string]any{"body": "MAYBE this is rude"})
	cid := num(c["id"])
	e.waitStatus("comment", cid, "held")
	item := e.queueItemFor("comment", cid)
	if code, _ := e.call(mod, "POST", fmt.Sprintf("/api/moderation/queue/%d/approve", num(item["id"])), nil); code != http.StatusOK {
		t.Fatalf("approve: %d", code)
	}
	e.waitStatus("comment", cid, "ok")
	comments, err := e.pg.ListComments(context.Background(), tid)
	if err != nil || len(comments) != 1 || comments[0].UserID != writer.id || comments[0].Body != "MAYBE this is rude" {
		t.Fatalf("comments: %v %+v", err, comments)
	}
}

func TestRejectBlockedPostNeverPublishes(t *testing.T) {
	e := newModEnv(t)
	author, mod := e.user("user"), e.user("moderator")
	_, q := e.call(author, "POST", "/api/threads", map[string]any{"title": "Bad BADWORD thread", "body": "body body body"})
	code, item := e.call(mod, "POST", fmt.Sprintf("/api/moderation/queue/%d/reject", num(q["queue_id"])), map[string]any{"note": "against the rules"})
	if code != http.StatusOK || item["status"] != "rejected" || item["admin_note"] != "against the rules" {
		t.Fatalf("reject: %d %v", code, item)
	}
	if e.threadCount(author) != 0 {
		t.Fatal("rejected thread must not exist")
	}
	// It stays in history with the human decision (training data) and out of the pending list.
	_, list := e.call(mod, "GET", "/api/moderation/queue?status=rejected&page_size=100", nil)
	found := false
	for _, it := range list["items"].([]any) {
		if num(it.(map[string]any)["id"]) == num(q["queue_id"]) {
			found = true
		}
	}
	if !found {
		t.Fatal("rejected item must be listed under status=rejected")
	}
	_, pend := e.call(mod, "GET", "/api/moderation/queue?status=pending&page_size=100", nil)
	for _, it := range pend["items"].([]any) {
		if num(it.(map[string]any)["id"]) == num(q["queue_id"]) {
			t.Fatal("rejected item must not be pending")
		}
	}
}

func TestRejectHeldThreadKeepsItHiddenAndUneditable(t *testing.T) {
	e := newModEnv(t)
	author, mod := e.user("user"), e.user("moderator")
	_, body := e.call(author, "POST", "/api/threads", map[string]any{"title": "Rude MAYBE thread", "body": "body body body"})
	id := num(body["id"])
	e.waitStatus("thread", id, "held")
	// While held, the author cannot edit it (that would sidestep the moderator).
	if code, _ := e.call(author, "PATCH", fmt.Sprintf("/api/threads/%d", id), map[string]any{"title": "Polite now", "body": "polite body"}); code != http.StatusConflict {
		t.Fatalf("edit while held: %d", code)
	}
	item := e.queueItemFor("thread", id)
	if code, _ := e.call(mod, "POST", fmt.Sprintf("/api/moderation/queue/%d/reject", num(item["id"])), nil); code != http.StatusOK {
		t.Fatalf("reject: %d", code)
	}
	e.waitStatus("thread", id, "rejected")
	if e.threadCount(author) != 0 {
		t.Fatal("rejected thread must stay hidden")
	}
	if code, _ := e.call(author, "PATCH", fmt.Sprintf("/api/threads/%d", id), map[string]any{"title": "Polite now", "body": "polite body"}); code != http.StatusConflict {
		t.Fatalf("edit after reject: %d", code)
	}
}

func TestApproveBlockedCommentOnLockedThreadKeepsItemPending(t *testing.T) {
	e := newModEnv(t)
	owner, writer, mod := e.user("user"), e.user("user"), e.user("moderator")
	_, th := e.call(owner, "POST", "/api/threads", map[string]any{"title": "Soon locked thread", "body": "thread body text"})
	tid := num(th["id"])
	_, q := e.call(writer, "POST", fmt.Sprintf("/api/threads/%d/comments", tid), map[string]any{"body": "BADWORD later"})
	e.call(mod, "POST", fmt.Sprintf("/api/threads/%d/lock", tid), map[string]any{"locked": true})
	code, _ := e.call(mod, "POST", fmt.Sprintf("/api/moderation/queue/%d/approve", num(q["queue_id"])), nil)
	if code != http.StatusLocked {
		t.Fatalf("got %d", code)
	}
	item, _ := e.pg.GetModerationItem(context.Background(), num(q["queue_id"]))
	if item.Status != "pending" || item.ReviewedBy != nil {
		t.Fatalf("item must be back to pending: %+v", item)
	}
	// After unlocking it can be approved.
	e.call(mod, "POST", fmt.Sprintf("/api/threads/%d/lock", tid), map[string]any{"locked": false})
	if code, _ := e.call(mod, "POST", fmt.Sprintf("/api/moderation/queue/%d/approve", num(q["queue_id"])), nil); code != http.StatusOK {
		t.Fatalf("approve after unlock: %d", code)
	}
}

func TestApproveRefusedForBannedAuthor(t *testing.T) {
	e := newModEnv(t)
	author, mod := e.user("user"), e.user("moderator")
	_, body := e.call(author, "POST", "/api/threads", map[string]any{"title": "Held MAYBE thread", "body": "body body body"})
	id := num(body["id"])
	e.waitStatus("thread", id, "held")
	if err := e.pg.SetUserBanned(context.Background(), author.id, true); err != nil {
		t.Fatal(err)
	}
	item := e.queueItemFor("thread", id)
	if code, _ := e.call(mod, "POST", fmt.Sprintf("/api/moderation/queue/%d/approve", num(item["id"])), nil); code != http.StatusConflict {
		t.Fatalf("got %d", code)
	}
	if e.threadCount(author) != 0 {
		t.Fatal("nothing may be shown for a banned author")
	}
}

func TestParallelApprovePublishesOnce(t *testing.T) {
	e := newModEnv(t)
	author, mod1, mod2 := e.user("user"), e.user("moderator"), e.user("admin")
	_, q := e.call(author, "POST", "/api/threads", map[string]any{"title": "Race BADWORD thread", "body": "body body body"})
	path := fmt.Sprintf("/api/moderation/queue/%d/approve", num(q["queue_id"]))
	var wg sync.WaitGroup
	codes := make(chan int, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(u modUser) {
			defer wg.Done()
			c, _ := e.call(u, "POST", path, nil)
			codes <- c
		}([]modUser{mod1, mod2}[i%2])
	}
	wg.Wait()
	close(codes)
	ok, conflict := 0, 0
	for c := range codes {
		switch c {
		case http.StatusOK:
			ok++
		case http.StatusConflict:
			conflict++
		default:
			t.Fatalf("unexpected status %d", c)
		}
	}
	if ok != 1 || conflict != 7 || e.threadCount(author) != 1 {
		t.Fatalf("ok=%d conflict=%d threads=%d", ok, conflict, e.threadCount(author))
	}
}

func TestEditsAreModeratedToo(t *testing.T) {
	e := newModEnv(t)
	u := e.user("user")
	_, th := e.call(u, "POST", "/api/threads", map[string]any{"title": "Original title", "body": "original body text"})
	tid := num(th["id"])
	e.waitStatus("thread", tid, "ok")
	code, body := e.call(u, "PATCH", fmt.Sprintf("/api/threads/%d", tid), map[string]any{"title": "Original title", "body": "now BADWORD inside"})
	if code != http.StatusUnprocessableEntity || body["decision"] != "block" {
		t.Fatalf("bad edit: %d %v", code, body)
	}
	got, _ := e.pg.GetThread(context.Background(), tid)
	if got.Body != "original body text" {
		t.Fatalf("thread must be unchanged, body=%q", got.Body)
	}
	if code, _ := e.call(u, "PATCH", fmt.Sprintf("/api/threads/%d", tid), map[string]any{"title": "Original title", "body": "a polite edit"}); code != http.StatusOK {
		t.Fatalf("good edit: %d", code)
	}
	e.waitStatus("thread", tid, "ok")
	// An edit that only the full AI check catches: saved, then hidden.
	if code, _ := e.call(u, "PATCH", fmt.Sprintf("/api/threads/%d", tid), map[string]any{"title": "Original title", "body": "MAYBE rude edit"}); code != http.StatusOK {
		t.Fatalf("borderline edit: %d", code)
	}
	e.waitStatus("thread", tid, "held")

	_, th2 := e.call(u, "POST", "/api/threads", map[string]any{"title": "Second question", "body": "second body text"})
	tid2 := num(th2["id"])
	_, c := e.call(u, "POST", fmt.Sprintf("/api/threads/%d/comments", tid2), map[string]any{"body": "fine comment"})
	cid := num(c["id"])
	e.waitStatus("comment", cid, "ok")
	if code, _ := e.call(u, "PATCH", fmt.Sprintf("/api/comments/%d", cid), map[string]any{"body": "BADWORD edit"}); code != http.StatusUnprocessableEntity {
		t.Fatalf("bad comment edit: %d", code)
	}
	// With the ML service down the edit is saved and then held for review.
	e.mlMode.Store("down")
	if code, _ := e.call(u, "PATCH", fmt.Sprintf("/api/comments/%d", cid), map[string]any{"body": "edit while ML down"}); code != http.StatusOK {
		t.Fatalf("edit while ML down: %d", code)
	}
	e.waitStatus("comment", cid, "held")
}

func TestResumeFinishesInterruptedChecks(t *testing.T) {
	e := newModEnv(t)
	u := e.user("user")
	// A post left in "checking" (as if the server stopped mid-check).
	th, err := e.pg.CreateThread(context.Background(), u.id, store.ThreadInput{Title: "Interrupted check", Body: "body body body"})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.pg.SetPostModerationStatus(context.Background(), "thread", th.ID, "checking"); err != nil {
		t.Fatal(err)
	}
	e.h.ResumeModerationChecks(context.Background())
	e.waitStatus("thread", th.ID, "ok")
}

func TestStaffEmailMayRegisterFromAnyDomain(t *testing.T) {
	e := newModEnv(t)
	h := New(e.pg, e.secret, mailer.New(), t.TempDir(), "http://test", []string{"sdu.edu.kz"})
	n := time.Now().UnixNano() % 1_000_000_000
	staff := fmt.Sprintf("helpdesk%d@gmail.com", n)
	h.StaffRoles = map[string]string{staff: "admin"}
	srv := httptest.NewServer(http.HandlerFunc(h.Register))
	t.Cleanup(srv.Close)
	register := func(email, name string) (int, map[string]any) {
		b, _ := json.Marshal(map[string]string{"email": email, "password": "long-enough-pass", "display_name": name})
		resp, err := http.Post(srv.URL, "application/json", bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		out := map[string]any{}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}
	if code, body := register(fmt.Sprintf("student%d@gmail.com", n), fmt.Sprintf("st%d", n)); code != http.StatusBadRequest {
		t.Fatalf("a plain gmail student must be refused, got %d %v", code, body)
	}
	code, body := register(staff, fmt.Sprintf("hd%d", n))
	if code != http.StatusCreated {
		t.Fatalf("staff gmail: %d %v", code, body)
	}
	if role := body["user"].(map[string]any)["role"]; role != "admin" {
		t.Fatalf("staff should be an admin right away, role=%v", role)
	}
	if code, _ := register(fmt.Sprintf("s%d@sdu.edu.kz", n), fmt.Sprintf("sdu%d", n)); code != http.StatusCreated {
		t.Fatalf("an sdu.edu.kz student must still register, got %d", code)
	}
}

func TestQueueSortNewestOrOldest(t *testing.T) {
	e := newModEnv(t)
	u, mod := e.user("user"), e.user("admin")
	_, first := e.call(u, "POST", "/api/threads", map[string]any{"title": "First BADWORD post", "body": "body body body"})
	time.Sleep(20 * time.Millisecond)
	_, second := e.call(u, "POST", "/api/threads", map[string]any{"title": "Second BADWORD post", "body": "body body body"})
	// Walks every page: the test database keeps items from earlier runs, so
	// these two may be far from the first page when sorted oldest first.
	order := func(sort string) []int64 {
		var ids []int64
		for page := 1; ; page++ {
			code, list := e.call(mod, "GET", fmt.Sprintf("/api/moderation/queue?status=all&page_size=100&page=%d&sort=%s", page, sort), nil)
			if code != http.StatusOK {
				t.Fatalf("sort=%s: %d", sort, code)
			}
			items := list["items"].([]any)
			for _, it := range items {
				id := num(it.(map[string]any)["id"])
				if id == num(first["queue_id"]) || id == num(second["queue_id"]) {
					ids = append(ids, id)
				}
			}
			if len(items) < 100 {
				return ids
			}
		}
	}
	if got := order("new"); len(got) != 2 || got[0] != num(second["queue_id"]) {
		t.Fatalf("newest first: %v", got)
	}
	if got := order("old"); len(got) != 2 || got[0] != num(first["queue_id"]) {
		t.Fatalf("oldest first: %v", got)
	}
	if code, _ := e.call(mod, "GET", "/api/moderation/queue?sort=sideways", nil); code != http.StatusBadRequest {
		t.Fatalf("bad sort: %d", code)
	}
}
