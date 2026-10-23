package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"campus-forum/internal/models"
)

// FAQ editor and instant FAQ answers in the chat (Story 12). Real database,
// skipped without TEST_DATABASE_URL.

func (e *modEnv) faqs() []models.FAQ {
	e.t.Helper()
	resp, err := http.Get(e.srv.URL + "/api/faq")
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	var out []models.FAQ
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		e.t.Fatal(err)
	}
	return out
}

func faqBody(tag string) map[string]any {
	return map[string]any{
		"question": "How do I " + tag + "?", "question_kz": "Қалай " + tag + "?", "question_ru": "Как " + tag + "?",
		"answer": "Answer " + tag, "answer_kz": "Жауап " + tag, "answer_ru": "Ответ " + tag,
		"category": "study", "pinned": true,
	}
}

func TestFAQSeedHasTranslations(t *testing.T) {
	e := newChatEnv(t)
	for _, f := range e.faqs() {
		if f.Question == "What is SDU Helpdesk?" {
			if f.QuestionRU != "Что такое SDU Helpdesk?" || f.AnswerKZ == "" || f.Category != "general" || !f.Pinned {
				t.Fatalf("seed entry not translated: %+v", f)
			}
			return
		}
	}
	t.Fatal("seed entry missing")
}

func TestFAQEditorRules(t *testing.T) {
	e := newChatEnv(t)
	student, admin := e.user("user"), e.user("admin")
	tag := fmt.Sprintf("test%d", time.Now().UnixNano())

	if code, _ := e.call(student, http.MethodPost, "/api/faq", faqBody(tag)); code != http.StatusForbidden {
		t.Fatalf("student create: %d, want 403", code)
	}
	missing := faqBody(tag)
	missing["answer_ru"] = "  "
	if code, _ := e.call(admin, http.MethodPost, "/api/faq", missing); code != http.StatusBadRequest {
		t.Fatalf("missing translation: %d, want 400", code)
	}
	badCat := faqBody(tag)
	badCat["category"] = "food"
	if code, _ := e.call(admin, http.MethodPost, "/api/faq", badCat); code != http.StatusBadRequest {
		t.Fatalf("unknown category: %d, want 400", code)
	}

	code, a := e.call(admin, http.MethodPost, "/api/faq", faqBody(tag+"a"))
	if code != http.StatusCreated {
		t.Fatalf("create: %d %v", code, a)
	}
	_, b := e.call(admin, http.MethodPost, "/api/faq", faqBody(tag+"b"))
	aID, bID := num(a["id"]), num(b["id"])
	t.Cleanup(func() {
		e.call(admin, http.MethodDelete, fmt.Sprintf("/api/faq/%d", aID), nil)
		e.call(admin, http.MethodDelete, fmt.Sprintf("/api/faq/%d", bID), nil)
	})
	list := e.faqs()
	if list[len(list)-2].ID != aID || list[len(list)-1].ID != bID {
		t.Fatal("new entries must go to the end of the list")
	}
	if code, _ := e.call(admin, http.MethodPost, "/api/faq", faqBody(tag+"a")); code != http.StatusConflict {
		t.Fatalf("duplicate question: %d, want 409", code)
	}

	edited := faqBody(tag + "a")
	edited["answer_ru"], edited["pinned"], edited["category"] = "Новый ответ", false, "campus"
	if code, out := e.call(admin, http.MethodPatch, fmt.Sprintf("/api/faq/%d", aID), edited); code != http.StatusOK ||
		out["answer_ru"] != "Новый ответ" || out["pinned"] != false || out["category"] != "campus" {
		t.Fatalf("update: %d %v", code, out)
	}

	// Reorder: b, a first; everything else keeps its order after them.
	before := e.faqs()
	if code, _ := e.call(admin, http.MethodPost, "/api/faq/reorder", map[string]any{"ids": []int64{bID, aID}}); code != http.StatusOK {
		t.Fatalf("reorder: %d", code)
	}
	after := e.faqs()
	if after[0].ID != bID || after[1].ID != aID || len(after) != len(before) {
		t.Fatalf("order after reorder: %v", after)
	}
	var restOld, restNew []int64
	for _, f := range before {
		if f.ID != aID && f.ID != bID {
			restOld = append(restOld, f.ID)
		}
	}
	for _, f := range after[2:] {
		restNew = append(restNew, f.ID)
	}
	if fmt.Sprint(restOld) != fmt.Sprint(restNew) {
		t.Fatalf("others moved: %v -> %v", restOld, restNew)
	}
	// Put the others back in front so later tests see the seed order.
	if code, _ := e.call(admin, http.MethodPost, "/api/faq/reorder", map[string]any{"ids": restOld}); code != http.StatusOK {
		t.Fatal("restore order")
	}
	for _, bad := range []map[string]any{{"ids": []int64{aID, aID}}, {"ids": []int64{}}, {"ids": []int64{aID, 1 << 40}}} {
		if code, _ := e.call(admin, http.MethodPost, "/api/faq/reorder", bad); code != http.StatusBadRequest && code != http.StatusNotFound {
			t.Fatalf("reorder %v: %d", bad, code)
		}
	}
}

