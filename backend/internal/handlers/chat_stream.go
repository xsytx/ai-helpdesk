package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"campus-forum/internal/mlclient"
	"campus-forum/internal/models"
)

// chatStreamDone is the last line of a streamed answer: the same fields as
// ChatAsk's response, plus "type".
type chatStreamDone struct {
	Type string `json:"type"`
	chatAskResp
}

// assistantMessage is the saved form of a model answer.
func assistantMessage(res mlclient.GenerateResult) models.ChatMessage {
	m := models.ChatMessage{Role: "assistant", Text: res.Answer, Basis: &res.Basis, Language: &res.Language}
	if res.ForumAnswer != nil && *res.ForumAnswer != "" {
		m.ForumAnswer = res.ForumAnswer
	}
	if res.AIExplanation != "" {
		m.AIExplanation = &res.AIExplanation
	}
	if len(res.Followups) > 0 {
		m.Followups = res.Followups
	}
	if m.ForumAnswer != nil && res.SourceType != nil {
		m.SourceType = res.SourceType
		if *res.SourceType == "forum" && res.Source != nil {
			m.SourceThreadID = res.Source.ThreadID
			m.SourceCommentID = res.Source.CommentID
			m.SourceAccepted, m.SourceLikes, m.SourceStaff = res.Source.Accepted, res.Source.Likes, res.Source.Staff
		}
	}
	return m
}

// ChatAskStream answers like ChatAsk, but sends the answer while the model
// writes it, as NDJSON lines (one JSON object per line):
//
//	{"type":"conversation","conversation":{…}}   once, with the first text
//	{"type":"delta","text":"…"}                   the next piece of the answer
//	{"type":"reset"}                               drop the text so far, it restarts
//	{"type":"done", …the fields of ChatAsk's answer}
//	{"type":"error","status":503,"error":"…"}     the model failed after text was sent
//
// Problems before any text (bad request, unknown chat, model unavailable)
// are ordinary HTTP errors, as with ChatAsk, and save nothing. A new chat is
// created with the first text, so failed questions leave no empty chats. If
// the student stops the answer (closes the request), the text written so
// far is saved with basis "stopped".
func (h *Handlers) ChatAskStream(w http.ResponseWriter, r *http.Request) {
	uid, question, conv, ok := h.readChatAsk(w, r)
	if !ok {
		return
	}
	rc := http.NewResponseController(w)
	enc := json.NewEncoder(w)
	headerSent := false
	send := func(v any) {
		if !headerSent {
			w.Header().Set("Content-Type", "application/x-ndjson")
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("X-Accel-Buffering", "no") // nginx: pass every line on at once
			w.WriteHeader(http.StatusOK)
			headerSent = true
		}
		_ = enc.Encode(v)
		_ = rc.Flush()
	}
	// Saves survive the student closing the tab or pressing "stop".
	saveCtx := context.WithoutCancel(r.Context())

	if f, lang, ok := h.faqFor(r, question); ok {
		_, answer := f.Text(lang)
		basis := "faq"
		conv, messageID, err := h.saveChatTurn(saveCtx, uid, conv, question, models.ChatMessage{
			Role: "assistant", Text: answer, Basis: &basis, Language: &lang,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not save the conversation")
			return
		}
		send(chatStreamDone{Type: "done", chatAskResp: chatAskResp{
			RequestID: "faq-" + strconv.FormatInt(f.ID, 10), Status: "answered", Answer: answer, Language: lang, Basis: basis,
			Source: &chatSourcePublic{Question: question, Category: f.Category}, Conversation: conv, MessageID: messageID,
		}})
		return
	}
	if h.ML == nil {
		writeError(w, http.StatusServiceUnavailable, "the assistant is temporarily unavailable")
		return
	}

	background := h.chatBackground(r.Context(), uid, conv)
	var partial strings.Builder
	started := false
	// begin creates the chat (if new) and saves the question, then opens the
	// stream with the conversation, once the model has started answering.
	begin := func() error {
		if started {
			return nil
		}
		if conv == nil {
			c, err := h.Store.CreateChatConversation(saveCtx, uid, chatTitleFromQuestion(question))
			if err != nil {
				return err
			}
			conv = &c
		}
		if _, err := h.Store.CreateChatMessage(saveCtx, uid, models.ChatMessage{
			ConversationID: conv.ID, Role: "user", Text: question,
		}); err != nil {
			log.Printf("chat stream save question: %v", err)
		}
		started = true
		send(map[string]any{"type": "conversation", "conversation": conv})
		return nil
	}

	startedAt := time.Now()
	var beginErr error
	result, err := h.ML.GenerateAnswerStream(r.Context(), question, background, func(ev mlclient.StreamEvent) {
		if beginErr != nil {
			return
		}
		if beginErr = begin(); beginErr != nil {
			return
		}
		switch ev.Type {
		case "delta":
			partial.WriteString(ev.Text)
			send(map[string]any{"type": "delta", "text": ev.Text})
		case "reset":
			partial.Reset()
			send(map[string]any{"type": "reset"})
		}
	})
	if beginErr == nil && err == nil {
		beginErr = begin() // an answer without any streamed text (e.g. the AI fell back)
	}
	if beginErr != nil {
		log.Printf("chat stream create conversation (user=%d): %v", uid, beginErr)
		if !headerSent {
			writeError(w, http.StatusInternalServerError, "could not save the conversation")
		}
		return
	}

	if err != nil {
		stopped := errors.Is(err, context.Canceled) || r.Context().Err() != nil
		log.Printf("chat stream ended early (user=%d, duration=%s, stopped=%v): %v", uid, time.Since(startedAt), stopped, err)
		if !started {
			if !stopped {
				writeMLError(w, err)
			}
			return
		}
		if text := strings.TrimSpace(partial.String()); text != "" {
			basis := "stopped"
			if _, serr := h.Store.CreateChatMessage(saveCtx, uid, models.ChatMessage{
				ConversationID: conv.ID, Role: "assistant", Text: text, Basis: &basis,
			}); serr != nil {
				log.Printf("chat stream save stopped answer: %v", serr)
			}
		}
		if !stopped {
			status := http.StatusBadGateway
			if errors.Is(err, mlclient.ErrUnavailable) {
				status = http.StatusServiceUnavailable
			}
			send(map[string]any{"type": "error", "status": status, "error": "the assistant could not finish the answer"})
		}
		return
	}

	log.Printf("chat stream ok (user=%d, request_id=%s, duration=%s, basis=%s)", uid, result.RequestID, time.Since(startedAt), result.Basis)
	resp := buildChatAskResp(result)
	assistant := assistantMessage(result)
	assistant.ConversationID = conv.ID
	if saved, serr := h.Store.CreateChatMessage(saveCtx, uid, assistant); serr != nil {
		log.Printf("chat stream save answer: %v", serr)
	} else {
		resp.MessageID = saved.ID
		conv.UpdatedAt = saved.CreatedAt
	}
	resp.Conversation = conv
	send(chatStreamDone{Type: "done", chatAskResp: resp})
}
