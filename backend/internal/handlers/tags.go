package handlers

import "net/http"

func (h *Handlers) TrendingTags(w http.ResponseWriter, r *http.Request) {
	limit := queryIntDefault(r, "limit", 10, 1, 50)
	tags, err := h.Store.TrendingTags(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list tags")
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

func (h *Handlers) ListThreadsByTag(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		writeError(w, http.StatusBadRequest, "tag name is required")
		return
	}
	page := queryIntDefault(r, "page", 1, 1, 1<<31-1)
	pageSize := queryIntDefault(r, "page_size", 20, 1, 50)

	threads, total, err := h.Store.ListThreadsByTag(r.Context(), name, page, pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list threads")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"threads":   threads,
		"page":      page,
		"page_size": pageSize,
		"total":     total,
	})
}
