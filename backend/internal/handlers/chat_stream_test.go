package handlers

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"campus-forum/internal/mlclient"
)

// Streamed answers. Real database, skipped without TEST_DATABASE_URL.

// fakeStreamML streams "Hello " "world" ... and then done; with hang it
// stops after the first piece and waits (the student will press stop).
func fakeStreamML(t *testing.T, e *modEnv, hang chan struct{}) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		fl := w.(http.Flusher)
		line := func(v any) { b, _ := json.Marshal(v); w.Write(append(b, '\n')); fl.Flush() }
		line(map[string]any{"type": "delta", "text": "Hello "})
		if hang != nil {
			select {
			case <-r.Context().Done():
			case <-hang:
			}
			return
		}
		line(map[string]any{"type": "delta", "text": "wrong"})
		line(map[string]any{"type": "reset"})
		line(map[string]any{"type": "delta", "text": "Hello "})
		line(map[string]any{"type": "delta", "text": "world"})
		line(map[string]any{"type": "done", "request_id": "rid", "status": "answered", "answer": "Hello world",
			"ai_explanation": "Hello world", "language": "en", "basis": "general"})
	}))
	t.Cleanup(srv.Close)
	e.h.ML = mlclient.New(srv.URL, 5*time.Second)
}

func (e *modEnv) streamAsk(u modUser, body map[string]any, stopAfter int) (int, []map[string]any) {
	e.t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, e.srv.URL+"/api/chat/ask/stream", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+u.token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	var events []map[string]any
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		var ev map[string]any
		if json.Unmarshal(sc.Bytes(), &ev) == nil {
			events = append(events, ev)
		}
		if stopAfter > 0 && len(events) == stopAfter {
			break // "stop": close the connection
		}
	}
	return resp.StatusCode, events
}

func TestChatStreamSendsPiecesAndSaves(t *testing.T) {
	e := newChatEnv(t)
	fakeStreamML(t, e, nil)
	u := e.user("user")
	code, events := e.streamAsk(u, map[string]any{"question": "Say hello"}, 0)
	var types []string
	for _, ev := range events {
		types = append(types, fmt.Sprint(ev["type"]))
	}
	if code != http.StatusOK || strings.Join(types, ",") != "conversation,delta,delta,reset,delta,delta,done" {
		t.Fatalf("status %d, events %v", code, types)
	}
	done := events[len(events)-1]
	conv := done["conversation"].(map[string]any)
	if done["answer"] != "Hello world" || num(done["message_id"]) == 0 || conv["title"] != "Say hello" {
		t.Fatalf("done %v", done)
	}
	_, msgs := e.call(u, http.MethodGet, fmt.Sprintf("/api/chat/conversations/%d/messages", num(conv["id"])), nil)
	list := msgs["messages"].([]any)
	if len(list) != 2 || list[1].(map[string]any)["text"] != "Hello world" {
		t.Fatalf("saved %v", list)
	}
}

func TestChatStreamStopSavesPartialAnswer(t *testing.T) {
	e := newChatEnv(t)
	hang := make(chan struct{})
	defer close(hang)
	fakeStreamML(t, e, hang)
	u := e.user("user")
	_, events := e.streamAsk(u, map[string]any{"question": "Tell me a long story"}, 2) // conversation + first delta
	convID := num(events[0]["conversation"].(map[string]any)["id"])

	// The backend notices the closed connection and saves what was written.
	deadline := time.Now().Add(5 * time.Second)
	for {
		_, msgs := e.call(u, http.MethodGet, fmt.Sprintf("/api/chat/conversations/%d/messages", convID), nil)
		list := msgs["messages"].([]any)
		if len(list) == 2 {
			m := list[1].(map[string]any)
			if m["text"] != "Hello" || m["basis"] != "stopped" {
				t.Fatalf("stopped answer %v", m)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("partial answer not saved: %v", list)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func TestChatStreamUnavailableIsPlainErrorAndSavesNothing(t *testing.T) {
	e := newChatEnv(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte(`{"status":"error","error":"service_busy"}`))
	}))
	t.Cleanup(srv.Close)
	e.h.ML = mlclient.New(srv.URL, 5*time.Second)
	u := e.user("user")
	if code, _ := e.streamAsk(u, map[string]any{"question": "Anyone there?"}, 0); code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503", code)
	}
	if ids := e.conversationIDs(u); len(ids) != 0 {
		t.Fatalf("a failed question must not create a chat: %v", ids)
	}
}
