package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"campus-forum/internal/store"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

// writeStoreErr maps the sentinel errors returned by store.Store into the
// right HTTP status, falling back to 500 with fallbackMsg for anything else.
func writeStoreErr(w http.ResponseWriter, err error, fallbackMsg string) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, store.ErrForbidden):
		writeError(w, http.StatusForbidden, "you don't own this")
	case errors.Is(err, store.ErrConflict):
		writeError(w, http.StatusConflict, "conflict")
	case errors.Is(err, store.ErrUsernameTaken):
		writeError(w, http.StatusConflict, "that display name is already taken")
	case errors.Is(err, store.ErrLocked):
		writeError(w, http.StatusLocked, "this thread is locked")
	case errors.Is(err, store.ErrInvalidTarget):
		writeError(w, http.StatusBadRequest, "invalid target")
	default:
		writeError(w, http.StatusInternalServerError, fallbackMsg)
	}
}
