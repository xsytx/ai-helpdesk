package handlers

import (
	"net/http"
	"strings"
	"unicode/utf8"
)

// SimilarThreads answers "maybe this was already asked" while a student
// writes a new question: ?q=<title so far>. Visible questions only.
func (h *Handlers) SimilarThreads(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(q) > 200 {
		q = string([]rune(q)[:200])
	}
	threads, err := h.Store.SimilarThreads(r.Context(), q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not search")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"threads": threads})
}

type acceptReq struct {
	// CommentID is the answer that solved the question; null takes it back.
	CommentID *int64 `json:"comment_id"`
}

// AcceptAnswer lets a question's author mark one answer as the solution.
func (h *Handlers) AcceptAnswer(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid thread id")
		return
	}
	var req acceptReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.Store.SetAcceptedAnswer(r.Context(), id, uid, req.CommentID); err != nil {
		writeStoreErr(w, err, "could not mark the answer")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
