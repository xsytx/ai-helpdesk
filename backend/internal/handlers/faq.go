package handlers

import (
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"campus-forum/internal/store"
)

func (h *Handlers) ListFAQs(w http.ResponseWriter, r *http.Request) {
	faqs, err := h.Store.ListFAQs(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list FAQ")
		return
	}
	writeJSON(w, http.StatusOK, faqs)
}

const (
	faqQuestionMaxRunes = 200
	faqAnswerMaxRunes   = 4000
)

// faqReq is an entry as the admin panel sends it. Every text is required in
// all three languages: the site shows every text in KZ, RU and EN.
type faqReq struct {
	Question   string `json:"question"`
	QuestionKZ string `json:"question_kz"`
	QuestionRU string `json:"question_ru"`
	Answer     string `json:"answer"`
	AnswerKZ   string `json:"answer_kz"`
	AnswerRU   string `json:"answer_ru"`
	Category   string `json:"category"`
	Pinned     bool   `json:"pinned"`
}

// input checks the entry and returns it trimmed, or an error message.
func (req faqReq) input() (store.FAQInput, string) {
	in := store.FAQInput{
		Question: strings.TrimSpace(req.Question), QuestionKZ: strings.TrimSpace(req.QuestionKZ), QuestionRU: strings.TrimSpace(req.QuestionRU),
		Answer: strings.TrimSpace(req.Answer), AnswerKZ: strings.TrimSpace(req.AnswerKZ), AnswerRU: strings.TrimSpace(req.AnswerRU),
		Category: req.Category, Pinned: req.Pinned,
	}
	if in.Category == "" {
		in.Category = "general"
	}
	if !slices.Contains(store.FAQCategories, in.Category) {
		return in, "unknown category"
	}
	for _, q := range []string{in.Question, in.QuestionKZ, in.QuestionRU} {
		if q == "" {
			return in, "the question is required in all three languages"
		}
		if utf8.RuneCountInString(q) > faqQuestionMaxRunes {
			return in, "question is too long"
		}
	}
	for _, a := range []string{in.Answer, in.AnswerKZ, in.AnswerRU} {
		if a == "" {
			return in, "the answer is required in all three languages"
		}
		if utf8.RuneCountInString(a) > faqAnswerMaxRunes {
			return in, "answer is too long"
		}
	}
	return in, ""
}

func (h *Handlers) CreateFAQ(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireModerator(w, r, uid) {
		return
	}
	var req faqReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	in, msg := req.input()
	if msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	f, err := h.Store.CreateFAQ(r.Context(), in)
	if err != nil {
		writeStoreErr(w, err, "could not create FAQ entry")
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

func (h *Handlers) UpdateFAQ(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireModerator(w, r, uid) {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid FAQ id")
		return
	}
	var req faqReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	in, msg := req.input()
	if msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	f, err := h.Store.UpdateFAQ(r.Context(), id, in)
	if err != nil {
		writeStoreErr(w, err, "could not update FAQ entry")
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (h *Handlers) DeleteFAQ(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireModerator(w, r, uid) {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid FAQ id")
		return
	}
	if err := h.Store.DeleteFAQ(r.Context(), id); err != nil {
		writeStoreErr(w, err, "could not delete FAQ entry")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ReorderFAQs sets the display order: {"ids": [3, 1, 2]} puts those first.
func (h *Handlers) ReorderFAQs(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireModerator(w, r, uid) {
		return
	}
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := decodeJSON(r, &req); err != nil || len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids are required")
		return
	}
	seen := make(map[int64]bool, len(req.IDs))
	for _, id := range req.IDs {
		if seen[id] {
			writeError(w, http.StatusBadRequest, "duplicate id")
			return
		}
		seen[id] = true
	}
	if err := h.Store.ReorderFAQs(r.Context(), req.IDs); err != nil {
		writeStoreErr(w, err, "could not reorder the FAQ")
		return
	}
	h.ListFAQs(w, r)
}
