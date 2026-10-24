package handlers

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

// maxAvatarBytes: the website shrinks avatars to 512px first, so real ones
// are far smaller.
const maxAvatarBytes = 2 << 20

// presetAvatarRe matches the built-in avatars ("avatar1" … "avatar99").
var presetAvatarRe = regexp.MustCompile(`^avatar\d{1,2}$`)

// uploadedAvatarPrefix is where uploaded avatars are served from.
const uploadedAvatarPrefix = "/uploads/avatars/"

type setAvatarReq struct {
	// Avatar: a preset id ("avatar3"), or "" for none (initials).
	Avatar string `json:"avatar"`
}

// SetAvatar picks a built-in avatar (or none) for the signed-in user.
func (h *Handlers) SetAvatar(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req setAvatarReq
	if err := decodeJSON(r, &req); err != nil || (req.Avatar != "" && !presetAvatarRe.MatchString(req.Avatar)) {
		writeError(w, http.StatusBadRequest, `avatar must be a preset id like "avatar3" or empty`)
		return
	}
	h.replaceAvatar(w, r, uid, req.Avatar)
}

// UploadAvatar sets an uploaded photo (multipart field "file") as the
// signed-in user's avatar.
func (h *Handlers) UploadAvatar(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	relPath, _, _, ok := h.saveUploadedImage(w, r, maxAvatarBytes, fmt.Sprintf("avatars/%d", uid))
	if !ok {
		return
	}
	h.replaceAvatar(w, r, uid, "/uploads/"+relPath)
}

// replaceAvatar stores the new avatar, deletes the previous uploaded photo
// (if it was one) and answers with the updated user.
func (h *Handlers) replaceAvatar(w http.ResponseWriter, r *http.Request, uid int64, avatar string) {
	old, err := h.Store.SetAvatar(r.Context(), uid, avatar)
	if err != nil {
		if strings.HasPrefix(avatar, uploadedAvatarPrefix) {
			h.removeUpload(strings.TrimPrefix(avatar, "/uploads/"))
		}
		writeStoreErr(w, err, "could not save the avatar")
		return
	}
	if old != avatar && strings.HasPrefix(old, uploadedAvatarPrefix) {
		h.removeUpload(strings.TrimPrefix(old, "/uploads/"))
	}
	u, err := h.Store.GetUserByID(r.Context(), uid)
	if err != nil {
		writeStoreErr(w, err, "could not load the user")
		return
	}
	writeJSON(w, http.StatusOK, toUserPublic(u))
}
