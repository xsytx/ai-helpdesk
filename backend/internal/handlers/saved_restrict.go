package handlers

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

// --- Saved questions ---

// SaveThread (PUT) and UnsaveThread (DELETE) bookmark a question.
func (h *Handlers) SaveThread(w http.ResponseWriter, r *http.Request)   { h.setSaved(w, r, true) }
func (h *Handlers) UnsaveThread(w http.ResponseWriter, r *http.Request) { h.setSaved(w, r, false) }

func (h *Handlers) setSaved(w http.ResponseWriter, r *http.Request, saved bool) {
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
	if err := h.Store.SetThreadSaved(r.Context(), uid, id, saved); err != nil {
		writeStoreErr(w, err, "could not update saved questions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"saved": saved})
}

// ListSavedThreads: the user's saved questions, last saved first.
func (h *Handlers) ListSavedThreads(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	threads, err := h.Store.ListSavedThreads(r.Context(), uid, 100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load saved questions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"threads": threads})
}

// --- Mute and ban (staff) ---

type restrictReq struct {
	Kind   string `json:"kind"`   // "mute" or "ban"
	Days   int    `json:"days"`   // 1..365; 0 = no end
	Reason string `json:"reason"` // required, shown to the student
}

// restrictionTarget loads the user staff wants to restrict; staff accounts
// and yourself can't be. On a problem it has written the error.
func (h *Handlers) restrictionTarget(w http.ResponseWriter, r *http.Request) (int64, bool) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return 0, false
	}
	if !h.requireModerator(w, r, uid) {
		return 0, false
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return 0, false
	}
	target, err := h.Store.GetUserByID(r.Context(), id)
	if err != nil {
		writeStoreErr(w, err, "could not load the user")
		return 0, false
	}
	if target.ID == uid || target.IsModerator() {
		writeError(w, http.StatusBadRequest, "staff accounts can't be restricted")
		return 0, false
	}
	return id, true
}

// RestrictUser mutes or bans a student for some days (0 = no end).
func (h *Handlers) RestrictUser(w http.ResponseWriter, r *http.Request) {
	id, ok := h.restrictionTarget(w, r)
	if !ok {
		return
	}
	var req restrictReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Reason = strings.TrimSpace(req.Reason)
	if req.Kind != "mute" && req.Kind != "ban" {
		writeError(w, http.StatusBadRequest, "kind must be mute or ban")
		return
	}
	if req.Days < 0 || req.Days > 365 {
		writeError(w, http.StatusBadRequest, "days must be 0 (no end) to 365")
		return
	}
	if req.Reason == "" || utf8.RuneCountInString(req.Reason) > 500 {
		writeError(w, http.StatusBadRequest, "a reason of up to 500 characters is required")
		return
	}
	var until *time.Time
	if req.Days > 0 {
		t := time.Now().Add(time.Duration(req.Days) * 24 * time.Hour)
		until = &t
	}
	if err := h.Store.RestrictUser(r.Context(), id, req.Kind, until, req.Reason); err != nil {
		writeStoreErr(w, err, "could not restrict the user")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// LiftRestriction ends a mute or ban now (?kind=mute|ban).
func (h *Handlers) LiftRestriction(w http.ResponseWriter, r *http.Request) {
	id, ok := h.restrictionTarget(w, r)
	if !ok {
		return
	}
	kind := r.URL.Query().Get("kind")
	if kind != "mute" && kind != "ban" {
		writeError(w, http.StatusBadRequest, "kind must be mute or ban")
		return
	}
	if err := h.Store.LiftRestriction(r.Context(), id, kind); err != nil {
		writeStoreErr(w, err, "could not lift the restriction")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// UserRestriction: a user's mute and ban in force (staff only).
func (h *Handlers) UserRestriction(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	u, err := h.Store.GetUserByID(r.Context(), id)
	if err != nil {
		writeStoreErr(w, err, "could not load the user")
		return
	}
	now := time.Now()
	out := map[string]any{"staff": u.IsModerator(), "muted": u.Muted(now), "banned": u.Banned(now)}
	if u.Muted(now) {
		out["mute_until"], out["mute_reason"] = u.MuteUntil, u.MuteReason
	}
	if u.Banned(now) {
		out["ban_until"], out["ban_reason"] = u.BanUntil, u.BanReason
	}
	writeJSON(w, http.StatusOK, out)
}

// ListRestrictedUsers: everyone muted or banned right now (staff only).
func (h *Handlers) ListRestrictedUsers(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireModerator(w, r, uid) {
		return
	}
	users, err := h.Store.ListRestrictedUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load restricted users")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}
