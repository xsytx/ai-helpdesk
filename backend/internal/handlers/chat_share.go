package handlers

import (
	"net/http"
	"time"

	"campus-forum/internal/models"
)

// ShareChatConversation turns on a chat's read-only link and returns its
// token (the same one when it is already shared).
func (h *Handlers) ShareChatConversation(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid conversation id")
		return
	}
	token, err := h.Store.ShareChatConversation(r.Context(), uid, id)
	if err != nil {
		writeStoreErr(w, err, "could not share the conversation")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"share_token": token})
}

// UnshareChatConversation turns the link off.
func (h *Handlers) UnshareChatConversation(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid conversation id")
		return
	}
	if err := h.Store.UnshareChatConversation(r.Context(), uid, id); err != nil {
		writeStoreErr(w, err, "could not stop sharing the conversation")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// sharedMessage is a message as anyone with the link sees it: no user id,
// no rating.
type sharedMessage struct {
	Role           string    `json:"role"`
	Text           string    `json:"text"`
	ForumAnswer    *string   `json:"forum_answer,omitempty"`
	AIExplanation  *string   `json:"ai_explanation,omitempty"`
	Basis          *string   `json:"basis,omitempty"`
	SourceType     *string   `json:"source_type,omitempty"`
	SourceThreadID *int64    `json:"source_thread_id,omitempty"`
	SourceAccepted bool      `json:"source_accepted,omitempty"`
	SourceLikes    int       `json:"source_likes,omitempty"`
	SourceStaff    bool      `json:"source_staff,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

// GetSharedChat shows a shared chat to anyone with the link (no login).
func (h *Handlers) GetSharedChat(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if token == "" || len(token) > 64 {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	conv, msgs, err := h.Store.SharedChat(r.Context(), token)
	if err != nil {
		writeStoreErr(w, err, "could not load the shared chat")
		return
	}
	out := make([]sharedMessage, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, publicMessage(m))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"conversation": map[string]any{"title": conv.Title, "created_at": conv.CreatedAt},
		"messages":     out,
	})
}

func publicMessage(m models.ChatMessage) sharedMessage {
	return sharedMessage{
		Role: m.Role, Text: m.Text, ForumAnswer: m.ForumAnswer, AIExplanation: m.AIExplanation, Basis: m.Basis,
		SourceType: m.SourceType, SourceThreadID: m.SourceThreadID,
		SourceAccepted: m.SourceAccepted, SourceLikes: m.SourceLikes, SourceStaff: m.SourceStaff,
		CreatedAt: m.CreatedAt,
	}
}
