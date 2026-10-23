package handlers

import (
	"net/http"
	"slices"
	"time"

	"campus-forum/internal/store"
)

type chatRatingReq struct {
	// Value: 1 = 👍, -1 = 👎, 0 = take the rating back.
	Value int `json:"value"`
}

// RateChatMessage stores a student's 👍/👎 on one of their AI answers.
func (h *Handlers) RateChatMessage(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid message id")
		return
	}
	var req chatRatingReq
	if err := decodeJSON(r, &req); err != nil || req.Value < -1 || req.Value > 1 {
		writeError(w, http.StatusBadRequest, "value must be 1, -1 or 0")
		return
	}
	if err := h.Store.RateChatMessage(r.Context(), uid, id, req.Value); err != nil {
		writeStoreErr(w, err, "could not save the rating")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ChatInsights is the admin panel's "AI chat" section:
// ?kind=disliked|unanswered|frequent&days=30. No student names are included.
func (h *Handlers) ChatInsights(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireModerator(w, r, uid) {
		return
	}
	kind := r.URL.Query().Get("kind")
	if !slices.Contains(store.ChatInsightKinds, kind) {
		writeError(w, http.StatusBadRequest, "kind must be disliked, unanswered or frequent")
		return
	}
	days := queryIntDefault(r, "days", 30, 1, 365)
	items, err := h.Store.ChatInsights(r.Context(), kind, time.Now().AddDate(0, 0, -days), 100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the list")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"kind": kind, "days": days, "items": items})
}
