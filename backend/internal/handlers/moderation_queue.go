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

/// ModerationConfig controls how forum posts are checked by the AI.
//
// Flow (Story 10): an instant word-filter check runs before a post is saved;
// obvious swearing is never published. Everything else is published right
// away (status "checking") and the full AI check runs in the background: on
// allow the post stays, on review/block it is hidden ("held") and goes to the
// moderators' queue. So posting never waits for the language model.
type ModerationConfig struct {
	// Enabled=false lets every post through unchecked (local development).
	Enabled bool
	// FailMode is what happens when the background AI check gets no verdict.
	// Both "review" (default) and "error" hide the post and queue it: by then
	// there is no user request left to fail. Kept for config compatibility.
	FailMode string
	// Timeout bounds one background AI check. No user waits for it, so it can
	// be generous (the ML service may queue requests behind others).
	Timeout time.Duration
	// FastTimeout bounds the instant word-filter check done before saving.
	FastTimeout time.Duration
}

// DefaultModerationConfig is the safe default: check everything, hide on failure.
func DefaultModerationConfig() ModerationConfig {
	return ModerationConfig{Enabled: true, FailMode: "review", Timeout: 150 * time.Second, FastTimeout: 2 * time.Second}
}

// moderationNotice is the 202 body the website shows instead of the new post
// (only when the instant check blocked it, so it was never published).
type moderationNotice struct {
	Status     string   `json:"status"`   // always "pending_moderation"
	Decision   string   `json:"decision"` // "block" or "review"
	Categories []string `json:"categories"`
	QueueID    int64    `json:"queue_id"`
}

// pendingPost is a new thread/comment about to be checked.
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

// verdictFor asks the ML service for the full verdict (word filter + LLM).
// ok=false means "no clean verdict".
func (h *Handlers) verdictFor(ctx context.Context, text string) (v mlclient.ModerationResult, ok bool) {
	if utf8.RuneCountInString(text) > maxModerationChars {
		return mlclient.ModerationResult{Decision: "review", Reason: "too_long_to_check"}, true
	}
	timeout := h.ModCfg.Timeout
	if timeout <= 0 {
		timeout = 150 * time.Second
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

// quickVerdict runs only the word filter. ok=false means it could not run
// (the post is then published and left to the background check).
func (h *Handlers) quickVerdict(ctx context.Context, text string) (v mlclient.ModerationResult, ok bool) {
	if utf8.RuneCountInString(text) > maxModerationChars {
		return mlclient.ModerationResult{}, false
	}
	timeout := h.ModCfg.FastTimeout
	if timeout <= 0 {
		timeout = 2 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	res, err := h.ML.ModerateFast(ctx, text)
	if err != nil {
		log.Printf("moderation: instant check unavailable, relying on the background check: %v", err)
		return mlclient.ModerationResult{}, false
	}
	return res, true
}

func (h *Handlers) moderationActive() bool {
	return h.ModCfg.Enabled && h.ML != nil && h.Mod != nil
}

// moderationGate runs the instant check before a new post is saved. It
// returns true when the post may be published now (the caller then saves it
// and calls startBackgroundCheck). On false it has ALREADY written the HTTP
// response (202 + notice after queueing the blocked post, or an error).
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

	verdict, ok := h.quickVerdict(r.Context(), moderationText(p.Title, p.Body, p.Tags))
	if !ok || verdict.Decision != "block" {
		return true
	}
	// Obvious swearing: never published. Kept for the moderators' log.
	item, err := h.Mod.CreateModerationItem(r.Context(), store.ModerationInput{
		Kind: p.Kind, UserID: uid, Title: p.Title, Body: p.Body, Tags: p.Tags,
		ThreadID: p.ThreadID, ParentCommentID: p.ParentCommentID,
		Decision: "block", Categories: verdict.Categories, Reason: verdict.Reason,
		PolicyVersion: verdict.PolicyVersion, MLRequestID: verdict.RequestID,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeStoreErr(w, err, "could not create comment")
			return false
		}
		log.Printf("moderation: could not save blocked post to queue: %v", err)
		writeError(w, http.StatusInternalServerError, "could not submit your post for review")
		return false
	}
	log.Printf("moderation: user=%d kind=%s decision=block (instant) reason=%s queue_id=%d", uid, p.Kind, verdict.Reason, item.ID)
	writeJSON(w, http.StatusAccepted, moderationNotice{
		Status: "pending_moderation", Decision: "block",
		Categories: nonNilStrings(verdict.Categories), QueueID: item.ID,
	})
	return false
}

// moderationEditGate checks an EDIT of a published post before it is saved:
// posts under review cannot be edited (that would sidestep the moderator),
// and obvious swearing is refused at once. The full AI check of the new text
// then runs in the background (call startBackgroundCheck after saving).
func (h *Handlers) moderationEditGate(w http.ResponseWriter, r *http.Request, kind string, id int64, text string) bool {
	if !h.moderationActive() {
		return true
	}
	status, err := h.Mod.PostModerationStatus(r.Context(), kind, id)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeStoreErr(w, err, "could not update the post")
		return false
	case err != nil:
		writeError(w, http.StatusInternalServerError, "could not update the post")
		return false
	case status == "held" || status == "rejected":
		writeError(w, http.StatusConflict, "this post is under review by a moderator and cannot be edited")
		return false
	}
	verdict, ok := h.quickVerdict(r.Context(), text)
	if !ok || verdict.Decision != "block" {
		return true
	}
	writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
		"error":      "your edit was not saved: it needs to follow the community rules",
		"decision":   verdict.Decision,
		"categories": nonNilStrings(verdict.Categories),
	})
	return false
}

