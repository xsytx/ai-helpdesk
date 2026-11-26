package handlers

import (
	"net/http"
	"time"

	"campus-forum/internal/store"
)

// --- Admin dashboard (sprint 7, story 19) ---
//
// GET /api/admin/dashboard?days=7|30|90 (staff): counts for the period and
// for the same number of days before it (to compare), today's calls to the AI
// against AI_DAILY_QUOTA, the chat per day, the most asked, unanswered and 👎
// questions, the courses the chat was asked about and forum questions still
// waiting for an answer. Days are Almaty dates (like the AI daily limit); no
// student names.

var dashboardPeriods = map[int]bool{7: true, 30: true, 90: true}

func (h *Handlers) AdminDashboard(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireModerator(w, r, uid) {
		return
	}
	days := queryIntDefault(r, "days", 7, 1, 90)
	if !dashboardPeriods[days] {
		writeError(w, http.StatusBadRequest, "days must be 7, 30 or 90")
		return
	}
	today := chatDay()
	first := time.Date(today.Year(), today.Month(), today.Day()-(days-1), 0, 0, 0, 0, almaty)
	d, err := h.Store.AdminDashboard(r.Context(), first, days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the dashboard")
		return
	}
	d.Days, d.AIQuota = days, h.AIDailyQuota
	if d.Unanswered, err = h.Store.ChatInsights(r.Context(), "unanswered", first, 10); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the dashboard")
		return
	}
	if d.Disliked, err = h.Store.ChatInsights(r.Context(), "disliked", first, 10); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the dashboard")
		return
	}
	// Forum titles may hold @mentions ("@[Name](u12)"): shown as "@Name".
	for i := range d.OpenThreads {
		d.OpenThreads[i].Title = store.PlainMentions(d.OpenThreads[i].Title)
	}
	writeJSON(w, http.StatusOK, d)
}
