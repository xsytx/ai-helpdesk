package middleware

import (
	"context"
	"net"
	"net/http"
	"strings"
	"sync"

	"golang.org/x/time/rate"

	"campus-forum/internal/auth"
)

type ctxKey string

const userIDKey ctxKey = "userID"

// Auth extracts and validates the Bearer token, requiring authentication.
func Auth(secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			if !strings.HasPrefix(h, "Bearer ") {
				http.Error(w, `{"error":"missing bearer token"}`, http.StatusUnauthorized)
				return
			}
			tok := strings.TrimPrefix(h, "Bearer ")
			claims, err := auth.ParseToken(secret, tok)
			if err != nil {
				http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), userIDKey, claims.UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// OptionalAuth extracts a user id from the token if present, but does not require it.
func OptionalAuth(secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			if strings.HasPrefix(h, "Bearer ") {
				if claims, err := auth.ParseToken(secret, strings.TrimPrefix(h, "Bearer ")); err == nil {
					r = r.WithContext(context.WithValue(r.Context(), userIDKey, claims.UserID))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// UserID reads the authenticated user id set by Auth/OptionalAuth, if any.
func UserID(r *http.Request) (int64, bool) {
	v := r.Context().Value(userIDKey)
	if v == nil {
		return 0, false
	}
	id, ok := v.(int64)
	return id, ok
}

// CORS allows the static frontend (possibly served from a different origin
// during development) to call the API. allowedOrigin is normally "*" for
// local dev; set CORS_ALLOWED_ORIGIN to lock it down for a real deployment.
func CORS(allowedOrigin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Logging is a minimal request logger.
func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
	})
}

// RateLimit caps each client IP to rps requests/second (bursting up to
// burst) before reaching next. Each call to RateLimit creates an
// independent set of per-IP buckets, so wrap different route groups
// separately for different limits (e.g. a tight one on /login, a looser
// one on posting). Buckets are never evicted, which is fine at the scale
// this app runs at (a single long-lived process) but would want a
// cleanup goroutine before this saw real production traffic.
func RateLimit(rps float64, burst int) func(http.Handler) http.Handler {
	var mu sync.Mutex
	limiters := map[string]*rate.Limiter{}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := clientIP(r)
			mu.Lock()
			lim, ok := limiters[ip]
			if !ok {
				lim = rate.NewLimiter(rate.Limit(rps), burst)
				limiters[ip] = lim
			}
			mu.Unlock()
			if !lim.Allow() {
				http.Error(w, `{"error":"too many requests — slow down and try again shortly"}`, http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return strings.TrimSpace(strings.Split(fwd, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
