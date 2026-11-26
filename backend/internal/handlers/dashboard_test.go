package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"campus-forum/internal/middleware"
	"campus-forum/internal/mlclient"
)

// Admin dashboard: staff only, one entry per day of the period, and the
// counts move with what students do in the chat. The test database is shared
// with other tests, so it compares before and after instead of exact totals.
// Real database, skipped without TEST_DATABASE_URL.
func TestAdminDashboard(t *testing.T) {
	e := newReviewsEnv(t)
	authMw := middleware.Auth(e.secret)
	mux := e.srv.Config.Handler.(*http.ServeMux)
	mux.Handle("GET /api/admin/dashboard", authMw(http.HandlerFunc(e.h.AdminDashboard)))
	mux.Handle("POST /api/chat/ask", authMw(http.HandlerFunc(e.h.ChatAsk)))
	mux.Handle("PUT /api/chat/messages/{id}/rating", authMw(http.HandlerFunc(e.h.RateChatMessage)))

	ml := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/generate-answer" {
			e.fakeML().ServeHTTP(w, r)
			return
		}
		var in struct {
			Question string `json:"question"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		status, basis := "answered", "general"
		if strings.Contains(in.Question, "unknowable") {
			status, basis = "fallback", "none"
		}
		writeJSON(w, http.StatusOK, map[string]any{"request_id": "rid", "status": status, "answer": "An answer.",
			"forum_answer": nil, "ai_explanation": "An answer.", "language": "en", "basis": basis,
			"reason": nil, "source": nil, "source_type": nil, "retrieval_score": nil})
	}))
	t.Cleanup(ml.Close)
	e.h.ML = mlclient.New(ml.URL, 5*time.Second)
	e.h.AIDailyQuota = 1000

	admin := e.user("admin")
	dash := func() map[string]any {
		t.Helper()
		code, out := e.call(admin, http.MethodGet, "/api/admin/dashboard?days=7", nil)
		if code != http.StatusOK {
			t.Fatalf("dashboard: %d %v", code, out)
		}
		return out
	}
	totals := func(d map[string]any, key string) int64 { return num(d["totals"].(map[string]any)[key]) }

	if code, _ := e.call(e.user("user"), http.MethodGet, "/api/admin/dashboard", nil); code != http.StatusForbidden {
		t.Fatalf("a student got %d", code)
	}
	if code, _ := e.call(admin, http.MethodGet, "/api/admin/dashboard?days=8", nil); code != http.StatusBadRequest {
		t.Fatalf("days=8: %d", code)
	}

	before := dash()
	daily := list(before["daily"])
	if len(daily) != 7 || daily[6]["day"] != chatDay().Format(time.DateOnly) {
		t.Fatalf("daily: %v", daily)
	}

	// Two students ask the same question (different case and "?"), one asks twice;
	// one question the AI can't answer; one answer gets 👍.
	question := "Where is the dashboard test room " + time.Now().Format("150405.000")
	s1, s2 := e.user("user"), e.user("user")
	for _, ask := range []struct {
		u modUser
		q string
	}{{s1, question + "?"}, {s1, strings.ToUpper(question)}, {s2, question}, {s2, "an unknowable question"}} {
		code, out := e.call(ask.u, http.MethodPost, "/api/chat/ask", map[string]any{"question": ask.q})
		if code != http.StatusOK {
			t.Fatalf("ask %q: %d %v", ask.q, code, out)
		}
		if ask.q == question+"?" {
			if code, _ := e.call(s1, http.MethodPut, "/api/chat/messages/"+jsonNum(out["message_id"])+"/rating", map[string]any{"value": 1}); code != http.StatusNoContent && code != http.StatusOK {
				t.Fatalf("rate: %d", code)
			}
		}
		if ask.u == s2 && ask.q == question {
			if code, _ := e.call(s2, http.MethodPut, "/api/chat/messages/"+jsonNum(out["message_id"])+"/rating", map[string]any{"value": -1}); code != http.StatusNoContent && code != http.StatusOK {
				t.Fatalf("rate 👎: %d", code)
			}
		}
	}

	after := dash()
	for key, want := range map[string]int64{"chat_questions": 4, "ai_answers": 3, "ai_answers_today": 3, "unanswered": 1, "liked": 1, "disliked": 1, "active_students": 2, "new_students": 2, "total_students": 2} {
		if got := totals(after, key) - totals(before, key); got < want {
			t.Errorf("%s grew by %v, want at least %v", key, got, want)
		}
	}
	today := list(after["daily"])[6]
	if num(today["answered"])-num(list(before["daily"])[6]["answered"]) < 3 || num(today["unanswered"])-num(list(before["daily"])[6]["unanswered"]) < 1 {
		t.Errorf("today in the chart: before %v, after %v", list(before["daily"])[6], today)
	}
	found := false
	for _, q := range list(after["top_questions"]) {
		if strings.EqualFold(strings.TrimSuffix(q["question"].(string), "?"), question) {
			found = true
			if num(q["students"]) != 2 || num(q["asks"]) != 3 {
				t.Errorf("top question counts: %v", q)
			}
		}
	}
	if !found {
		t.Errorf("the question asked 3 times is not among the top: %v", after["top_questions"])
	}
	// 👎 answers are listed; today's AI calls grew by the 3 answered questions; the quota is passed on.
	if disliked := list(after["disliked"]); len(disliked) == 0 || !strings.EqualFold(disliked[0]["question"].(string), question) {
		t.Errorf("disliked: %v", after["disliked"])
	}
	calls := func(d map[string]any) int64 { return num(d["ai_calls_today"].(map[string]any)["chat"]) }
	if got := calls(after) - calls(before); got != 3 || num(after["ai_quota"]) != 1000 {
		t.Errorf("ai calls today grew by %d, quota %v", got, after["ai_quota"])
	}
	if _, ok := after["previous"].(map[string]any)["chat_questions"]; !ok {
		t.Errorf("no previous period: %v", after["previous"])
	}
	unanswered := list(after["unanswered"])
	if len(unanswered) == 0 || unanswered[0]["question"] != "an unknowable question" {
		t.Errorf("unanswered: %v", unanswered)
	}
}
