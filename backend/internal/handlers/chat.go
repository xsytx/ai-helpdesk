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
	if _, err := h.Store.CreateChatMessage(saveCtx, uid, models.ChatMessage{
		Role: "user", Text: question,
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
	if _, err := h.Store.CreateChatMessage(saveCtx, uid, models.ChatMessage{
		Role:          "assistant",
		Text:          assistantText,
		ForumAnswer:   forumPtr,
		AIExplanation: aiExplPtr,
		Basis:         basisPtr,
		Language:      langPtr,
	}); err != nil {
		log.Printf("chat history save assistant message: %v", err)
	}

	writeJSON(w, http.StatusOK, buildChatAskResp(mlResp))
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

func (h *Handlers) ChatHistory(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	page := queryIntDefault(r, "page", 1, 1, 1<<31-1)
	pageSize := queryIntDefault(r, "page_size", 100, 1, 200)

	messages, total, err := h.Store.ListChatMessages(r.Context(), uid, page, pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load chat history")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"messages":  messages,
		"page":      page,
		"page_size": pageSize,
		"total":     total,
	})
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
