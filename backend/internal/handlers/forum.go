package handlers

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"campus-forum/internal/markdown"
	"campus-forum/internal/store"
)

// --- Search ---

func (h *Handlers) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeError(w, http.StatusBadRequest, "q is required")
		return
	}
	page := queryIntDefault(r, "page", 1, 1, 1<<31-1)
	pageSize := queryIntDefault(r, "page_size", 20, 1, 50)

	threads, total, err := h.Store.SearchThreads(r.Context(), q, page, pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not search")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"threads":   threads,
		"page":      page,
		"page_size": pageSize,
		"total":     total,
		"q":         q,
	})
}

// --- Threads ---

func pathInt64(r *http.Request, key string) (int64, error) {
	return strconv.ParseInt(r.PathValue(key), 10, 64)
}

// queryIntDefault parses an integer query param, clamped to [min, max],
// falling back to def if the param is missing or not a valid integer.
func queryIntDefault(r *http.Request, key string, def, min, max int) int {
	v, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		return def
	}
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

type threadReq struct {
	Title string   `json:"title"`
	Body  string   `json:"body"`
	Tags  []string `json:"tags"`
}

// normalizeTags lowercases, trims, dedupes, and caps at 8 tags — plenty
// for a forum post, and enough to keep the trending-tags widget useful.
func normalizeTags(raw []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(raw))
	for _, t := range raw {
		t = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(t), "#")))
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
		if len(out) == 8 {
			break
		}
	}
	return out
}

// CreateThread posts a thread as the logged-in user, who must have a
// verified email and not be banned.
func (h *Handlers) CreateThread(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireNotBanned(w, r, uid) || !h.requireVerified(w, r, uid) {
		return
	}
	var req threadReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Body = strings.TrimSpace(req.Body)
	if req.Title == "" || req.Body == "" {
		writeError(w, http.StatusBadRequest, "title and body are required")
		return
	}
	tags := normalizeTags(req.Tags)
	// AI moderation: obvious swearing is refused at once (202 + notice); anything
	// else is published now and checked in the background (see moderation_queue.go).
	if !h.moderationGate(w, r, uid, pendingPost{Kind: "thread", Title: req.Title, Body: req.Body, Tags: tags}) {
		return
	}
	t, err := h.Store.CreateThread(r.Context(), uid, store.ThreadInput{
		Title: req.Title, Body: req.Body, Tags: tags,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create thread")
		return
	}
	t.ModerationStatus = h.startBackgroundCheck(store.PostToCheck{
		Kind: "thread", ID: t.ID, UserID: uid, Title: t.Title, Body: t.Body, Tags: tags,
	})
	writeJSON(w, http.StatusCreated, t)
}

func (h *Handlers) UpdateThread(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid thread id")
		return
	}
	var req threadReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Body = strings.TrimSpace(req.Body)
	if req.Title == "" || req.Body == "" {
		writeError(w, http.StatusBadRequest, "title and body are required")
		return
	}
	tags := normalizeTags(req.Tags)
	if !h.moderationEditGate(w, r, "thread", id, moderationText(req.Title, req.Body, tags)) {
		return
	}
	t, err := h.Store.UpdateThread(r.Context(), id, uid, store.ThreadInput{
		Title: req.Title, Body: req.Body, Tags: tags,
	})
	if err != nil {
		writeStoreErr(w, err, "could not update thread")
		return
	}
	t.ModerationStatus = h.startBackgroundCheck(store.PostToCheck{
		Kind: "thread", ID: t.ID, UserID: uid, Title: t.Title, Body: t.Body, Tags: tags,
	})
	writeJSON(w, http.StatusOK, t)
}

