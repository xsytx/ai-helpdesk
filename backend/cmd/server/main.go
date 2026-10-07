// Command server runs the SDU Helpdesk backend: a JSON REST API plus the static
// frontend, all from a single Go binary, backed by PostgreSQL.
package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/base64"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"campus-forum/internal/handlers"
	"campus-forum/internal/mailer"
	"campus-forum/internal/middleware"
	"campus-forum/internal/store"
)

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// splitCSV splits a comma-separated env value into trimmed, lowercased,
// non-empty parts.
func splitCSV(raw string) []string {
	if raw == "" {
		return nil
	}
	var out []string
	for e := range strings.SplitSeq(raw, ",") {
		if e = strings.TrimSpace(strings.ToLower(e)); e != "" {
			out = append(out, e)
		}
	}
	return out
}

// loadDotEnv reads KEY=VALUE lines from a .env file in the working
// directory, if one exists, and applies them via os.Setenv — but only for
// keys not already set in the real environment, so `ADMIN_EMAILS=x go run
// ./cmd/server` or a Docker Compose `environment:` block still wins over
// whatever .env says. Blank lines and lines starting with # are skipped;
// values may be wrapped in matching single or double quotes. This is a
// convenience for local development — export the variables yourself (or
// set them in docker-compose.yml) for anything that isn't just you
// running the binary from a terminal or an IDE's Run button.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return // no .env file — nothing to do, not an error
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		if key == "" {
			continue
		}
		if _, alreadySet := os.LookupEnv(key); !alreadySet {
			os.Setenv(key, value)
		}
	}
}

