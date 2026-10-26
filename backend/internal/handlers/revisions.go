package handlers

import (
	"net/http"
)

// ThreadRevisions returns the earlier versions of an edited question —
// to its author and staff only (an edit may have removed something on
// purpose, like a phone number).
func (h *Handlers) ThreadRevisions(w http.ResponseWriter, r *http.Request) {
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
	t, err := h.Store.GetThread(r.Context(), id)
	if err != nil {
		writeStoreErr(w, err, "could not load the question")
		return
	}
	h.writeRevisions(w, r, uid, t.UserID, "thread", id)
}

// CommentRevisions is ThreadRevisions for an answer or reply.
func (h *Handlers) CommentRevisions(w http.ResponseWriter, r *http.Request) {
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
	c, err := h.Store.GetComment(r.Context(), id)
	if err != nil {
		writeStoreErr(w, err, "could not load the answer")
		return
	}
	h.writeRevisions(w, r, uid, c.UserID, "comment", id)
}

func (h *Handlers) writeRevisions(w http.ResponseWriter, r *http.Request, uid, authorID int64, kind string, id int64) {
	if uid != authorID && !h.isModerator(r, uid) {
		writeError(w, http.StatusForbidden, "only the author and staff can see earlier versions")
		return
	}
	revisions, err := h.Store.PostRevisions(r.Context(), kind, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load earlier versions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revisions": revisions})
}
