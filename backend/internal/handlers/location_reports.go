package handlers

import (
	"errors"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"campus-forum/internal/store"
)

// --- Campus navigation: "Report a mistake" (Sprint 5) ---

// placeCodeRx: the codes of src/features/locations/places.ts ("BLOCK_F",
// "HALL_B", "RED_CANTEEN") and room codes ("F205").
var placeCodeRx = regexp.MustCompile(`^[A-Z0-9_]{2,40}$`)

const (
	locationReportMinRunes = 5
	locationReportMaxRunes = 1000
)

type locationReportReq struct {
	PlaceCode string `json:"place_code"`
	PlaceName string `json:"place_name"`
	Entrance  string `json:"entrance"`
	Text      string `json:"text"`
}

// CreateLocationReport lets a student say a place's directions or position are wrong.
func (h *Handlers) CreateLocationReport(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req locationReportReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.PlaceCode))
	name := strings.TrimSpace(req.PlaceName)
	text := strings.TrimSpace(req.Text)
	switch {
	case !placeCodeRx.MatchString(code):
		writeError(w, http.StatusBadRequest, "invalid place")
		return
	case utf8.RuneCountInString(name) > 120:
		writeError(w, http.StatusBadRequest, "place name is too long")
		return
	case req.Entrance != "" && req.Entrance != "C" && req.Entrance != "G":
		writeError(w, http.StatusBadRequest, "entrance must be C or G")
		return
	case utf8.RuneCountInString(text) < locationReportMinRunes:
		writeError(w, http.StatusBadRequest, "describe what is wrong")
		return
	case utf8.RuneCountInString(text) > locationReportMaxRunes:
		writeError(w, http.StatusBadRequest, "the report is too long")
		return
	}
	rep, err := h.Store.CreateLocationReport(r.Context(), uid, code, name, req.Entrance, text)
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "you already reported this place")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not send the report")
		return
	}
	writeJSON(w, http.StatusCreated, rep)
}

// ListLocationReports is the admin list (?status=open|fixed|rejected, empty = all).
func (h *Handlers) ListLocationReports(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireModerator(w, r, uid) {
		return
	}
	status := r.URL.Query().Get("status")
	if status != "" && !slices.Contains(store.LocationReportStatuses, status) {
		writeError(w, http.StatusBadRequest, "unknown status")
		return
	}
	reports, err := h.Store.ListLocationReports(r.Context(), status)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list reports")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reports": reports})
}

// SetLocationReportStatus: {"status": "fixed" | "rejected" | "open"}.
func (h *Handlers) SetLocationReportStatus(w http.ResponseWriter, r *http.Request) {
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
	var req struct {
		Status string `json:"status"`
	}
	if err := decodeJSON(r, &req); err != nil || !slices.Contains(store.LocationReportStatuses, req.Status) {
		writeError(w, http.StatusBadRequest, "status must be open, fixed or rejected")
		return
	}
	rep, err := h.Store.SetLocationReportStatus(r.Context(), id, req.Status, uid)
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "this student already has an open report about this place")
		return
	}
	if err != nil {
		writeStoreErr(w, err, "could not update the report")
		return
	}
	writeJSON(w, http.StatusOK, rep)
}
