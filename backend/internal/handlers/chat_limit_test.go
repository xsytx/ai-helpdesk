package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"campus-forum/internal/middleware"
	"campus-forum/internal/mlclient"
)

// AI daily limit: answered questions count per student and day, the next one
// is refused with code daily_limit, deleting chats doesn't reset it, staff
// have no limit, and a new day (Almaty midnight) starts again.
// Real database, skipped without TEST_DATABASE_URL.
func TestChatDailyLimit(t *testing.T) {
	e := newReviewsEnv(t)
	authMw := middleware.Auth(e.secret)
	mux := e.srv.Config.Handler.(*http.ServeMux)
	mux.Handle("POST /api/chat/ask", authMw(http.HandlerFunc(e.h.ChatAsk)))
	mux.Handle("GET /api/chat/status", authMw(http.HandlerFunc(e.h.ChatStatus)))
	mux.Handle("DELETE /api/chat/conversations/{id}", authMw(http.HandlerFunc(e.h.DeleteChatConversation)))

	answer := "answered"
	ml := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/generate-answer":
			writeJSON(w, http.StatusOK, map[string]any{"request_id": "rid", "status": answer, "answer": "An answer.",
				"forum_answer": nil, "ai_explanation": "An answer.", "language": "en", "basis": "general",
				"reason": nil, "source": nil, "source_type": nil, "retrieval_score": nil})
		case "/health":
			writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
		default:
			e.fakeML().ServeHTTP(w, r)
		}
	}))
	t.Cleanup(ml.Close)
	e.h.ML = mlclient.New(ml.URL, 5*time.Second)
	e.h.ChatDailyLimit = 2
	today := time.Date(2026, 12, 1, 10, 0, 0, 0, almaty)
	chatNow = func() time.Time { return today }
	t.Cleanup(func() { chatNow = time.Now })

	student := e.user("user")
	ask := func(u modUser) (int, map[string]any) {
		t.Helper()
		return e.call(u, http.MethodPost, "/api/chat/ask", map[string]any{"question": "What is GPA?"})
	}
	left := func(out map[string]any) any { return out["daily_left"] }

	if _, out := e.call(student, http.MethodGet, "/api/chat/status", nil); num(out["daily_limit"]) != 2 || num(out["daily_left"]) != 2 {
		t.Fatalf("status before: %v", out)
	}
	code, first := ask(student)
	if code != http.StatusOK || num(left(first)) != 1 {
		t.Fatalf("first: %d %v", code, first)
	}
	// A failed answer (the AI had nothing) doesn't count.
	answer = "fallback"
	if code, out := ask(student); code != http.StatusOK || left(out) != nil {
		t.Fatalf("fallback: %d %v", code, out)
	}
	answer = "answered"
	if code, out := ask(student); code != http.StatusOK || num(left(out)) != 0 {
		t.Fatalf("second: %d %v", code, out)
	}
	// Deleting the chats doesn't give questions back.
	conv := first["conversation"].(map[string]any)["id"]
	if code, _ := e.call(student, http.MethodDelete, "/api/chat/conversations/"+jsonNum(conv), nil); code != http.StatusNoContent && code != http.StatusOK {
		t.Fatalf("delete chat: %d", code)
	}
	code, out := ask(student)
	if code != http.StatusTooManyRequests || out["code"] != "daily_limit" || num(out["limit"]) != 2 || num(out["used"]) != 2 {
		t.Fatalf("third: %d %v", code, out)
	}
	if out["resets_at"] != "2026-12-02T00:00:00+05:00" {
		t.Fatalf("resets at %v", out["resets_at"])
	}
	if _, st := e.call(student, http.MethodGet, "/api/chat/status", nil); num(st["daily_left"]) != 0 || st["status"] != "ok" {
		t.Fatalf("status at the limit: %v", st)
	}

	// Staff: no limit, no daily_left, but still counted.
	admin := e.user("admin")
	for i := 0; i < 3; i++ {
		if code, out := ask(admin); code != http.StatusOK || left(out) != nil {
			t.Fatalf("admin %d: %d %v", i, code, out)
		}
	}
	if n, err := e.pg.AIQuestionsOn(t.Context(), admin.id, today); err != nil || n != 3 {
		t.Fatalf("admin counted: %d %v", n, err)
	}

	// Just after midnight in Almaty (19:00 UTC the day before is still today).
	chatNow = func() time.Time { return time.Date(2026, 12, 1, 18, 59, 0, 0, time.UTC) }
	if code, _ := ask(student); code != http.StatusTooManyRequests {
		t.Fatalf("23:59 in Almaty: %d", code)
	}
	chatNow = func() time.Time { return time.Date(2026, 12, 1, 19, 1, 0, 0, time.UTC) }
	if code, out := ask(student); code != http.StatusOK || num(left(out)) != 1 {
		t.Fatalf("next day: %d %v", code, out)
	}

	// No limit set: nobody is refused, nothing left is reported.
	e.h.ChatDailyLimit = 0
	if code, out := ask(student); code != http.StatusOK || left(out) != nil {
		t.Fatalf("no limit: %d %v", code, out)
	}
}
