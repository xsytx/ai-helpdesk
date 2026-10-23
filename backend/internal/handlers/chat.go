package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"campus-forum/internal/mlclient"
	"campus-forum/internal/models"
)

type chatAskReq struct {
	Question string `json:"question"`
	// ConversationID continues an existing conversation; without it the
	// question starts a new one, titled with the question.
	ConversationID *int64 `json:"conversation_id,omitempty"`
}

type chatSourcePublic struct {
	Question string `json:"question"`
	Category string `json:"category"`
}

type chatAskResp struct {
	RequestID     string            `json:"request_id"`
	Status        string            `json:"status"`
	Answer        string            `json:"answer"`
	ForumAnswer   *string           `json:"forum_answer"`
	AIExplanation string            `json:"ai_explanation,omitempty"`
	Language      string            `json:"language"`
	Basis         string            `json:"basis"`
	Source        *chatSourcePublic `json:"source"`
	// Conversation the question and answer were saved to.
	Conversation *models.ChatConversation `json:"conversation,omitempty"`
}

// chatTitleRunes is the length of a title made from the first question;
// a title the student types may be up to chatTitleMaxRunes.
const (
	chatTitleRunes    = 60
	chatTitleMaxRunes = 100
)

// chatTitleFromQuestion turns the first question into a one-line title.
func chatTitleFromQuestion(q string) string {
	title := strings.Join(strings.Fields(q), " ")
	if utf8.RuneCountInString(title) <= chatTitleRunes {
		return title
	}
	runes := []rune(title)
	return strings.TrimSpace(string(runes[:chatTitleRunes-1])) + "…"
}

func (h *Handlers) ChatAsk(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req chatAskReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	question := strings.TrimSpace(req.Question)
	if question == "" {
		writeError(w, http.StatusBadRequest, "question must not be empty")
		return
	}
	if utf8.RuneCountInString(question) > 2000 {
		writeError(w, http.StatusBadRequest, "question is too long")
		return
	}

	var conv *models.ChatConversation
	if req.ConversationID != nil {
		c, err := h.Store.GetChatConversation(r.Context(), uid, *req.ConversationID)
		if err != nil {
			writeStoreErr(w, err, "could not load the conversation")
			return
		}
		conv = &c
	}

	if h.ML == nil {
		writeError(w, http.StatusServiceUnavailable, "the assistant is temporarily unavailable")
		return
	}

	started := time.Now()
	mlResp, err := h.ML.GenerateAnswer(r.Context(), question)
	elapsed := time.Since(started)
	if err != nil {
		log.Printf("chat ask ml error (user=%d, duration=%s): %v", uid, elapsed, err)
		switch {
		case errors.Is(err, mlclient.ErrBadRequest):
			writeError(w, http.StatusBadRequest, "could not process your question")
		case errors.Is(err, mlclient.ErrUnavailable):
			writeError(w, http.StatusServiceUnavailable, "the assistant is temporarily unavailable")
		default:
			writeError(w, http.StatusBadGateway, "the assistant could not answer right now")
		}
		return
	}
	log.Printf("chat ask ok (user=%d, request_id=%s, duration=%s, basis=%s, status=%s)",
		uid, mlResp.RequestID, elapsed, mlResp.Basis, mlResp.Status)

	// Save with a context that survives a closed browser tab: the model already spent
	// the time to answer, the answer should still land in the student's history.
	saveCtx := context.WithoutCancel(r.Context())
	// A new conversation is only created once there is an answer, so failed
	// questions don't leave empty chats in the list.
	if conv == nil {
		c, err := h.Store.CreateChatConversation(saveCtx, uid, chatTitleFromQuestion(question))
		if err != nil {
			log.Printf("chat create conversation (user=%d): %v", uid, err)
			writeError(w, http.StatusInternalServerError, "could not save the conversation")
			return
		}
		conv = &c
	}
	if _, err := h.Store.CreateChatMessage(saveCtx, uid, models.ChatMessage{
		ConversationID: conv.ID, Role: "user", Text: question,
	}); err != nil {
		log.Printf("chat history save user message: %v", err)
	}

	assistantText := mlResp.Answer
	var forumPtr *string
	if mlResp.ForumAnswer != nil && *mlResp.ForumAnswer != "" {
		forumPtr = mlResp.ForumAnswer
	}
	var aiExplPtr *string
	if mlResp.AIExplanation != "" {
		aiExplPtr = &mlResp.AIExplanation
	}
	basis := mlResp.Basis
	basisPtr := &basis
	lang := mlResp.Language
	langPtr := &lang
	saved, err := h.Store.CreateChatMessage(saveCtx, uid, models.ChatMessage{
		ConversationID: conv.ID,
		Role:           "assistant",
		Text:           assistantText,
		ForumAnswer:    forumPtr,
		AIExplanation:  aiExplPtr,
		Basis:          basisPtr,
		Language:       langPtr,
	})
	if err != nil {
		log.Printf("chat history save assistant message: %v", err)
	} else {
		conv.UpdatedAt = saved.CreatedAt
	}

	resp := buildChatAskResp(mlResp)
	resp.Conversation = conv
	writeJSON(w, http.StatusOK, resp)
}