// backgroundSlots bounds how many AI checks run at once (the ML service has
// its own queue; this just keeps the backend from piling up goroutines).
var backgroundSlots = make(chan struct{}, 4)

// startBackgroundCheck marks a just-saved post as "checking" and runs the
// full AI check without making the user wait. Returns the status to report.
func (h *Handlers) startBackgroundCheck(p store.PostToCheck) string {
	if !h.moderationActive() {
		return "ok"
	}
	if err := h.Mod.SetPostModerationStatus(context.Background(), p.Kind, p.ID, "checking"); err != nil {
		log.Printf("moderation: could not mark %s %d as checking: %v", p.Kind, p.ID, err)
	}
	go h.runBackgroundCheck(p)
	return "checking"
}

func (h *Handlers) runBackgroundCheck(p store.PostToCheck) {
	backgroundSlots <- struct{}{}
	defer func() { <-backgroundSlots }()
	ctx := context.Background()

	verdict, ok := h.verdictFor(ctx, moderationText(p.Title, p.Body, p.Tags))
	if !ok {
		verdict = mlclient.ModerationResult{Decision: "review", Reason: "moderation_unavailable"}
	}
	// The post may have been deleted meanwhile.
	if status, err := h.Mod.PostModerationStatus(ctx, p.Kind, p.ID); err != nil || status != "checking" {
		return
	}
	if verdict.Decision == "allow" && verdict.PublishAllowed {
		if err := h.Mod.SetPostModerationStatus(ctx, p.Kind, p.ID, "ok"); err != nil {
			log.Printf("moderation: could not mark %s %d as ok: %v", p.Kind, p.ID, err)
			return
		}
		if p.Kind == "comment" && p.ThreadID != nil {
			h.notifySubscribersByEmail(ctx, *p.ThreadID, p.UserID, h.authorName(ctx, p.UserID))
		}
		return
	}
	if verdict.Decision != "block" {
		verdict.Decision = "review" // "review", or anything unexpected: a human looks at it
	}
	if err := h.Mod.SetPostModerationStatus(ctx, p.Kind, p.ID, "held"); err != nil {
		log.Printf("moderation: could not hide %s %d: %v", p.Kind, p.ID, err)
		return
	}
	in := store.ModerationInput{
		Kind: p.Kind, UserID: p.UserID, Title: p.Title, Body: p.Body, Tags: p.Tags,
		ThreadID: p.ThreadID, ParentCommentID: p.ParentCommentID,
		Decision: verdict.Decision, Categories: verdict.Categories, Reason: verdict.Reason,
		PolicyVersion: verdict.PolicyVersion, MLRequestID: verdict.RequestID,
	}
	id := p.ID
	if p.Kind == "thread" {
		in.PublishedThreadID = &id
	} else {
		in.PublishedCommentID = &id
	}
	item, err := h.Mod.CreateModerationItem(ctx, in)
	if err != nil {
		// The post stays hidden; it can still be found in the database.
		log.Printf("moderation: %s %d hidden but not queued: %v", p.Kind, p.ID, err)
		return
	}
	log.Printf("moderation: user=%d kind=%s id=%d decision=%s reason=%s queue_id=%d (hidden after publishing)",
		p.UserID, p.Kind, p.ID, verdict.Decision, verdict.Reason, item.ID)
}