func (h *Handlers) DeleteThread(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid thread id")
		return
	}
	if h.isModerator(r, uid) {
		err = h.Store.AdminDeleteThread(r.Context(), id)
	} else {
		err = h.Store.DeleteThread(r.Context(), id, uid)
	}
	if err != nil {
		writeStoreErr(w, err, "could not delete thread")
		return
	}
	// The post is gone: its reports have nothing left to review.
	if err := h.Store.ResolveReportsFor(r.Context(), "thread", id); err != nil {
		log.Printf("resolve reports for deleted thread %d: %v", id, err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) GetThread(w http.ResponseWriter, r *http.Request) {
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid thread id")
		return
	}
	t, err := h.Store.GetThread(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "thread not found")
		return
	}
	// Posts hidden by moderation are visible only to their author and to
	// moderators (the author sees them marked "under review").
	viewer, loggedIn := h.userID(r)
	staff := loggedIn && h.isModerator(r, viewer)
	canSee := func(status string, authorID int64) bool {
		return status == "ok" || status == "checking" || status == "" || staff || (loggedIn && authorID == viewer)
	}
	if !canSee(t.ModerationStatus, t.UserID) {
		writeError(w, http.StatusNotFound, "thread not found")
		return
	}
	all, err := h.Store.ListComments(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list comments")
		return
	}
	comments := all[:0]
	for _, c := range all {
		if canSee(c.ModerationStatus, c.UserID) {
			comments = append(comments, c)
		}
	}
	// Markdown is only rendered on the full detail view — list/feed views
	// show a plain-text snippet instead, which sidesteps truncating a
	// render mid-tag.
	t.BodyHTML = markdown.Render(t.Body)
	for i := range comments {
		comments[i].BodyHTML = markdown.Render(comments[i].Body)
	}
	var subscribed bool
	if uid, ok := h.userID(r); ok {
		subscribed, _ = h.Store.IsSubscribed(r.Context(), uid, id)
	}
	// Reputation badges for the people on the page.
	authors := []int64{t.UserID}
	for _, c := range comments {
		authors = append(authors, c.UserID)
	}
	reputation, err := h.Store.Reputation(r.Context(), authors)
	if err != nil {
		log.Printf("reputation for thread %d: %v", id, err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"thread":     t,
		"comments":   comments,
		"subscribed": subscribed,
		"reputation": reputation,
	})
}

// --- Comments ---

type createCommentReq struct {
	Body            string `json:"body"`
	ParentCommentID *int64 `json:"parent_comment_id,omitempty"`
}

// CreateComment posts a reply as the logged-in user, under the same
// rules as CreateThread.
func (h *Handlers) CreateComment(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireNotBanned(w, r, uid) || !h.requireVerified(w, r, uid) {
		return
	}
	threadID, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid thread id")
		return
	}
	var req createCommentReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		writeError(w, http.StatusBadRequest, "body is required")
		return
	}
	if !h.moderationGate(w, r, uid, pendingPost{Kind: "comment", Body: req.Body, ThreadID: &threadID, ParentCommentID: req.ParentCommentID}) {
		return
	}
	c, err := h.Store.CreateComment(r.Context(), threadID, uid, req.Body, req.ParentCommentID)
	if err != nil {
		writeStoreErr(w, err, "could not create comment")
		return
	}
	c.ModerationStatus = h.startBackgroundCheck(store.PostToCheck{
		Kind: "comment", ID: c.ID, UserID: uid, Body: c.Body, ThreadID: &threadID, ParentCommentID: req.ParentCommentID,
	})
	// With moderation on, subscribers are emailed once the AI check passes.
	if c.ModerationStatus == "ok" {
		h.notifySubscribersByEmail(r.Context(), threadID, uid, c.AuthorName)
	}
	writeJSON(w, http.StatusCreated, c)
}

type updateCommentReq struct {
	Body string `json:"body"`
}

func (h *Handlers) UpdateComment(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid comment id")
		return
	}
	var req updateCommentReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		writeError(w, http.StatusBadRequest, "body is required")
		return
	}
	if !h.moderationEditGate(w, r, "comment", id, req.Body) {
		return
	}
	c, err := h.Store.UpdateComment(r.Context(), id, uid, req.Body)
	if err != nil {
		writeStoreErr(w, err, "could not update comment")
		return
	}
	threadID := c.ThreadID
	c.ModerationStatus = h.startBackgroundCheck(store.PostToCheck{
		Kind: "comment", ID: c.ID, UserID: uid, Body: c.Body, ThreadID: &threadID, ParentCommentID: c.ParentCommentID,
	})
	writeJSON(w, http.StatusOK, c)
}

func (h *Handlers) DeleteComment(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid comment id")
		return
	}
	if h.isModerator(r, uid) {
		err = h.Store.AdminDeleteComment(r.Context(), id)
	} else {
		err = h.Store.DeleteComment(r.Context(), id, uid)
	}
	if err != nil {
		writeStoreErr(w, err, "could not delete comment")
		return
	}
	if err := h.Store.ResolveReportsFor(r.Context(), "comment", id); err != nil {
		log.Printf("resolve reports for deleted comment %d: %v", id, err)
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Votes ---

type voteReq struct {
	Value int `json:"value"`
}

func (h *Handlers) VoteThread(w http.ResponseWriter, r *http.Request) {
	h.vote(w, r, "thread")
}

func (h *Handlers) VoteComment(w http.ResponseWriter, r *http.Request) {
	h.vote(w, r, "comment")
}

func (h *Handlers) vote(w http.ResponseWriter, r *http.Request, targetType string) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req voteReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !h.requireNotBanned(w, r, uid) {
		return
	}
	score, err := h.Store.Vote(r.Context(), uid, targetType, id, req.Value)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		if errors.Is(err, store.ErrInvalidTarget) {
			writeError(w, http.StatusBadRequest, "value must be 1 or -1")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not record vote")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"score": score})
}
