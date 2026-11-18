package handlers

import (
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"unicode/utf8"

	"campus-forum/internal/models"
	"campus-forum/internal/store"
)

// --- Campus map points: the floor plans' rooms, stairs, toilets… (Sprint 5) ---
// Everyone signed in reads them (the Maps page); admins change them in the
// admin panel's map editor, and students see the change on their next visit.

// The plan images are 4818 × 1689 px at most: a little room around them.
const (
	mapMaxX = 5000
	mapMaxY = 1800
)

// ListMapPoints: GET /api/map/points.
func (h *Handlers) ListMapPoints(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.userID(r); !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	points, err := h.Store.ListMapPoints(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the map")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"points": points})
}

// Up to 10 views of the official 3D tour per point. Only vrmir3d's SDU tour:
// the website opens these addresses inside the page.
const maxPointTours = 10

func tourURLOK(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && len(raw) <= 300 && u.Scheme == "https" &&
		(u.Host == "vrmir3d.com" || u.Host == "www.vrmir3d.com") &&
		strings.HasPrefix(u.Path, "/SDU_University_VR/")
}

// mapPointInput reads and checks a point from the request body ("" = fine).
func mapPointInput(r *http.Request) (models.MapPointInput, string) {
	var p models.MapPointInput
	if err := decodeJSON(r, &p); err != nil {
		return p, "invalid request body"
	}
	p.Code = strings.TrimSpace(p.Code)
	p.Name = strings.TrimSpace(p.Name)
	p.Place = strings.ToUpper(strings.TrimSpace(p.Place))
	switch {
	case utf8.RuneCountInString(p.Code) > 40:
		return p, "the code is too long"
	case utf8.RuneCountInString(p.Name) > 120:
		return p, "the name is too long"
	case !slices.Contains(store.MapPointTypes, p.Type):
		return p, "unknown type"
	case !slices.Contains(store.MapFloors, p.Floor):
		return p, "unknown floor"
	case p.X < 0 || p.X > mapMaxX || p.Y < 0 || p.Y > mapMaxY:
		return p, "the point is outside the plan"
	case p.Place != "" && !placeCodeRx.MatchString(p.Place):
		return p, "invalid place"
	case len(p.Tours) > maxPointTours:
		return p, "too many 3D tour links"
	}
	for i := range p.Tours {
		p.Tours[i].URL = strings.TrimSpace(p.Tours[i].URL)
		p.Tours[i].Label = strings.TrimSpace(p.Tours[i].Label)
		if !tourURLOK(p.Tours[i].URL) {
			return p, "a 3D tour link must be a vrmir3d.com/SDU_University_VR/ address"
		}
		if utf8.RuneCountInString(p.Tours[i].Label) > 80 {
			return p, "a 3D tour label is too long"
		}
	}
	return p, ""
}

func (h *Handlers) mapAdmin(w http.ResponseWriter, r *http.Request) (int64, bool) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return 0, false
	}
	return uid, h.requireModerator(w, r, uid)
}

func writeMapPointErr(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "another point already has this code")
		return
	}
	writeStoreErr(w, err, "could not save the point")
}

// ListMapPointChanges: GET /api/admin/map/changes (the editor's recent changes, for undo).
func (h *Handlers) ListMapPointChanges(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.mapAdmin(w, r); !ok {
		return
	}
	changes, err := h.Store.ListMapPointChanges(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the changes")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"changes": changes})
}

// CreateMapPoint: POST /api/admin/map/points.
func (h *Handlers) CreateMapPoint(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.mapAdmin(w, r)
	if !ok {
		return
	}
	p, problem := mapPointInput(r)
	if problem != "" {
		writeError(w, http.StatusBadRequest, problem)
		return
	}
	point, err := h.Store.CreateMapPoint(r.Context(), p, uid)
	if err != nil {
		writeMapPointErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, point)
}

// UpdateMapPoint: PUT /api/admin/map/points/{id} (all fields).
func (h *Handlers) UpdateMapPoint(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.mapAdmin(w, r)
	if !ok {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid point id")
		return
	}
	p, problem := mapPointInput(r)
	if problem != "" {
		writeError(w, http.StatusBadRequest, problem)
		return
	}
	point, err := h.Store.UpdateMapPoint(r.Context(), id, p, uid)
	if err != nil {
		writeMapPointErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, point)
}

// DeleteMapPoint: DELETE /api/admin/map/points/{id}.
func (h *Handlers) DeleteMapPoint(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.mapAdmin(w, r)
	if !ok {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid point id")
		return
	}
	if err := h.Store.DeleteMapPoint(r.Context(), id, uid); err != nil {
		writeStoreErr(w, err, "could not delete the point")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
