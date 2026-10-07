package handlers

import (
	"errors"
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

// CreateThread doesn't require an account right now — posting is
// anonymous (a temporary state; real authorization is coming back
// later). Every thread is attributed to the shared AnonymousUserID
// rather than a real one, so ban/verification checks (which are about a
// real account's standing) don't apply here — there's no real account
// to check.
func (h *Handlers) CreateThread(w http.ResponseWriter, r *http.Request) {
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
	t, err := h.Store.CreateThread(r.Context(), h.AnonymousUserID, store.ThreadInput{
		Title: req.Title, Body: req.Body, Tags: normalizeTags(req.Tags),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create thread")
		return
	}
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
	t, err := h.Store.UpdateThread(r.Context(), id, uid, store.ThreadInput{
		Title: req.Title, Body: req.Body, Tags: normalizeTags(req.Tags),
	})
	if err != nil {
		writeStoreErr(w, err, "could not update thread")
		return
	}
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
	comments, err := h.Store.ListComments(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list comments")
		return
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
	writeJSON(w, http.StatusOK, map[string]any{
		"thread":     t,
		"comments":   comments,
		"subscribed": subscribed,
	})
}

// --- Comments ---

type createCommentReq struct {
	Body            string `json:"body"`
	ParentCommentID *int64 `json:"parent_comment_id,omitempty"`
}

// CreateComment doesn't require an account right now, for the same
// reason as CreateThread — see its comment.
func (h *Handlers) CreateComment(w http.ResponseWriter, r *http.Request) {
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
	c, err := h.Store.CreateComment(r.Context(), threadID, h.AnonymousUserID, req.Body, req.ParentCommentID)
	if err != nil {
		writeStoreErr(w, err, "could not create comment")
		return
	}
	h.notifySubscribersByEmail(r.Context(), threadID, h.AnonymousUserID, c.AuthorName)
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
	c, err := h.Store.UpdateComment(r.Context(), id, uid, req.Body)
	if err != nil {
		writeStoreErr(w, err, "could not update comment")
		return
	}
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
