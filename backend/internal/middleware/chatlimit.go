package middleware

import (
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ChatRateLimit allows one in-flight chat/ask per user and caps sustained
// traffic at about ten requests per minute per user.
type ChatRateLimit struct {
	mu     sync.Mutex
	active map[int64]bool
	rates  map[int64]*rate.Limiter
}

func NewChatRateLimit() *ChatRateLimit {
	return &ChatRateLimit{
		active: map[int64]bool{},
		rates:  map[int64]*rate.Limiter{},
	}
}

func (l *ChatRateLimit) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid, ok := UserID(r)
		if !ok {
			http.Error(w, `{"error":"not authenticated"}`, http.StatusUnauthorized)
			return
		}

		l.mu.Lock()
		if l.active[uid] {
			l.mu.Unlock()
			http.Error(w, `{"error":"please wait for the current answer to finish"}`, http.StatusTooManyRequests)
			return
		}
		lim, ok := l.rates[uid]
		if !ok {
			lim = rate.NewLimiter(rate.Every(6*time.Second), 10)
			l.rates[uid] = lim
		}
		l.mu.Unlock()

		if !lim.Allow() {
			http.Error(w, `{"error":"too many chat requests — try again in a minute"}`, http.StatusTooManyRequests)
			return
		}

		l.mu.Lock()
		l.active[uid] = true
		l.mu.Unlock()
		defer func() {
			l.mu.Lock()
			delete(l.active, uid)
			l.mu.Unlock()
		}()

		next.ServeHTTP(w, r)
	})
}