func buildChatAskResp(mlResp mlclient.GenerateResult) chatAskResp {
	out := chatAskResp{
		RequestID:     mlResp.RequestID,
		Status:        mlResp.Status,
		Answer:        mlResp.Answer,
		ForumAnswer:   mlResp.ForumAnswer,
		AIExplanation: mlResp.AIExplanation,
		Language:      mlResp.Language,
		Basis:         mlResp.Basis,
	}
	if mlResp.Source != nil {
		out.Source = &chatSourcePublic{
			Question: mlResp.Source.Question,
			Category: mlResp.Source.Category,
		}
	}
	return out
}

// ListChatConversations returns the user's chats, pinned first, then the
// most recently active, plus how long an unpinned chat is kept.
func (h *Handlers) ListChatConversations(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	convs, err := h.Store.ListChatConversations(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load conversations")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"conversations":  convs,
		"retention_days": h.ChatRetentionDays,
	})
}

func (h *Handlers) GetChatConversationMessages(w http.ResponseWriter, r *http.Request) {
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
	conv, err := h.Store.GetChatConversation(r.Context(), uid, id)
	if err != nil {
		writeStoreErr(w, err, "could not load the conversation")
		return
	}
	messages, err := h.Store.ListChatMessages(r.Context(), uid, id)
	if err != nil {
		writeStoreErr(w, err, "could not load chat history")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"conversation": conv,
		"messages":     messages,
	})
}

type chatConversationPatch struct {
	Title  *string `json:"title,omitempty"`
	Pinned *bool   `json:"pinned,omitempty"`
}

// UpdateChatConversation renames and/or pins a chat.
func (h *Handlers) UpdateChatConversation(w http.ResponseWriter, r *http.Request) {
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
	var req chatConversationPatch
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Title == nil && req.Pinned == nil {
		writeError(w, http.StatusBadRequest, "nothing to change")
		return
	}
	if req.Title != nil {
		title := strings.Join(strings.Fields(*req.Title), " ")
		if title == "" {
			writeError(w, http.StatusBadRequest, "title must not be empty")
			return
		}
		if utf8.RuneCountInString(title) > chatTitleMaxRunes {
			writeError(w, http.StatusBadRequest, "title is too long")
			return
		}
		req.Title = &title
	}
	conv, err := h.Store.UpdateChatConversation(r.Context(), uid, id, req.Title, req.Pinned)
	if err != nil {
		writeStoreErr(w, err, "could not update the conversation")
		return
	}
	writeJSON(w, http.StatusOK, conv)
}

func (h *Handlers) DeleteChatConversation(w http.ResponseWriter, r *http.Request) {
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
	if err := h.Store.DeleteChatConversation(r.Context(), uid, id); err != nil {
		writeStoreErr(w, err, "could not delete the conversation")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// CleanupChatConversations deletes unpinned chats without a message for
// ChatRetentionDays, now and then every hour, until ctx ends. A retention of
// 0 or less keeps chats forever.
func (h *Handlers) CleanupChatConversations(ctx context.Context) {
	if h.ChatRetentionDays <= 0 {
		return
	}
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		cutoff := time.Now().AddDate(0, 0, -h.ChatRetentionDays)
		if n, err := h.Store.DeleteStaleChatConversations(ctx, cutoff); err != nil {
			log.Printf("chat cleanup: %v", err)
		} else if n > 0 {
			log.Printf("chat cleanup: deleted %d conversations inactive for %d days", n, h.ChatRetentionDays)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (h *Handlers) ChatStatus(w http.ResponseWriter, r *http.Request) {
	if h.ML == nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "degraded"})
		return
	}
	health, err := h.ML.Health(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "degraded"})
		return
	}
	status := health.Status
	if status == "" {
		status = "degraded"
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": status})
}
