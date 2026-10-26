// Package events passes "something changed for you" signals to a user's
// open pages (GET /api/notifications/stream).
package events

import "sync"

// Event: a notification of this user changed, about this question.
type Event struct {
	ThreadID int64 `json:"thread_id"`
}

// Hub keeps the open streams per user. Safe for concurrent use.
type Hub struct {
	mu   sync.Mutex
	subs map[int64]map[chan Event]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: map[int64]map[chan Event]struct{}{}}
}

// Subscribe opens a stream for userID; call cancel when the page goes away.
func (h *Hub) Subscribe(userID int64) (<-chan Event, func()) {
	ch := make(chan Event, 16)
	h.mu.Lock()
	if h.subs[userID] == nil {
		h.subs[userID] = map[chan Event]struct{}{}
	}
	h.subs[userID][ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs[userID], ch)
		if len(h.subs[userID]) == 0 {
			delete(h.subs, userID)
		}
		h.mu.Unlock()
	}
}

// Publish tells every open page of userID. A page that is behind just
// misses this one (it refreshes everything on the next event anyway).
func (h *Hub) Publish(userID, threadID int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[userID] {
		select {
		case ch <- Event{ThreadID: threadID}:
		default:
		}
	}
}
