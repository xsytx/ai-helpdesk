package handlers

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"campus-forum/internal/mlclient"
	"campus-forum/internal/store"
)

// ML /moderate accepts at most this many characters.
const maxModerationChars = 10000

// ModerationConfig controls how new forum posts are checked by the AI.
type ModerationConfig struct {
	// Enabled=false lets every post through unchecked (local development).
	Enabled bool
	// FailMode is what happens when the ML service cannot give a verdict:
	// "review" (default) sends the post to the moderators' queue,
	// "error" refuses the request with 503 so the user can retry later.
	FailMode string
	// Timeout bounds one moderation call. Keep it below the reverse proxy's
	// read timeout (nginx default is 60s).
	Timeout time.Duration
}

// DefaultModerationConfig is the safe default: check everything, queue on failure.
func DefaultModerationConfig() ModerationConfig {
	return ModerationConfig{Enabled: true, FailMode: "review", Timeout: 45 * time.Second}
}

// moderationNotice is the 202 body the website shows instead of the new post.
type moderationNotice struct {
	Status     string   `json:"status"`   // always "pending_moderation"
	Decision   string   `json:"decision"` // "block" or "review"
	Categories []string `json:"categories"`
	QueueID    int64    `json:"queue_id"`
}

// pendingPost is a new thread/comment waiting for the AI's verdict.
type pendingPost struct {
	Kind            string // "thread" or "comment"
	Title           string
	Body            string
	Tags            []string
	ThreadID        *int64
	ParentCommentID *int64
}

func moderationText(title, body string, tags []string) string {
	parts := make([]string, 0, 3)
	if title != "" {
		parts = append(parts, title)
	}
	parts = append(parts, body)
	if len(tags) > 0 {
		parts = append(parts, strings.Join(tags, " "))
	}
	return strings.Join(parts, "\n\n")
}

// verdictFor asks the ML service. ok=false means "no clean verdict".
func (h *Handlers) verdictFor(ctx context.Context, text string) (v mlclient.ModerationResult, ok bool) {
	if utf8.RuneCountInString(text) > maxModerationChars {
		return mlclient.ModerationResult{Decision: "review", Reason: "too_long_to_check"}, true
	}
	timeout := h.ModCfg.Timeout
	if timeout <= 0 {
		timeout = 45 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	res, err := h.ML.Moderate(ctx, text)
	if err != nil {
		log.Printf("moderation: no verdict from ML service: %v", err)
		return mlclient.ModerationResult{}, false
	}
	return res, true
}

func (h *Handlers) moderationActive() bool {
	return h.ModCfg.Enabled && h.ML != nil && h.Mod != nil
}

// moderationGate decides whether a new post may be published right now.
// It returns true for "allow". Otherwise it has ALREADY written the HTTP
// response (202 + notice after saving the post to the moderators' queue,
// or an error) and the caller must stop.
func (h *Handlers) moderationGate(w http.ResponseWriter, r *http.Request, uid int64, p pendingPost) bool {
	if !h.moderationActive() {
		return true
	}
	// Do not send a comment on a missing or locked thread to the AI or the queue.
	if p.Kind == "comment" && p.ThreadID != nil {
		t, err := h.Store.GetThread(r.Context(), *p.ThreadID)
		if err != nil {
			writeStoreErr(w, err, "could not create comment")
			return false
		}
		if t.LockedAt != nil {
			writeStoreErr(w, store.ErrLocked, "could not create comment")
			return false
		}
	}

	verdict, ok := h.verdictFor(r.Context(), moderationText(p.Title, p.Body, p.Tags))
	if !ok {
		if h.ModCfg.FailMode == "error" {
			writeError(w, http.StatusServiceUnavailable, "moderation is temporarily unavailable, please try again in a minute")
			return false
		}
		verdict = mlclient.ModerationResult{Decision: "review", Reason: "moderation_unavailable"}
	}
	if verdict.Decision == "allow" && verdict.PublishAllowed {
		return true
	}
	if verdict.Decision != "block" {
		verdict.Decision = "review" // "review", or anything unexpected: a human looks at it
	}

	item, err := h.Mod.CreateModerationItem(r.Context(), store.ModerationInput{
		Kind: p.Kind, UserID: uid, Title: p.Title, Body: p.Body, Tags: p.Tags,
		ThreadID: p.ThreadID, ParentCommentID: p.ParentCommentID,
		Decision: verdict.Decision, Categories: verdict.Categories, Reason: verdict.Reason,
		PolicyVersion: verdict.PolicyVersion, MLRequestID: verdict.RequestID,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeStoreErr(w, err, "could not create comment")
			return false
		}
		log.Printf("moderation: could not save post to queue: %v", err)
		// Never publish unchecked content just because the queue write failed.
		writeError(w, http.StatusInternalServerError, "could not submit your post for review")
		return false
	}
	log.Printf("moderation: user=%d kind=%s decision=%s reason=%s queue_id=%d", uid, p.Kind, verdict.Decision, verdict.Reason, item.ID)
	writeJSON(w, http.StatusAccepted, moderationNotice{
		Status: "pending_moderation", Decision: verdict.Decision,
		Categories: nonNilStrings(verdict.Categories), QueueID: item.ID,
	})
	return false
}

// moderationEditGate checks an EDIT of an already published post. Edits are
// not queued: anything other than a clear "allow" refuses the edit, so a
// post cannot be made abusive after it was approved.
func (h *Handlers) moderationEditGate(w http.ResponseWriter, r *http.Request, text string) bool {
	if !h.moderationActive() {
		return true
	}
	verdict, ok := h.verdictFor(r.Context(), text)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "moderation is temporarily unavailable, please try again in a minute")
		return false
	}
	if verdict.Decision == "allow" && verdict.PublishAllowed {
		return true
	}
	writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
		"error":      "your edit was not saved: it needs to follow the community rules",
		"decision":   verdict.Decision,
		"categories": nonNilStrings(verdict.Categories),
	})
	return false
}

