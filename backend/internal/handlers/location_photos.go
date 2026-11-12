package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"campus-forum/internal/models"
	"campus-forum/internal/store"
)

// --- Photos of campus places (Sprint 5, "view location photo") ---
//
// A place card on the Maps page shows the gallery of its code (a place of
// places.ts, a room code or "PT_<point id>"). Admins upload, caption, order
// and delete photos in the map editor; a student may attach one photo to a
// "Report a mistake" report, which an admin adds to the gallery.

const (
	maxLocationPhotos       = 12  // per place
	maxLocationPhotoCaption = 200 // runes
	maxPhotoCodesPerRequest = 10
	locationPhotoDir        = "places"
	// Waiting suggestions one student may have at a time.
	maxPendingSuggestions = 5
)

func normalizePlaceCode(s string) (string, bool) {
	code := strings.ToUpper(strings.TrimSpace(s))
	return code, placeCodeRx.MatchString(code)
}

func cleanCaption(s string) (string, bool) {
	c := strings.TrimSpace(s)
	return c, utf8.RuneCountInString(c) <= maxLocationPhotoCaption
}

// ListLocationPhotos: GET /api/map/photos?codes=HALL_A,D117 — the gallery
// photos of those codes (a place card asks for all codes it stands for).
func (h *Handlers) ListLocationPhotos(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.userID(r); !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var codes []string
	for _, part := range strings.Split(r.URL.Query().Get("codes"), ",") {
		if strings.TrimSpace(part) == "" {
			continue
		}
		code, ok := normalizePlaceCode(part)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid place code")
			return
		}
		codes = append(codes, code)
	}
	if len(codes) == 0 || len(codes) > maxPhotoCodesPerRequest {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("give 1 to %d place codes", maxPhotoCodesPerRequest))
		return
	}
	photos, err := h.Store.ListLocationPhotos(r.Context(), codes)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the photos")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"photos": photos})
}

// UploadLocationPhoto: POST /api/admin/map/photos (multipart: file,
// place_code, caption) — added to the end of the place's gallery.
func (h *Handlers) UploadLocationPhoto(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.mapAdmin(w, r)
	if !ok {
		return
	}
	relPath, contentType, size, ok := h.saveUploadedImage(w, r, maxAttachmentBytes, locationPhotoDir)
	if !ok {
		return
	}
	code, okCode := normalizePlaceCode(r.FormValue("place_code"))
	caption, okCaption := cleanCaption(r.FormValue("caption"))
	switch {
	case !okCode:
		h.removeUpload(relPath)
		writeError(w, http.StatusBadRequest, "invalid place code")
		return
	case !okCaption:
		h.removeUpload(relPath)
		writeError(w, http.StatusBadRequest, "the caption is too long")
		return
	}
	photo, err := h.Store.CreateLocationPhoto(r.Context(), models.LocationPhoto{
		PlaceCode: code, Path: relPath, ContentType: contentType, SizeBytes: size,
		Caption: caption, Status: "approved", UploadedBy: &uid,
	}, maxLocationPhotos)
	if err != nil {
		h.removeUpload(relPath)
		if errors.Is(err, store.ErrPhotoLimit) {
			writeGalleryFull(w)
			return
		}
		writeError(w, http.StatusInternalServerError, "could not save the photo")
		return
	}
	writeJSON(w, http.StatusCreated, photo)
}

// UpdateLocationPhoto: PATCH /api/admin/map/photos/{id} {"caption": "..."}.
func (h *Handlers) UpdateLocationPhoto(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.mapAdmin(w, r); !ok {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid photo id")
		return
	}
	var req struct {
		Caption string `json:"caption"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	caption, ok := cleanCaption(req.Caption)
	if !ok {
		writeError(w, http.StatusBadRequest, "the caption is too long")
		return
	}
	photo, err := h.Store.UpdateLocationPhotoCaption(r.Context(), id, caption)
	if err != nil {
		writeStoreErr(w, err, "could not save the caption")
		return
	}
	writeJSON(w, http.StatusOK, photo)
}

// ReorderLocationPhotos: PUT /api/admin/map/photos/order
// {"place_code": "HALL_A", "ids": [3, 1, 2]} — every gallery photo of the place, in the new order.
func (h *Handlers) ReorderLocationPhotos(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.mapAdmin(w, r); !ok {
		return
	}
	var req struct {
		PlaceCode string  `json:"place_code"`
		IDs       []int64 `json:"ids"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	code, ok := normalizePlaceCode(req.PlaceCode)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid place code")
		return
	}
	seen := map[int64]bool{}
	for _, id := range req.IDs {
		if seen[id] {
			writeError(w, http.StatusBadRequest, "a photo is listed twice")
			return
		}
		seen[id] = true
	}
	err := h.Store.ReorderLocationPhotos(r.Context(), code, req.IDs)
	if errors.Is(err, store.ErrInvalidTarget) {
		writeError(w, http.StatusBadRequest, "list every photo of this place once")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save the order")
		return
	}
	photos, err := h.Store.ListLocationPhotos(r.Context(), []string{code})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the photos")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"photos": photos})
}

// DeleteLocationPhoto: DELETE /api/admin/map/photos/{id} (a gallery photo or
// a report's photo), with its file.
func (h *Handlers) DeleteLocationPhoto(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.mapAdmin(w, r); !ok {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid photo id")
		return
	}
	path, err := h.Store.DeleteLocationPhoto(r.Context(), id)
	if err != nil {
		writeStoreErr(w, err, "could not delete the photo")
		return
	}
	h.removeUpload(path)
	w.WriteHeader(http.StatusNoContent)
}

