package handlers

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// Read-only chat links. Real database, skipped without TEST_DATABASE_URL.

func TestShareChatReadOnlyLink(t *testing.T) {
	e := newChatEnv(t)
	alice, bob := e.user("user"), e.user("user")
	_, conv := e.ask(alice, "How do I get a dorm?", 0)
	share := fmt.Sprintf("/api/chat/conversations/%d/share", conv)

	if code, _ := e.call(bob, http.MethodPost, share, nil); code != http.StatusNotFound {
		t.Fatalf("someone else's chat: %d, want 404", code)
	}
	code, out := e.call(alice, http.MethodPost, share, nil)
	token, _ := out["share_token"].(string)
	if code != http.StatusOK || len(token) < 16 {
		t.Fatalf("share: %d %v", code, out)
	}
	if _, again := e.call(alice, http.MethodPost, share, nil); again["share_token"] != token {
		t.Fatalf("sharing again must keep the same link: %v", again)
	}

	// Anyone with the link, without logging in.
	code, pub := e.call(modUser{}, http.MethodGet, "/api/shared-chats/"+token, nil)
	msgs, _ := pub["messages"].([]any)
	if code != http.StatusOK || len(msgs) != 2 || pub["conversation"].(map[string]any)["title"] != "How do I get a dorm?" {
		t.Fatalf("shared chat: %d %v", code, pub)
	}
	for _, m := range msgs {
		if _, has := m.(map[string]any)["user_id"]; has {
			t.Fatalf("a shared message must not carry the user id: %v", m)
		}
	}

	// A shared chat is not auto-deleted (the link would break).
	if _, err := e.pg.DeleteStaleChatConversations(context.Background(), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if code, _ := e.call(modUser{}, http.MethodGet, "/api/shared-chats/"+token, nil); code != http.StatusOK {
		t.Fatalf("shared chat after cleanup: %d", code)
	}

	if code, _ := e.call(alice, http.MethodDelete, share, nil); code != http.StatusNoContent {
		t.Fatalf("unshare: %d", code)
	}
	if code, _ := e.call(modUser{}, http.MethodGet, "/api/shared-chats/"+token, nil); code != http.StatusNotFound {
		t.Fatalf("old link after unshare: %d, want 404", code)
	}
}
