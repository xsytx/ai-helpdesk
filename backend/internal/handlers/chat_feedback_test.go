package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"campus-forum/internal/mlclient"
)

// Follow-up context, 👍/👎 and the admin "AI chat" lists. Real database,
// skipped without TEST_DATABASE_URL.

// fakeAnswerML answers every question and remembers the history it got;
// a question containing UNKNOWN gets basis "none" (the AI had no answer).
type fakeAnswerML struct {
	mu      sync.Mutex
	history [][]mlclient.HistoryItem
}

func (f *fakeAnswerML) install(t *testing.T, e *modEnv) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Question string                 `json:"question"`
			History  []mlclient.HistoryItem `json:"history"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		f.mu.Lock()
		f.history = append(f.history, in.History)
		f.mu.Unlock()
		basis, status := "general", "answered"
		if strings.Contains(in.Question, "UNKNOWN") {
			basis, status = "none", "fallback"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"request_id": "rid", "status": status, "answer": "answer to " + in.Question, "language": "en", "basis": basis,
		})
	}))
	t.Cleanup(srv.Close)
	e.h.ML = mlclient.New(srv.URL, 5*time.Second)
}

func (f *fakeAnswerML) last() []mlclient.HistoryItem {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.history[len(f.history)-1]
}

func TestFollowUpQuestionGetsConversationHistory(t *testing.T) {
	e := newChatEnv(t)
	ml := &fakeAnswerML{}
	ml.install(t, e)
	u := e.user("user")

	_, conv := e.ask(u, "How do I get a dorm room?", 0)
	if h := ml.last(); len(h) != 0 {
		t.Fatalf("a new chat has no history, got %v", h)
	}
	e.ask(u, "And how much is it?", conv)
	h := ml.last()
	if len(h) != 2 || h[0].Role != "user" || h[0].Text != "How do I get a dorm room?" || h[1].Role != "assistant" {
		t.Fatalf("history %+v", h)
	}
	// Only the last few messages go to the model.
	for i := 0; i < 5; i++ {
		e.ask(u, fmt.Sprintf("question %d", i), conv)
	}
	if h := ml.last(); len(h) != chatHistoryMessages || h[len(h)-1].Text != "answer to question 3" {
		t.Fatalf("history should be the last %d messages, got %d: %+v", chatHistoryMessages, len(h), h)
	}
}

func TestRatingsAndAdminChatInsights(t *testing.T) {
	e := newChatEnv(t)
	ml := &fakeAnswerML{}
	ml.install(t, e)
	alice, bob, admin := e.user("user"), e.user("user"), e.user("admin")
	tag := fmt.Sprintf("x%d", time.Now().UnixNano()%1_000_000_000)

	// 👍/👎 on your own answer only.
	code, out := e.call(alice, http.MethodPost, "/api/chat/ask", map[string]any{"question": "Bad answer about " + tag})
	msgID := num(out["message_id"])
	convID := num(out["conversation"].(map[string]any)["id"])
	if code != http.StatusOK || msgID == 0 {
		t.Fatalf("ask: %d %v", code, out)
	}
	rate := func(u modUser, id int64, v any) int {
		code, _ := e.call(u, http.MethodPut, fmt.Sprintf("/api/chat/messages/%d/rating", id), map[string]any{"value": v})
		return code
	}
	if c := rate(alice, msgID, -1); c != http.StatusNoContent {
		t.Fatalf("rate: %d", c)
	}
	if c := rate(bob, msgID, 1); c != http.StatusNotFound {
		t.Fatalf("rating someone else's answer: %d, want 404", c)
	}
	if c := rate(alice, msgID, 5); c != http.StatusBadRequest {
		t.Fatalf("value 5: %d, want 400", c)
	}
	_, msgs := e.call(alice, http.MethodGet, fmt.Sprintf("/api/chat/conversations/%d/messages", convID), nil)
	list := msgs["messages"].([]any)
	if num(list[1].(map[string]any)["rating"]) != -1 {
		t.Fatalf("rating not in history: %v", list[1])
	}
	if c := rate(alice, num(list[0].(map[string]any)["id"]), 1); c != http.StatusNotFound {
		t.Fatalf("rating a question (not an answer): %d, want 404", c)
	}

	// Something the AI couldn't answer, and a question two students ask.
	e.call(alice, http.MethodPost, "/api/chat/ask", map[string]any{"question": "UNKNOWN thing " + tag})
	e.call(alice, http.MethodPost, "/api/chat/ask", map[string]any{"question": "Where is the gym " + tag + "?"})
	e.call(bob, http.MethodPost, "/api/chat/ask", map[string]any{"question": "  where is the GYM " + tag})
	e.call(bob, http.MethodPost, "/api/chat/ask", map[string]any{"question": "Only bob asks " + tag})

	insights := func(u modUser, kind string) (int, []map[string]any) {
		code, out := e.call(u, http.MethodGet, "/api/admin/chat-insights?kind="+kind, nil)
		var mine []map[string]any
		if items, ok := out["items"].([]any); ok {
			for _, it := range items {
				m := it.(map[string]any)
				if strings.Contains(fmt.Sprint(m["question"]), tag) {
					mine = append(mine, m)
				}
			}
		}
		return code, mine
	}
	if code, _ := insights(alice, "disliked"); code != http.StatusForbidden {
		t.Fatalf("student sees insights: %d, want 403", code)
	}
	if _, items := insights(admin, "disliked"); len(items) != 1 || items[0]["context"] != nil || items[0]["question"] != "Bad answer about "+tag || items[0]["answer"] != "answer to Bad answer about "+tag {
		t.Fatalf("disliked: %v", items)
	}
	if _, items := insights(admin, "unanswered"); len(items) != 1 || items[0]["question"] != "UNKNOWN thing "+tag {
		t.Fatalf("unanswered: %v", items)
	}
	if _, items := insights(admin, "frequent"); len(items) != 1 || num(items[0]["students"]) != 2 {
		t.Fatalf("frequent (same question, two students, typed differently): %v", items)
	}
	if code, _ := insights(admin, "everything"); code != http.StatusBadRequest {
		t.Fatalf("unknown kind: %d", code)
	}
	// Taking a 👎 back removes it from the list.
	rate(alice, msgID, 0)
	if _, items := insights(admin, "disliked"); len(items) != 0 {
		t.Fatalf("cleared rating still listed: %v", items)
	}
	// A 👎 follow-up shows the question before it.
	_, out = e.call(alice, http.MethodPost, "/api/chat/ask", map[string]any{"question": "And how much " + tag + "?", "conversation_id": convID})
	rate(alice, num(out["message_id"]), -1)
	if _, items := insights(admin, "disliked"); len(items) != 1 || items[0]["context"] != "Bad answer about "+tag {
		t.Fatalf("follow-up context: %v", items)
	}
}
