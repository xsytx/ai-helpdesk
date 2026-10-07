package handlers

import (
	"net/http"
	"strings"

	"campus-forum/internal/store"
)

// isModerator reports whether uid has moderator or admin privileges. It
// looks the user up fresh on every call rather than trusting a JWT claim,
// since a promotion (or demotion) should take effect on the user's very
// next request rather than waiting for their token to expire.
func (h *Handlers) isModerator(r *http.Request, uid int64) bool {
	u, err := h.Store.GetUserByID(r.Context(), uid)
	if err != nil {
		return false
	}
	return u.IsModerator()
}

// requireModerator writes a 403 and returns false if uid isn't a
// moderator/admin. Callers should return immediately when it does.
func (h *Handlers) requireModerator(w http.ResponseWriter, r *http.Request, uid int64) bool {
	if !h.isModerator(r, uid) {
		writeError(w, http.StatusForbidden, "moderator access required")
		return false
	}
	return true
}

// requireNotBanned writes a 403 and returns false if uid's account is
// suspended. Checked at content-creation time (not just at login) so a
// ban takes effect immediately even against an already-issued token.
func (h *Handlers) requireNotBanned(w http.ResponseWriter, r *http.Request, uid int64) bool {
	u, err := h.Store.GetUserByID(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return false
	}
	if u.BannedAt != nil {
		writeError(w, http.StatusForbidden, "your account has been suspended")
		return false
	}
	return true
}

// requireVerified writes a 403 and returns false if uid hasn't verified
// their email yet. Currently unused: CreateThread/CreateComment dropped
// their login requirement (posting is anonymous for now — see those
// handlers), so there's no logged-in identity left to check at the point
// this used to run. Kept around, not deleted, for when authorization
// comes back and content creation is gated behind an account again.
func (h *Handlers) requireVerified(w http.ResponseWriter, r *http.Request, uid int64) bool {
	u, err := h.Store.GetUserByID(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return false
	}
	if u.EmailVerifiedAt == nil {
		writeError(w, http.StatusForbidden, "please verify your email before posting")
		return false
	}
	return true
}

// --- Thread locking ---

type lockThreadReq struct {
	Locked bool `json:"locked"`
}

func (h *Handlers) LockThread(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "invalid thread id")
		return
	}
	var req lockThreadReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.Store.SetThreadLocked(r.Context(), id, req.Locked); err != nil {
		writeStoreErr(w, err, "could not update thread")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Banning ---

type banUserReq struct {
	Banned bool `json:"banned"`
}

func (h *Handlers) BanUser(w http.ResponseWriter, r *http.Request) {
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
	var req banUserReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.Store.SetUserBanned(r.Context(), id, req.Banned); err != nil {
		writeStoreErr(w, err, "could not update user")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Reports ---

type reportReq struct {
	Reason string `json:"reason"`
}

func (h *Handlers) reportTarget(w http.ResponseWriter, r *http.Request, targetType string) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req reportReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	rep, err := h.Store.CreateReport(r.Context(), uid, targetType, id, strings.TrimSpace(req.Reason))
	if err != nil {
		if err == store.ErrNotFound {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not file report")
		return
	}
	writeJSON(w, http.StatusCreated, rep)
}

func (h *Handlers) ReportThread(w http.ResponseWriter, r *http.Request) {
	h.reportTarget(w, r, "thread")
}

func (h *Handlers) ReportComment(w http.ResponseWriter, r *http.Request) {
	h.reportTarget(w, r, "comment")
}

func (h *Handlers) ListReports(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireModerator(w, r, uid) {
		return
	}
	status := r.URL.Query().Get("status")
	if status != "" && status != "open" && status != "resolved" {
		writeError(w, http.StatusBadRequest, "status must be 'open' or 'resolved'")
		return
	}
	page := queryIntDefault(r, "page", 1, 1, 1<<31-1)
	pageSize := queryIntDefault(r, "page_size", 20, 1, 50)

	reports, total, err := h.Store.ListReports(r.Context(), status, page, pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list reports")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"reports":   reports,
		"page":      page,
		"page_size": pageSize,
		"total":     total,
	})
}

func (h *Handlers) ResolveReport(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "invalid report id")
		return
	}
	if err := h.Store.ResolveReport(r.Context(), id); err != nil {
		writeStoreErr(w, err, "could not resolve report")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
