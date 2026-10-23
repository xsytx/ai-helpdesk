package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"campus-forum/internal/middleware"
	"campus-forum/internal/mlclient"
)

// Chat conversation tests run against the real database like the moderation
// tests (skipped without TEST_DATABASE_URL), with a fake /generate-answer.

func newChatEnv(t *testing.T) *modEnv {
	t.Helper()
	e := newModEnv(t)
	ml := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Question string `json:"question"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"request_id": "rid", "status": "answered", "answer": "answer to " + in.Question,
			"language": "en", "basis": "general",
		})
	}))
	t.Cleanup(ml.Close)
	e.h.ML = mlclient.New(ml.URL, 5*time.Second)

	authMw := middleware.Auth(e.secret)
	mux := http.NewServeMux()
	mux.Handle("POST /api/chat/ask", authMw(http.HandlerFunc(e.h.ChatAsk)))
	mux.Handle("GET /api/chat/conversations", authMw(http.HandlerFunc(e.h.ListChatConversations)))
	mux.Handle("GET /api/chat/conversations/{id}/messages", authMw(http.HandlerFunc(e.h.GetChatConversationMessages)))
	mux.Handle("PATCH /api/chat/conversations/{id}", authMw(http.HandlerFunc(e.h.UpdateChatConversation)))
	mux.Handle("DELETE /api/chat/conversations/{id}", authMw(http.HandlerFunc(e.h.DeleteChatConversation)))
	mux.Handle("POST /api/chat/faq", authMw(http.HandlerFunc(e.h.ChatFAQ)))
	mux.Handle("PUT /api/chat/messages/{id}/rating", authMw(http.HandlerFunc(e.h.RateChatMessage)))
	mux.Handle("GET /api/admin/chat-insights", authMw(http.HandlerFunc(e.h.ChatInsights)))
	mux.HandleFunc("GET /api/faq", e.h.ListFAQs)
	mux.Handle("POST /api/faq", authMw(http.HandlerFunc(e.h.CreateFAQ)))
	mux.Handle("PATCH /api/faq/{id}", authMw(http.HandlerFunc(e.h.UpdateFAQ)))
	mux.Handle("DELETE /api/faq/{id}", authMw(http.HandlerFunc(e.h.DeleteFAQ)))
	mux.Handle("POST /api/faq/reorder", authMw(http.HandlerFunc(e.h.ReorderFAQs)))
	e.srv.Close()
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

func (e *modEnv) ask(u modUser, question string, convID int64) (int, int64) {
	e.t.Helper()
	body := map[string]any{"question": question}
	if convID != 0 {
		body["conversation_id"] = convID
	}
	code, out := e.call(u, http.MethodPost, "/api/chat/ask", body)
	conv, _ := out["conversation"].(map[string]any)
	return code, num(conv["id"])
}

func (e *modEnv) conversationIDs(u modUser) []int64 {
	e.t.Helper()
	code, out := e.call(u, http.MethodGet, "/api/chat/conversations", nil)
	if code != http.StatusOK {
		e.t.Fatalf("list: %d %v", code, out)
	}
	var ids []int64
	for _, c := range out["conversations"].([]any) {
		ids = append(ids, num(c.(map[string]any)["id"]))
	}
	return ids
}

func TestChatConversationsAskContinueAndPrivacy(t *testing.T) {
	e := newChatEnv(t)
	alice, bob := e.user("user"), e.user("user")

	code, first := e.ask(alice, "How do I get a dorm?", 0)
	if code != http.StatusOK || first == 0 {
		t.Fatalf("first ask: %d id=%d", code, first)
	}
	if code, again := e.ask(alice, "And how much is it?", first); code != http.StatusOK || again != first {
		t.Fatalf("continue: %d id=%d want %d", code, again, first)
	}
	_, second := e.ask(alice, "Where is the library?", 0)
	if second == first {
		t.Fatal("a question without conversation_id must start a new conversation")
	}

	// Most recently active first.
	if ids := e.conversationIDs(alice); len(ids) != 2 || ids[0] != second || ids[1] != first {
		t.Fatalf("list order %v", ids)
	}
	code, out := e.call(alice, http.MethodGet, fmt.Sprintf("/api/chat/conversations/%d/messages", first), nil)
	msgs, _ := out["messages"].([]any)
	if code != http.StatusOK || len(msgs) != 4 {
		t.Fatalf("messages: %d %v", code, out)
	}
	if conv := out["conversation"].(map[string]any); conv["title"] != "How do I get a dorm?" {
		t.Fatalf("title %v", conv["title"])
	}
	if m := msgs[0].(map[string]any); m["role"] != "user" || m["text"] != "How do I get a dorm?" {
		t.Fatalf("first message %v", m)
	}

	// Bob can't see, change, delete or write into Alice's conversation.
	if len(e.conversationIDs(bob)) != 0 {
		t.Fatal("bob sees alice's conversations")
	}
	path := fmt.Sprintf("/api/chat/conversations/%d", first)
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, path + "/messages", nil},
		{http.MethodPatch, path, map[string]any{"title": "mine"}},
		{http.MethodDelete, path, nil},
		{http.MethodPost, "/api/chat/ask", map[string]any{"question": "hi", "conversation_id": first}},
	} {
		if code, _ := e.call(bob, c.method, c.path, c.body); code != http.StatusNotFound {
			t.Fatalf("bob %s %s: %d, want 404", c.method, c.path, code)
		}
	}
	if code, out := e.call(alice, http.MethodGet, path+"/messages", nil); code != http.StatusOK || len(out["messages"].([]any)) != 4 {
		t.Fatalf("alice's conversation changed: %d %v", code, out)
	}
}

func TestChatConversationsRenamePinDelete(t *testing.T) {
	e := newChatEnv(t)
	u := e.user("user")
	_, older := e.ask(u, "first question", 0)
	_, newer := e.ask(u, "second question", 0)
	path := fmt.Sprintf("/api/chat/conversations/%d", older)

	code, out := e.call(u, http.MethodPatch, path, map[string]any{"title": "  Dorm   prices  ", "pinned": true})
	if code != http.StatusOK || out["title"] != "Dorm prices" || out["pinned"] != true {
		t.Fatalf("patch: %d %v", code, out)
	}
	if ids := e.conversationIDs(u); ids[0] != older || ids[1] != newer {
		t.Fatalf("pinned must come first: %v", ids)
	}
	for _, bad := range []map[string]any{{"title": "   "}, {"title": strings.Repeat("a", chatTitleMaxRunes+1)}, {}} {
		if code, _ := e.call(u, http.MethodPatch, path, bad); code != http.StatusBadRequest {
			t.Fatalf("patch %v: %d, want 400", bad, code)
		}
	}
	// Unpin keeps the title.
	if code, out := e.call(u, http.MethodPatch, path, map[string]any{"pinned": false}); code != http.StatusOK || out["title"] != "Dorm prices" || out["pinned"] != false {
		t.Fatalf("unpin: %d %v", code, out)
	}

	if code, _ := e.call(u, http.MethodDelete, path, nil); code != http.StatusNoContent {
		t.Fatalf("delete: %d", code)
	}
	if ids := e.conversationIDs(u); len(ids) != 1 || ids[0] != newer {
		t.Fatalf("after delete %v", ids)
	}
	if code, _ := e.call(u, http.MethodGet, path+"/messages", nil); code != http.StatusNotFound {
		t.Fatalf("deleted conversation: %d, want 404", code)
	}
	if code, _ := e.ask(u, "into the deleted one", older); code != http.StatusNotFound {
		t.Fatalf("ask into deleted conversation: %d, want 404", code)
	}
}

func TestChatConversationsRetention(t *testing.T) {
	e := newChatEnv(t)
	u := e.user("user")
	_, stale := e.ask(u, "old unpinned", 0)
	_, pinned := e.ask(u, "old pinned", 0)
	_, fresh := e.ask(u, "recent", 0)
	if code, _ := e.call(u, http.MethodPatch, fmt.Sprintf("/api/chat/conversations/%d", pinned), map[string]any{"pinned": true}); code != http.StatusOK {
		t.Fatal("pin failed")
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, e.dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	if _, err := conn.Exec(ctx, `UPDATE chat_conversations SET updated_at = now() - interval '40 days' WHERE id = ANY($1)`, []int64{stale, pinned}); err != nil {
		t.Fatal(err)
	}

	if _, err := e.pg.DeleteStaleChatConversations(ctx, time.Now().AddDate(0, 0, -30)); err != nil {
		t.Fatal(err)
	}
	ids := e.conversationIDs(u)
	if len(ids) != 2 || ids[0] != pinned || ids[1] != fresh {
		t.Fatalf("after cleanup %v (stale=%d pinned=%d fresh=%d)", ids, stale, pinned, fresh)
	}
	var left int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM chat_messages WHERE conversation_id = $1`, stale).Scan(&left); err != nil || left != 0 {
		t.Fatalf("messages of the deleted conversation: %d (%v)", left, err)
	}
}