func nonNilStrings(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// --- Moderator/admin endpoints ---

type reviewReq struct {
	Note string `json:"note"`
}

// decodeReview reads the optional {"note": "..."} body.
func decodeReview(r *http.Request) (reviewReq, bool) {
	var req reviewReq
	if err := decodeJSON(r, &req); err != nil && !errors.Is(err, io.EOF) {
		return reviewReq{}, false
	}
	req.Note = strings.TrimSpace(req.Note)
	if utf8.RuneCountInString(req.Note) > 500 {
		return reviewReq{}, false
	}
	return req, true
}

func (h *Handlers) moderatorOnly(w http.ResponseWriter, r *http.Request) (int64, bool) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return 0, false
	}
	if !h.requireModerator(w, r, uid) {
		return 0, false
	}
	if h.Mod == nil {
		writeError(w, http.StatusServiceUnavailable, "moderation queue is not available")
		return 0, false
	}
	return uid, true
}

// ListModerationQueue: GET /api/moderation/queue?status=pending|approved|rejected|all
func (h *Handlers) ListModerationQueue(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.moderatorOnly(w, r); !ok {
		return
	}
	status := r.URL.Query().Get("status")
	switch status {
	case "":
		status = "pending"
	case "pending", "approved", "rejected", "all":
	default:
		writeError(w, http.StatusBadRequest, "status must be pending, approved, rejected or all")
		return
	}
	page := queryIntDefault(r, "page", 1, 1, 100000)
	pageSize := queryIntDefault(r, "page_size", 20, 1, 100)
	items, total, pending, err := h.Mod.ListModerationItems(r.Context(), status, page, pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the moderation queue")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "page": page, "page_size": pageSize, "total": total, "pending": pending,
	})
}

// ApproveModeration: POST /api/moderation/queue/{id}/approve — publishes the held post.
func (h *Handlers) ApproveModeration(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.moderatorOnly(w, r)
	if !ok {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	req, ok := decodeReview(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	ctx := r.Context()

	item, err := h.Mod.GetModerationItem(ctx, id)
	if err != nil {
		writeStoreErr(w, err, "could not load the post")
		return
	}
	if item.Status != "pending" {
		writeError(w, http.StatusConflict, "this post was already reviewed")
		return
	}
	if author, err := h.Store.GetUserByID(ctx, item.UserID); err != nil {
		writeStoreErr(w, err, "could not load the author")
		return
	} else if author.BannedAt != nil {
		writeError(w, http.StatusConflict, "the author's account is suspended - reject this post instead")
		return
	}

	// Claim first (pending -> approved), so two moderators cannot publish it twice.
	claimed, err := h.Mod.ClaimModerationItem(ctx, id, uid, req.Note)
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeError(w, http.StatusConflict, "this post was already reviewed")
			return
		}
		writeStoreErr(w, err, "could not approve the post")
		return
	}

	var threadID, commentID *int64
	var pubErr error
	switch claimed.Kind {
	case "thread":
		t, err := h.Store.CreateThread(ctx, claimed.UserID, store.ThreadInput{
			Title: claimed.Title, Body: claimed.Body, Tags: claimed.Tags,
		})
		pubErr = err
		if err == nil {
			threadID = &t.ID
		}
	case "comment":
		if claimed.ThreadID == nil {
			pubErr = store.ErrNotFound
			break
		}
		c, err := h.Store.CreateComment(ctx, *claimed.ThreadID, claimed.UserID, claimed.Body, claimed.ParentCommentID)
		pubErr = err
		if err == nil {
			commentID = &c.ID
		}
	default:
		pubErr = store.ErrInvalidTarget
	}
	if pubErr != nil {
		if err := h.Mod.ReleaseModerationItem(ctx, id); err != nil {
			log.Printf("moderation: could not release item %d after failed publish: %v", id, err)
		}
		switch {
		case errors.Is(pubErr, store.ErrLocked):
			writeError(w, http.StatusLocked, "the thread is locked - unlock it first or reject this post")
		case errors.Is(pubErr, store.ErrNotFound), errors.Is(pubErr, store.ErrInvalidTarget):
			writeError(w, http.StatusConflict, "the thread or comment this post belongs to no longer exists - reject it")
		default:
			log.Printf("moderation: publishing item %d failed: %v", id, pubErr)
			writeError(w, http.StatusInternalServerError, "could not publish the post")
		}
		return
	}
	if err := h.Mod.SetModerationPublished(ctx, id, threadID, commentID); err != nil {
		log.Printf("moderation: item %d published but link not saved: %v", id, err)
	}
	if commentID != nil && claimed.ThreadID != nil {
		h.notifySubscribersByEmail(ctx, *claimed.ThreadID, claimed.UserID, claimed.AuthorName)
	}
	final, err := h.Mod.GetModerationItem(ctx, id)
	if err != nil {
		final = claimed
	}
	writeJSON(w, http.StatusOK, final)
}

// RejectModeration: POST /api/moderation/queue/{id}/reject — the post is never published.
func (h *Handlers) RejectModeration(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.moderatorOnly(w, r)
	if !ok {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	req, ok := decodeReview(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	item, err := h.Mod.RejectModerationItem(r.Context(), id, uid, req.Note)
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeError(w, http.StatusConflict, "this post was already reviewed")
			return
		}
		writeStoreErr(w, err, "could not reject the post")
		return
	}
	writeJSON(w, http.StatusOK, item)
}
