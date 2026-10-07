package handlers

import (
	"net/http"
	"strings"
	"time"
)

type publicProfile struct {
	ID            int64     `json:"id"`
	DisplayName   string    `json:"display_name"`
	Major         string    `json:"major"`
	Bio           string    `json:"bio"`
	EmailVerified bool      `json:"email_verified"`
	CreatedAt     time.Time `json:"created_at"`
}

// GetUserProfile returns the public profile of any user by id — no email,
// unlike /api/me, since other users' addresses aren't anyone else's
// business. EmailVerified is exposed, though: it shows as a small
// "Verified" badge (proof of a real @sdu.edu.kz address) without
// revealing what that address actually is.
func (h *Handlers) GetUserProfile(w http.ResponseWriter, r *http.Request) {
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	u, err := h.Store.GetUserByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, publicProfile{
		ID:            u.ID,
		DisplayName:   u.DisplayName,
		Major:         u.Major,
		Bio:           u.Bio,
		EmailVerified: u.EmailVerifiedAt != nil,
		CreatedAt:     u.CreatedAt,
	})
}

type updateProfileReq struct {
	DisplayName string `json:"display_name"`
	Major       string `json:"major"`
	Bio         string `json:"bio"`
}

// UpdateProfile lets a user edit their own display name, major, and bio.
func (h *Handlers) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req updateProfileReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	req.Major = strings.TrimSpace(req.Major)
	req.Bio = strings.TrimSpace(req.Bio)
	if req.DisplayName == "" {
		writeError(w, http.StatusBadRequest, "display_name is required")
		return
	}
	if len(req.Bio) > 500 {
		writeError(w, http.StatusBadRequest, "bio must be 500 characters or fewer")
		return
	}
	u, err := h.Store.UpdateProfile(r.Context(), uid, req.DisplayName, req.Major, req.Bio)
	if err != nil {
		writeStoreErr(w, err, "could not update profile")
		return
	}
	writeJSON(w, http.StatusOK, toUserPublic(u))
}

func (h *Handlers) ListUserThreads(w http.ResponseWriter, r *http.Request) {
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	page := queryIntDefault(r, "page", 1, 1, 1<<31-1)
	pageSize := queryIntDefault(r, "page_size", 20, 1, 50)

	threads, total, err := h.Store.ListThreadsByUser(r.Context(), id, page, pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list threads")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"threads":   threads,
		"page":      page,
		"page_size": pageSize,
		"total":     total,
	})
}

func (h *Handlers) ListUserComments(w http.ResponseWriter, r *http.Request) {
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	page := queryIntDefault(r, "page", 1, 1, 1<<31-1)
	pageSize := queryIntDefault(r, "page_size", 20, 1, 50)

	comments, total, err := h.Store.ListCommentsByUser(r.Context(), id, page, pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list comments")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"comments":  comments,
		"page":      page,
		"page_size": pageSize,
		"total":     total,
	})
}
