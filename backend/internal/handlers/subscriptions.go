package handlers

import (
	"context"
	"fmt"
	"net/http"
)

// notifySubscribersByEmail best-effort emails every subscriber of
// threadID (except the commenter) that a new comment was posted. With no
// SMTP configured this just logs (see internal/mailer) — never fails the
// request that triggered it.
func (h *Handlers) notifySubscribersByEmail(ctx context.Context, threadID, actorID int64, actorName string) {
	emails, err := h.Store.SubscriberEmails(ctx, threadID, actorID)
	if err != nil || len(emails) == 0 {
		return
	}
	link := fmt.Sprintf("%s/thread.html?id=%d", h.BaseURL, threadID)
	body := fmt.Sprintf("%s posted a new comment on a thread you're following:\n\n%s", actorName, link)
	for _, email := range emails {
		_ = h.Mailer.Send(email, "New activity on a thread you're following", body)
	}
}

// SubscribeThread and UnsubscribeThread let a user opt in/out of
// notifications for a thread. Creating a thread or posting a comment on
// one auto-subscribes you — these are for following without commenting,
// or opting back out afterward.

func (h *Handlers) SubscribeThread(w http.ResponseWriter, r *http.Request) {
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
	if err := h.Store.SubscribeThread(r.Context(), uid, id); err != nil {
		writeStoreErr(w, err, "could not subscribe")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) UnsubscribeThread(w http.ResponseWriter, r *http.Request) {
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
	if err := h.Store.UnsubscribeThread(r.Context(), uid, id); err != nil {
		writeStoreErr(w, err, "could not unsubscribe")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