func (h *Handlers) authorName(ctx context.Context, uid int64) string {
	if u, err := h.Store.GetUserByID(ctx, uid); err == nil {
		return u.DisplayName
	}
	return ""
}

// ResumeModerationChecks finishes AI checks that were still running when the
// server stopped, so no post stays in "checking" forever. Call once at startup.
func (h *Handlers) ResumeModerationChecks(ctx context.Context) {
	if !h.moderationActive() {
		return
	}
	posts, err := h.Mod.PostsToCheck(ctx, 500)
	if err != nil {
		log.Printf("moderation: could not list unfinished checks: %v", err)
		return
	}
	if len(posts) > 0 {
		log.Printf("moderation: resuming %d unfinished check(s)", len(posts))
	}
	for _, p := range posts {
		go h.runBackgroundCheck(p)
	}
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
	// Optional date range for the moderation log: from=YYYY-MM-DD (inclusive),
	// to=YYYY-MM-DD (inclusive, whole day).
	filter := store.ModerationFilter{Status: status}
	switch sort := r.URL.Query().Get("sort"); sort {
	case "", "new", "old":
		filter.Sort = sort
	default:
		writeError(w, http.StatusBadRequest, "sort must be new or old")
		return
	}
	for _, p := range []struct {
		key string
		dst **time.Time
		add time.Duration
	}{{"from", &filter.From, 0}, {"to", &filter.To, 24 * time.Hour}} {
		raw := r.URL.Query().Get(p.key)
		if raw == "" {
			continue
		}
		d, err := time.Parse("2006-01-02", raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, p.key+" must be a date like 2026-10-22")
			return
		}
		d = d.Add(p.add)
		*p.dst = &d
	}
	page := queryIntDefault(r, "page", 1, 1, 100000)
	pageSize := queryIntDefault(r, "page_size", 20, 1, 100)
	items, total, pending, err := h.Mod.ListModerationItems(r.Context(), filter, page, pageSize)
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

	// Hidden after publishing (async check): just show it again.
	if claimed.PublishedThreadID != nil || claimed.PublishedCommentID != nil {
		kind, postID := "thread", claimed.PublishedThreadID
		if claimed.PublishedCommentID != nil {
			kind, postID = "comment", claimed.PublishedCommentID
		}
		if err := h.Mod.SetPostModerationStatus(ctx, kind, *postID, "ok"); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusConflict, "this post no longer exists - reject it")
				return
			}
			log.Printf("moderation: could not unhide %s %d: %v", kind, *postID, err)
			writeError(w, http.StatusInternalServerError, "could not publish the post")
			return
		}
		if kind == "comment" && claimed.ThreadID != nil {
			h.notifySubscribersByEmail(ctx, *claimed.ThreadID, claimed.UserID, claimed.AuthorName)
		}
		final, err := h.Mod.GetModerationItem(ctx, id)
		if err != nil {
			final = claimed
		}
		writeJSON(w, http.StatusOK, final)
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
	// Hidden after publishing (async check): keep it hidden for good.
	if item.PublishedThreadID != nil {
		err = h.Mod.SetPostModerationStatus(r.Context(), "thread", *item.PublishedThreadID, "rejected")
	} else if item.PublishedCommentID != nil {
		err = h.Mod.SetPostModerationStatus(r.Context(), "comment", *item.PublishedCommentID, "rejected")
	}
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		log.Printf("moderation: queue item %d rejected but post status not updated: %v", id, err)
	}
	writeJSON(w, http.StatusOK, item)
}
