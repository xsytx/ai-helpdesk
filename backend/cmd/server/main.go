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
	"strconv"
	"strings"
	"time"

	"campus-forum/internal/handlers"
	"campus-forum/internal/mailer"
	"campus-forum/internal/middleware"
	"campus-forum/internal/mlclient"
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
	if err := pgStore.MigrateModeration(ctx); err != nil {
		log.Fatalf("could not apply moderation schema: %v", err)
	}

	// ADMIN_EMAILS (comma-separated) are promoted to the admin role on
	// every startup. There's no API for granting admin — it's bootstrapped
	// this way on purpose, since that's not something a request should
	// ever be able to grant itself.
	adminEmails := splitCSV(getenv("ADMIN_EMAILS", ""))
	if len(adminEmails) > 0 {
		if err := pgStore.PromoteAdmins(ctx, adminEmails); err != nil {
			log.Fatalf("could not promote admins: %v", err)
		}
	}
	// Admins may register from any email domain (e.g. a shared Gmail for the
	// helpdesk team); students are still limited to ALLOWED_EMAIL_DOMAINS.
	staffRoles := map[string]string{}
	for _, e := range adminEmails {
		staffRoles[e] = "admin"
	}

	mlURL := getenv("ML_SERVICE_URL", "http://127.0.0.1:8001")
	mlTimeoutSec := 180
	if v := getenv("ML_REQUEST_TIMEOUT_SECONDS", "180"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			mlTimeoutSec = n
		}
	}
	mlTimeout := time.Duration(mlTimeoutSec) * time.Second

	h := handlers.New(pgStore, secret, mailer.New(), uploadDir, baseURL, allowedEmailDomains)
	h.StaffRoles = staffRoles
	h.ML = mlclient.New(mlURL, mlTimeout)

	// AI moderation of forum posts (questions and answers). The ML service
	// (ai_ml) classifies each new post as allow / review / block; review and
	// block go to the moderators' queue instead of being published.
	h.Mod = pgStore
	h.ModCfg = handlers.DefaultModerationConfig()
	h.ModCfg.Enabled = !strings.EqualFold(getenv("MODERATION_ENABLED", "true"), "false")
	if strings.EqualFold(getenv("MODERATION_ON_ML_FAILURE", "review"), "error") {
		h.ModCfg.FailMode = "error"
	}
	if n, err := strconv.Atoi(getenv("MODERATION_TIMEOUT_SECONDS", "150")); err == nil && n > 0 {
		h.ModCfg.Timeout = time.Duration(n) * time.Second
	}
	// Finish AI checks interrupted by a restart (posts left in "checking").
	go h.ResumeModerationChecks(ctx)

	// Unpinned AI chats are deleted after CHAT_RETENTION_DAYS without a
	// message (0 keeps them forever).
	if n, err := strconv.Atoi(getenv("CHAT_RETENTION_DAYS", "30")); err == nil && n >= 0 {
		h.ChatRetentionDays = n
	}
	go h.CleanupChatConversations(ctx)

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
	chatLimiter := middleware.NewChatRateLimit()

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
	mux.HandleFunc("GET /api/threads/similar", h.SimilarThreads)
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
	mux.Handle("POST /api/threads", authMw(writeLimiter(http.HandlerFunc(h.CreateThread))))
	mux.Handle("PATCH /api/threads/{id}", authMw(http.HandlerFunc(h.UpdateThread)))
	mux.Handle("DELETE /api/threads/{id}", authMw(http.HandlerFunc(h.DeleteThread)))
	mux.Handle("POST /api/threads/{id}/attachments", authMw(http.HandlerFunc(h.UploadAttachment)))
	mux.Handle("POST /api/threads/{id}/subscribe", authMw(http.HandlerFunc(h.SubscribeThread)))
	mux.Handle("DELETE /api/threads/{id}/subscribe", authMw(http.HandlerFunc(h.UnsubscribeThread)))
	mux.Handle("POST /api/threads/{id}/comments", authMw(writeLimiter(http.HandlerFunc(h.CreateComment))))
	mux.Handle("PATCH /api/comments/{id}", authMw(http.HandlerFunc(h.UpdateComment)))
	mux.Handle("DELETE /api/comments/{id}", authMw(http.HandlerFunc(h.DeleteComment)))
	mux.Handle("POST /api/threads/{id}/vote", authMw(http.HandlerFunc(h.VoteThread)))
	mux.Handle("POST /api/comments/{id}/vote", authMw(http.HandlerFunc(h.VoteComment)))
	mux.Handle("GET /api/notifications", authMw(http.HandlerFunc(h.ListNotifications)))
	mux.Handle("GET /api/notifications/unread-count", authMw(http.HandlerFunc(h.UnreadNotificationCount)))
	mux.Handle("POST /api/notifications/read-all", authMw(http.HandlerFunc(h.MarkAllNotificationsRead)))
	mux.Handle("POST /api/notifications/{id}/read", authMw(http.HandlerFunc(h.MarkNotificationRead)))
	mux.Handle("POST /api/threads/{id}/report", authMw(writeLimiter(http.HandlerFunc(h.ReportThread))))
	mux.Handle("POST /api/comments/{id}/report", authMw(writeLimiter(http.HandlerFunc(h.ReportComment))))
	mux.Handle("POST /api/threads/{id}/accept", authMw(http.HandlerFunc(h.AcceptAnswer)))

	mux.Handle("GET /api/chat/status", authMw(http.HandlerFunc(h.ChatStatus)))
	mux.Handle("GET /api/chat/conversations", authMw(http.HandlerFunc(h.ListChatConversations)))
	mux.Handle("GET /api/chat/conversations/{id}/messages", authMw(http.HandlerFunc(h.GetChatConversationMessages)))
	mux.Handle("PATCH /api/chat/conversations/{id}", authMw(writeLimiter(http.HandlerFunc(h.UpdateChatConversation))))
	mux.Handle("DELETE /api/chat/conversations/{id}", authMw(writeLimiter(http.HandlerFunc(h.DeleteChatConversation))))
	mux.Handle("POST /api/chat/ask", authMw(chatLimiter.Wrap(http.HandlerFunc(h.ChatAsk))))
	// FAQ buttons answer from the database at once, without the model.
	mux.Handle("POST /api/chat/faq", authMw(writeLimiter(http.HandlerFunc(h.ChatFAQ))))
	mux.Handle("PUT /api/chat/messages/{id}/rating", authMw(writeLimiter(http.HandlerFunc(h.RateChatMessage))))

	// --- Moderator/admin API (role checked inside each handler) ---
	mux.Handle("POST /api/threads/{id}/lock", authMw(http.HandlerFunc(h.LockThread)))
	mux.Handle("POST /api/users/{id}/ban", authMw(http.HandlerFunc(h.BanUser)))
	mux.Handle("GET /api/reports", authMw(http.HandlerFunc(h.ListReports)))
	mux.Handle("POST /api/reports/{id}/resolve", authMw(http.HandlerFunc(h.ResolveReport)))
	mux.Handle("GET /api/moderation/queue", authMw(http.HandlerFunc(h.ListModerationQueue)))
	mux.Handle("POST /api/moderation/queue/{id}/approve", authMw(http.HandlerFunc(h.ApproveModeration)))
	mux.Handle("POST /api/moderation/queue/{id}/reject", authMw(http.HandlerFunc(h.RejectModeration)))
	mux.Handle("POST /api/faq", authMw(http.HandlerFunc(h.CreateFAQ)))
	mux.Handle("PATCH /api/faq/{id}", authMw(http.HandlerFunc(h.UpdateFAQ)))
	mux.Handle("DELETE /api/faq/{id}", authMw(http.HandlerFunc(h.DeleteFAQ)))
	mux.Handle("POST /api/faq/reorder", authMw(http.HandlerFunc(h.ReorderFAQs)))
	mux.Handle("GET /api/admin/chat-insights", authMw(http.HandlerFunc(h.ChatInsights)))

	// --- Uploaded attachments --- (the website itself is the React app,
	// served separately by nginx; see the repository root)
	mux.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploadDir))))

	var rootHandler http.Handler = mux
	rootHandler = middleware.CORS(corsOrigin)(rootHandler)

	// Chat/ask can take up to ML_REQUEST_TIMEOUT_SECONDS; keep a small buffer.
	writeTimeout := mlTimeout + 15*time.Second
	if writeTimeout < 30*time.Second {
		writeTimeout = 30 * time.Second
	}

	srv := &http.Server{
		Addr:         addr,
		Handler:      rootHandler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: writeTimeout,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("sdu helpdesk listening on %s (uploads: %s)", addr, uploadDir)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