// ApproveLocationPhoto: POST /api/admin/map/photos/{id}/approve {"caption": "..."}
// — a student's report photo goes to the end of its place's gallery.
func (h *Handlers) ApproveLocationPhoto(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.mapAdmin(w, r); !ok {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid photo id")
		return
	}
	var req struct {
		Caption string `json:"caption"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
	}
	caption, ok := cleanCaption(req.Caption)
	if !ok {
		writeError(w, http.StatusBadRequest, "the caption is too long")
		return
	}
	photo, err := h.Store.ApproveLocationPhoto(r.Context(), id, caption, maxLocationPhotos)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "photo not found")
		return
	case errors.Is(err, store.ErrConflict):
		writeError(w, http.StatusConflict, "this photo is already in the gallery")
		return
	case errors.Is(err, store.ErrPhotoLimit):
		writeGalleryFull(w)
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "could not add the photo")
		return
	}
	writeJSON(w, http.StatusOK, photo)
}

// UploadReportPhoto: POST /api/location-reports/{id}/photo (multipart: file)
// — the report's author attaches one photo while the report is open. It
// waits for an admin (shown in the admin panel only).
func (h *Handlers) UploadReportPhoto(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireCanPost(w, r, uid) {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid report id")
		return
	}
	rep, err := h.Store.GetLocationReport(r.Context(), id)
	if err != nil {
		writeStoreErr(w, err, "could not load the report")
		return
	}
	switch {
	case rep.UserID != uid:
		writeError(w, http.StatusForbidden, "this is not your report")
		return
	case rep.Status != "open":
		writeError(w, http.StatusConflict, "this report is already closed")
		return
	case rep.Photo != nil:
		writeError(w, http.StatusConflict, "this report already has a photo")
		return
	}
	relPath, contentType, size, ok := h.saveUploadedImage(w, r, maxAttachmentBytes, locationPhotoDir)
	if !ok {
		return
	}
	reportID := rep.ID
	photo, err := h.Store.CreateLocationPhoto(r.Context(), models.LocationPhoto{
		PlaceCode: rep.PlaceCode, Path: relPath, ContentType: contentType, SizeBytes: size,
		Status: "pending", ReportID: &reportID, UploadedBy: &uid,
	}, 0)
	if err != nil {
		h.removeUpload(relPath)
		switch {
		case errors.Is(err, store.ErrConflict):
			writeError(w, http.StatusConflict, "this report already has a photo")
			return
		case errors.Is(err, store.ErrReportClosed):
			// Closed by an admin while the photo was uploading.
			writeError(w, http.StatusConflict, "this report is already closed")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not save the photo")
		return
	}
	writeJSON(w, http.StatusCreated, photo)
}

// SuggestLocationPhoto: POST /api/location-photos (multipart: file,
// place_code) — a student offers a photo of a place; it waits for an admin.
// One waiting photo per student and place, at most maxPendingSuggestions in all.
func (h *Handlers) SuggestLocationPhoto(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireCanPost(w, r, uid) {
		return
	}
	if n, err := h.Store.CountPendingPhotoSuggestions(r.Context(), uid); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save the photo")
		return
	} else if n >= maxPendingSuggestions {
		writeTooManyWaiting(w)
		return
	}
	relPath, contentType, size, ok := h.saveUploadedImage(w, r, maxAttachmentBytes, locationPhotoDir)
	if !ok {
		return
	}
	code, okCode := normalizePlaceCode(r.FormValue("place_code"))
	if !okCode {
		h.removeUpload(relPath)
		writeError(w, http.StatusBadRequest, "invalid place code")
		return
	}
	photo, err := h.Store.CreateLocationPhoto(r.Context(), models.LocationPhoto{
		PlaceCode: code, Path: relPath, ContentType: contentType, SizeBytes: size,
		Status: "pending", UploadedBy: &uid,
	}, maxPendingSuggestions)
	if err != nil {
		h.removeUpload(relPath)
		switch {
		case errors.Is(err, store.ErrConflict):
			writeError(w, http.StatusConflict, "you already suggested a photo of this place")
			return
		case errors.Is(err, store.ErrPhotoLimit):
			writeTooManyWaiting(w)
			return
		}
		writeError(w, http.StatusInternalServerError, "could not save the photo")
		return
	}
	writeJSON(w, http.StatusCreated, photo)
}

// ListPhotoSuggestions: GET /api/admin/map/photos/suggestions — students'
// waiting photos (approve or delete them with the usual photo routes).
func (h *Handlers) ListPhotoSuggestions(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.mapAdmin(w, r); !ok {
		return
	}
	photos, err := h.Store.ListPhotoSuggestions(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the suggestions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"photos": photos})
}

func writeGalleryFull(w http.ResponseWriter) {
	writeError(w, http.StatusConflict, fmt.Sprintf("a place can have at most %d photos", maxLocationPhotos))
}

func writeTooManyWaiting(w http.ResponseWriter) {
	writeJSON(w, http.StatusTooManyRequests, map[string]any{
		"error": fmt.Sprintf("you already have %d photos waiting for a check", maxPendingSuggestions),
		"code":  "too_many_waiting",
	})
}
