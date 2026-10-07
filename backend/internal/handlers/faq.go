package handlers

import (
	"net/http"
	"strings"

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

type faqReq struct {
	Question  string `json:"question"`
	Answer    string `json:"answer"`
	SortOrder int    `json:"sort_order"`
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
	req.Question = strings.TrimSpace(req.Question)
	req.Answer = strings.TrimSpace(req.Answer)
	if req.Question == "" || req.Answer == "" {
		writeError(w, http.StatusBadRequest, "question and answer are required")
		return
	}
	f, err := h.Store.CreateFAQ(r.Context(), req.Question, req.Answer, req.SortOrder)
	if err != nil {
		if err == store.ErrConflict {
			writeError(w, http.StatusConflict, "that question already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not create FAQ entry")
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
	req.Question = strings.TrimSpace(req.Question)
	req.Answer = strings.TrimSpace(req.Answer)
	if req.Question == "" || req.Answer == "" {
		writeError(w, http.StatusBadRequest, "question and answer are required")
		return
	}
	f, err := h.Store.UpdateFAQ(r.Context(), id, req.Question, req.Answer, req.SortOrder)
	if err != nil {
		if err == store.ErrConflict {
			writeError(w, http.StatusConflict, "that question already exists")
			return
		}
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
