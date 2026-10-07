package handlers

import "net/http"

func (h *Handlers) ListNotifications(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	page := queryIntDefault(r, "page", 1, 1, 1<<31-1)
	pageSize := queryIntDefault(r, "page_size", 20, 1, 50)

	notifications, total, unread, err := h.Store.ListNotifications(r.Context(), uid, page, pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list notifications")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"notifications": notifications,
		"page":          page,
		"page_size":     pageSize,
		"total":         total,
		"unread":        unread,
	})
}

// UnreadNotificationCount is the lightweight endpoint the header bell
// polls for its badge — it skips the full ListNotifications JOIN query.
func (h *Handlers) UnreadNotificationCount(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	n, err := h.Store.UnreadNotificationCount(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not count notifications")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"unread": n})
}

func (h *Handlers) MarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid notification id")
		return
	}
	if err := h.Store.MarkNotificationRead(r.Context(), id, uid); err != nil {
		writeStoreErr(w, err, "could not update notification")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) MarkAllNotificationsRead(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if err := h.Store.MarkAllNotificationsRead(r.Context(), uid); err != nil {
		writeError(w, http.StatusInternalServerError, "could not update notifications")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