func TestChatFAQButtonAnswersInstantly(t *testing.T) {
	e := newChatEnv(t)
	u, admin := e.user("user"), e.user("admin")
	tag := fmt.Sprintf("faq%d", time.Now().UnixNano())
	_, f := e.call(admin, http.MethodPost, "/api/faq", faqBody(tag))
	fid := num(f["id"])
	t.Cleanup(func() { e.call(admin, http.MethodDelete, fmt.Sprintf("/api/faq/%d", fid), nil) })

	// No model at all: FAQ answers must not need it.
	e.h.ML = nil

	code, out := e.call(u, http.MethodPost, "/api/chat/faq", map[string]any{"faq_id": fid, "lang": "ru"})
	if code != http.StatusOK || out["answer"] != "Ответ "+tag || out["basis"] != "faq" {
		t.Fatalf("faq button: %d %v", code, out)
	}
	conv := out["conversation"].(map[string]any)
	if conv["title"] != "Как "+tag+"?" {
		t.Fatalf("title %v", conv["title"])
	}
	convID := num(conv["id"])

	// Typing the same question (any language, any case, without "?") also
	// answers from the FAQ, in that language.
	code, out = e.call(u, http.MethodPost, "/api/chat/ask", map[string]any{"question": "  қалай " + tag, "conversation_id": convID})
	if code != http.StatusOK || out["answer"] != "Жауап "+tag || out["language"] != "kz" {
		t.Fatalf("typed faq question: %d %v", code, out)
	}
	// Anything else still needs the model (which is off here).
	if code, _ := e.call(u, http.MethodPost, "/api/chat/ask", map[string]any{"question": "something else", "conversation_id": convID}); code != http.StatusServiceUnavailable {
		t.Fatalf("non-faq question without model: %d, want 503", code)
	}

	_, msgs := e.call(u, http.MethodGet, fmt.Sprintf("/api/chat/conversations/%d/messages", convID), nil)
	list := msgs["messages"].([]any)
	if len(list) != 4 {
		t.Fatalf("messages %v", list)
	}
	if m := list[1].(map[string]any); m["text"] != "Ответ "+tag || m["basis"] != "faq" || m["language"] != "ru" {
		t.Fatalf("saved answer %v", m)
	}

	for _, bad := range []struct {
		body map[string]any
		want int
	}{
		{map[string]any{"faq_id": 1 << 40, "lang": "ru"}, http.StatusNotFound},
		{map[string]any{"faq_id": fid, "lang": "ru", "conversation_id": 1 << 40}, http.StatusNotFound},
	} {
		if code, _ := e.call(u, http.MethodPost, "/api/chat/faq", bad.body); code != bad.want {
			t.Fatalf("%v: %d, want %d", bad.body, code, bad.want)
		}
	}
}
