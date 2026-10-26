package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// notificationPing keeps the stream open through nginx (read timeout 200 s).
const notificationPing = 25 * time.Second

// NotificationStream keeps a page told about its user's notifications as
// they happen (Server-Sent Events): "data: {thread_id}" on every new,
// changed or removed notification, a comment line as a keep-alive. The page
// then reloads the bell and that question.
func (h *Handlers) NotificationStream(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if h.Events == nil {
		writeError(w, http.StatusServiceUnavailable, "live notifications are off")
		return
	}
	rc := http.NewResponseController(w)
	// The server's write timeout is for normal requests; this one stays open.
	_ = rc.SetWriteDeadline(time.Time{})
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no") // nginx: pass every event on at once
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, ": connected\n\n")
	_ = rc.Flush()

	events, cancel := h.Events.Subscribe(uid)
	defer cancel()
	ping := time.NewTicker(notificationPing)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-events:
			b, _ := json.Marshal(ev)
			if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
				return
			}
		case <-ping.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
		}
		if err := rc.Flush(); err != nil {
			return
		}
	}
}
