package handlers

import (
	"net/http"
	"slices"
	"strings"

	"campus-forum/internal/store"
)

func (h *Handlers) Stats(w http.ResponseWriter, r *http.Request) {
	st, err := h.Store.Stats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load stats")
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// ListFeed serves the Threads-app-style home feed: every thread, newest
// (or top, or most-commented) first.
func (h *Handlers) ListFeed(w http.ResponseWriter, r *http.Request) {
	sort := r.URL.Query().Get("sort")
	if sort != "top" && sort != "comments" && sort != "unanswered" {
		sort = "new"
	}
	page := queryIntDefault(r, "page", 1, 1, 1<<31-1)
	pageSize := queryIntDefault(r, "page_size", 20, 1, 50)

	// ?tags=dorm,food: questions with any of these topics (unknown names are ignored).
	var tags []string
	for _, name := range strings.Split(r.URL.Query().Get("tags"), ",") {
		if name = strings.ToLower(strings.TrimSpace(name)); store.IsForumTag(name) && !slices.Contains(tags, name) {
			tags = append(tags, name)
		}
	}

	threads, total, err := h.Store.ListFeed(r.Context(), sort, tags, page, pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load feed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"threads":   threads,
		"page":      page,
		"page_size": pageSize,
		"total":     total,
	})
}