func loadOrGenerateSecret(path string) ([]byte, error) {
	if b, err := os.ReadFile(path); err == nil && len(b) > 0 {
		return b, nil
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	enc := []byte(base64.StdEncoding.EncodeToString(buf))
	if err := os.WriteFile(path, enc, 0o600); err != nil {
		// Not fatal: fall back to an in-memory secret (tokens won't
		// survive a restart, but the server still works).
		log.Printf("warning: could not persist JWT secret to %s: %v", path, err)
		return enc, nil
	}
	return enc, nil
}

func main() {
	loadDotEnv(".env")

	addr := getenv("ADDR", ":8080")
	databaseURL := getenv("DATABASE_URL", "postgres://campus_forum:campus_forum@localhost:5432/campus_forum?sslmode=disable")
	secretFile := getenv("JWT_SECRET_FILE", "jwt.secret")
	webDir := getenv("WEB_DIR", "web")
	uploadDir := getenv("UPLOAD_DIR", "uploads")
	baseURL := strings.TrimSuffix(getenv("BASE_URL", "http://localhost"+addr), "/")
	corsOrigin := getenv("CORS_ALLOWED_ORIGIN", "*")
	// Registration is restricted to @sdu.edu.kz by default — this is SDU's
	// own forum. Unlike getenv's other uses, "unset" and "set to empty"
	// need to mean different things here (empty is a deliberate way to
	// lift the restriction, e.g. for local testing with throwaway
	// addresses), so this reads the environment directly rather than
	// through getenv, which can't tell the two apart.
	allowedEmailDomainsRaw, allowedEmailDomainsSet := os.LookupEnv("ALLOWED_EMAIL_DOMAINS")
	if !allowedEmailDomainsSet {
		allowedEmailDomainsRaw = "sdu.edu.kz"
	}
	allowedEmailDomains := splitCSV(allowedEmailDomainsRaw)

	secret, err := loadOrGenerateSecret(secretFile)
	if err != nil {
		log.Fatalf("could not set up JWT secret: %v", err)
	}
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		log.Fatalf("could not create upload dir %s: %v", uploadDir, err)
	}

	ctx := context.Background()
	pgStore, err := store.NewPostgresStore(ctx, databaseURL)
	if err != nil {
		log.Fatalf("could not connect to postgres at %s: %v", databaseURL, err)
	}
	defer pgStore.Close()
	if err := pgStore.Migrate(ctx); err != nil {
		log.Fatalf("could not apply database schema: %v", err)
	}

	// ADMIN_EMAILS (comma-separated) are promoted to the admin role on
	// every startup. There's no API for granting admin — it's bootstrapped
	// this way on purpose, since that's not something a request should
	// ever be able to grant itself.
	if emails := splitCSV(getenv("ADMIN_EMAILS", "")); len(emails) > 0 {
		if err := pgStore.PromoteAdmins(ctx, emails); err != nil {
			log.Fatalf("could not promote admins: %v", err)
		}
	}

	// Posting doesn't require an account right now (see CreateThread/
	// CreateComment) — every post is attributed to this shared system
	// account instead, seeded idempotently by the migration.
	anonUser, err := pgStore.GetUserByEmail(ctx, "anonymous@system.local")
	if err != nil {
		log.Fatalf("could not load the anonymous system user: %v", err)
	}

	h := handlers.New(pgStore, secret, mailer.New(), uploadDir, baseURL, allowedEmailDomains, anonUser.ID)

	mux := http.NewServeMux()
	authMw := middleware.Auth(secret)
	optionalAuthMw := middleware.OptionalAuth(secret)
	// A tight limit on auth endpoints slows down credential-stuffing /
	// registration-spam attempts; a looser one covers general write
	// traffic. Both are per-IP (see middleware.RateLimit) and reset
	// gradually rather than as a hard window, so a burst of normal use
	// doesn't get punished the way a fixed-window counter would.
	authLimiter := middleware.RateLimit(0.2, 5) // ~1 attempt/5s, bursts of 5
	writeLimiter := middleware.RateLimit(2, 20) // ~2/s sustained, bursts of 20

	// --- Public API ---
	mux.Handle("POST /api/register", authLimiter(http.HandlerFunc(h.Register)))
	mux.Handle("POST /api/login", authLimiter(http.HandlerFunc(h.Login)))
	mux.Handle("POST /api/forgot-password", authLimiter(http.HandlerFunc(h.ForgotPassword)))
	mux.Handle("POST /api/reset-password/verify", authLimiter(http.HandlerFunc(h.VerifyResetCode)))
	mux.Handle("POST /api/reset-password", authLimiter(http.HandlerFunc(h.ResetPassword)))
	mux.HandleFunc("GET /api/search", h.Search)
	mux.HandleFunc("GET /api/feed", h.ListFeed)
	mux.HandleFunc("GET /api/stats", h.Stats)
	mux.HandleFunc("GET /api/faq", h.ListFAQs)
	mux.HandleFunc("GET /api/tags/trending", h.TrendingTags)
	mux.HandleFunc("GET /api/tags/{name}/threads", h.ListThreadsByTag)
	mux.Handle("GET /api/threads/{id}", optionalAuthMw(http.HandlerFunc(h.GetThread)))
	mux.HandleFunc("GET /api/users/{id}", h.GetUserProfile)
	mux.HandleFunc("GET /api/users/{id}/threads", h.ListUserThreads)
	mux.HandleFunc("GET /api/users/{id}/comments", h.ListUserComments)

	// --- Authenticated API ---
	mux.Handle("GET /api/me", authMw(http.HandlerFunc(h.Me)))
	mux.Handle("PATCH /api/me", authMw(http.HandlerFunc(h.UpdateProfile)))
	mux.Handle("POST /api/me/password", authMw(http.HandlerFunc(h.ChangePassword)))
	// Rate-limited like the other auth endpoints: verifying is "type in a
	// secret" (a brute-forceable 6-digit code) and resending emails, so
	// both need the same per-IP throttle as login/register.
	mux.Handle("POST /api/verify-email", authMw(authLimiter(http.HandlerFunc(h.VerifyEmail))))
	mux.Handle("POST /api/resend-verification", authMw(authLimiter(http.HandlerFunc(h.ResendVerification))))
	// CreateThread/CreateComment deliberately skip authMw: posting doesn't
	// require an account right now (anonymous posting, a temporary state
	// — see those handlers), though they keep writeLimiter since anyone
	// can now hit them. Everything else here still requires login.
	mux.Handle("POST /api/threads", writeLimiter(http.HandlerFunc(h.CreateThread)))
	mux.Handle("PATCH /api/threads/{id}", authMw(http.HandlerFunc(h.UpdateThread)))
	mux.Handle("DELETE /api/threads/{id}", authMw(http.HandlerFunc(h.DeleteThread)))
	mux.Handle("POST /api/threads/{id}/attachments", authMw(http.HandlerFunc(h.UploadAttachment)))
	mux.Handle("POST /api/threads/{id}/subscribe", authMw(http.HandlerFunc(h.SubscribeThread)))
	mux.Handle("DELETE /api/threads/{id}/subscribe", authMw(http.HandlerFunc(h.UnsubscribeThread)))
	mux.Handle("POST /api/threads/{id}/comments", writeLimiter(http.HandlerFunc(h.CreateComment)))
	mux.Handle("PATCH /api/comments/{id}", authMw(http.HandlerFunc(h.UpdateComment)))
	mux.Handle("DELETE /api/comments/{id}", authMw(http.HandlerFunc(h.DeleteComment)))
	mux.Handle("POST /api/threads/{id}/vote", authMw(http.HandlerFunc(h.VoteThread)))
	mux.Handle("POST /api/comments/{id}/vote", authMw(http.HandlerFunc(h.VoteComment)))
	mux.Handle("GET /api/notifications", authMw(http.HandlerFunc(h.ListNotifications)))
	mux.Handle("GET /api/notifications/unread-count", authMw(http.HandlerFunc(h.UnreadNotificationCount)))
	mux.Handle("POST /api/notifications/read-all", authMw(http.HandlerFunc(h.MarkAllNotificationsRead)))
	mux.Handle("POST /api/notifications/{id}/read", authMw(http.HandlerFunc(h.MarkNotificationRead)))
	mux.Handle("POST /api/threads/{id}/report", authMw(http.HandlerFunc(h.ReportThread)))
	mux.Handle("POST /api/comments/{id}/report", authMw(http.HandlerFunc(h.ReportComment)))

	// --- Moderator/admin API (role checked inside each handler) ---
	mux.Handle("POST /api/threads/{id}/lock", authMw(http.HandlerFunc(h.LockThread)))
	mux.Handle("POST /api/users/{id}/ban", authMw(http.HandlerFunc(h.BanUser)))
	mux.Handle("GET /api/reports", authMw(http.HandlerFunc(h.ListReports)))
	mux.Handle("POST /api/reports/{id}/resolve", authMw(http.HandlerFunc(h.ResolveReport)))
	mux.Handle("POST /api/faq", authMw(http.HandlerFunc(h.CreateFAQ)))
	mux.Handle("PATCH /api/faq/{id}", authMw(http.HandlerFunc(h.UpdateFAQ)))
	mux.Handle("DELETE /api/faq/{id}", authMw(http.HandlerFunc(h.DeleteFAQ)))

	// --- Uploaded attachments + static frontend ---
	mux.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploadDir))))
	mux.Handle("/", http.FileServer(http.Dir(webDir)))

	var rootHandler http.Handler = mux
	rootHandler = middleware.CORS(corsOrigin)(rootHandler)

	srv := &http.Server{
		Addr:         addr,
		Handler:      rootHandler,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("sdu helpdesk listening on %s (web dir: %s, uploads: %s)", addr, webDir, uploadDir)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
