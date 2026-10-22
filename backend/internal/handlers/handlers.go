// Package handlers implements the HTTP handlers for the SDU Helpdesk API.
package handlers

import (
	"net/http"

	"campus-forum/internal/mailer"
	appmw "campus-forum/internal/middleware"
	"campus-forum/internal/mlclient"
	"campus-forum/internal/store"
)

type Handlers struct {
	Store     store.Store
	JWTSecret []byte
	Mailer    mailer.Mailer
	// UploadDir is where uploaded attachments are written to disk; served
	// back out at /uploads/ (see cmd/server).
	UploadDir string
	// BaseURL is used to build absolute links in emails (thread links in
	// subscriber notifications) — e.g. "http://localhost:8080".
	BaseURL string
	// AllowedEmailDomains restricts registration to these domains
	// (lowercase, no "@") when non-empty; empty means any domain.
	AllowedEmailDomains []string
	// ML is the Python helpdesk service client (generate-answer / moderate / health).
	ML *mlclient.Client
	// Mod is the queue of forum posts the AI moderation held back.
	Mod store.ModerationStore
	// ModCfg controls how new forum posts are checked by the AI moderation.
	ModCfg ModerationConfig
}

func New(s store.Store, jwtSecret []byte, m mailer.Mailer, uploadDir, baseURL string, allowedEmailDomains []string) *Handlers {
	return &Handlers{
		Store: s, JWTSecret: jwtSecret, Mailer: m, UploadDir: uploadDir, BaseURL: baseURL,
		AllowedEmailDomains: allowedEmailDomains,
		ModCfg:              DefaultModerationConfig(),
	}
}

func (h *Handlers) userID(r *http.Request) (int64, bool) {
	return appmw.UserID(r)
}
