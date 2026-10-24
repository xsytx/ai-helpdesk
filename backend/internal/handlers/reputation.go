package handlers

import (
	"net/http"
	"time"
)

// Leaderboard is "top helpers": ?period=week (default), month or all.
// Public, like the forum itself.
func (h *Handlers) Leaderboard(w http.ResponseWriter, r *http.Request) {
	period := r.URL.Query().Get("period")
	since := time.Now().AddDate(0, 0, -7)
	switch period {
	case "month":
		since = time.Now().AddDate(0, -1, 0)
	case "all":
		since = time.Unix(0, 0)
	default:
		period = "week"
	}
	limit := queryIntDefault(r, "limit", 5, 1, 20)
	helpers, err := h.Store.TopHelpers(r.Context(), since, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load top helpers")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"period": period, "helpers": helpers})
}

// MyReputation is the signed-in student's points and level (Settings).
func (h *Handlers) MyReputation(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	reps, err := h.Store.Reputation(r.Context(), []int64{uid})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load reputation")
		return
	}
	writeJSON(w, http.StatusOK, reps[uid])
}
