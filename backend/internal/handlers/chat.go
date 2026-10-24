package handlers

import (
	"context"
	"errors"
	"fmt"
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
	// A forum answer: the question it answers and whether it is the accepted one.
	ThreadID *int64 `json:"thread_id,omitempty"`
	Accepted bool   `json:"accepted,omitempty"`
}

type chatAskResp struct {
	RequestID     string            `json:"request_id"`
	Status        string            `json:"status"`
	Answer        string            `json:"answer"`
	ForumAnswer   *string           `json:"forum_answer"`
	AIExplanation string            `json:"ai_explanation,omitempty"`
	Language      string            `json:"language"`
	Basis         string            `json:"basis"`
	// SourceType: "faq" (knowledge base) or "forum" (community answer).
	SourceType string            `json:"source_type,omitempty"`
	Source     *chatSourcePublic `json:"source"`
	// Followups: questions the student may ask next (buttons under the answer).
	Followups []string `json:"followups,omitempty"`
	// Conversation the question and answer were saved to.
	Conversation *models.ChatConversation `json:"conversation,omitempty"`
	// MessageID is the saved answer (for 👍/👎); 0 if saving it failed.
	MessageID int64 `json:"message_id,omitempty"`
}

// chatHistoryMessages is how much of the conversation the model gets with
// a question, so it understands follow-ups ("and how much is it?").
const chatHistoryMessages = 6

// chatForumCandidates is how many answered forum questions are offered to
// the model with each question; it picks the closest ones by meaning.
const chatForumCandidates = 200

// chatBackground is what the model gets with a question: the chat so far
// and the forum's answered questions (Stories 8-9). A failed forum read
// only means the model answers without the forum.
func (h *Handlers) chatBackground(ctx context.Context, uid int64, conv *models.ChatConversation) mlclient.Background {
	bg := mlclient.Background{History: h.chatHistory(ctx, uid, conv)}
	answers, err := h.Store.ForumAnswers(ctx, chatForumCandidates)
	if err != nil {
		log.Printf("forum answers for the model: %v", err)
		return bg
	}
	for _, a := range answers {
		bg.Forum = append(bg.Forum, mlclient.ForumCandidate{
			ThreadID: a.ThreadID, Title: a.Title, Body: a.Body, Answer: a.Answer,
			Accepted: a.Accepted, Likes: a.Likes, Staff: a.Staff,
		})
	}
	return bg
}

// chatHistory returns the last messages of conv for the model, oldest first.
func (h *Handlers) chatHistory(ctx context.Context, uid int64, conv *models.ChatConversation) []mlclient.HistoryItem {
	if conv == nil {
		return nil
	}
	msgs, err := h.Store.ListChatMessages(ctx, uid, conv.ID)
	if err != nil {
		log.Printf("chat history for the model (conversation=%d): %v", conv.ID, err)
		return nil
	}
	if len(msgs) > chatHistoryMessages {
		msgs = msgs[len(msgs)-chatHistoryMessages:]
	}
	out := make([]mlclient.HistoryItem, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, mlclient.HistoryItem{Role: m.Role, Text: m.Text})
	}
	return out
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

// readChatAsk checks a question request (shared by ChatAsk and
// ChatAskStream) and loads its conversation; on a problem it has already
// written the error and ok is false.
func (h *Handlers) readChatAsk(w http.ResponseWriter, r *http.Request) (uid int64, question string, conv *models.ChatConversation, ok bool) {
	uid, ok = h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return 0, "", nil, false
	}
	var req chatAskReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return 0, "", nil, false
	}
	question = strings.TrimSpace(req.Question)
	if question == "" {
		writeError(w, http.StatusBadRequest, "question must not be empty")
		return 0, "", nil, false
	}
	if utf8.RuneCountInString(question) > 2000 {
		writeError(w, http.StatusBadRequest, "question is too long")
		return 0, "", nil, false
	}
	if req.ConversationID != nil {
		c, err := h.Store.GetChatConversation(r.Context(), uid, *req.ConversationID)
		if err != nil {
			writeStoreErr(w, err, "could not load the conversation")
			return 0, "", nil, false
		}
		conv = &c
	}
	return uid, question, conv, true
}

// faqFor returns the FAQ entry a question is typed exactly like, if any.
func (h *Handlers) faqFor(r *http.Request, question string) (models.FAQ, string, bool) {
	faqs, err := h.Store.ListFAQs(r.Context())
	if err != nil {
		return models.FAQ{}, "", false
	}
	return matchFAQ(faqs, question)
}

// writeMLError answers a failed model call with the right status.
func writeMLError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, mlclient.ErrBadRequest):
		writeError(w, http.StatusBadRequest, "could not process your question")
	case errors.Is(err, mlclient.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "the assistant is temporarily unavailable")
	default:
		writeError(w, http.StatusBadGateway, "the assistant could not answer right now")
	}
}

func (h *Handlers) ChatAsk(w http.ResponseWriter, r *http.Request) {
	uid, question, conv, ok := h.readChatAsk(w, r)
	if !ok {
		return
	}

	// A question typed exactly like an FAQ question gets the FAQ answer at once.
	if f, lang, ok := h.faqFor(r, question); ok {
		h.answerFromFAQ(w, r, uid, conv, f, lang, question)
		return
	}

	if h.ML == nil {
		writeError(w, http.StatusServiceUnavailable, "the assistant is temporarily unavailable")
		return
	}

	started := time.Now()
	mlResp, err := h.ML.GenerateAnswer(r.Context(), question, h.chatBackground(r.Context(), uid, conv))
	elapsed := time.Since(started)
	if err != nil {
		log.Printf("chat ask ml error (user=%d, duration=%s): %v", uid, elapsed, err)
		writeMLError(w, err)
		return
	}
	log.Printf("chat ask ok (user=%d, request_id=%s, duration=%s, basis=%s, status=%s)",
		uid, mlResp.RequestID, elapsed, mlResp.Basis, mlResp.Status)

	assistant := assistantMessage(mlResp)
	// Save with a context that survives a closed browser tab: the model already spent
	// the time to answer, the answer should still land in the student's history.
	conv, messageID, err := h.saveChatTurn(context.WithoutCancel(r.Context()), uid, conv, question, assistant)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save the conversation")
		return
	}

	resp := buildChatAskResp(mlResp)
	resp.Conversation = conv
	resp.MessageID = messageID
	writeJSON(w, http.StatusOK, resp)
}

// saveChatTurn stores a question and its answer in conv, creating the
// conversation first when conv is nil (titled with the question). A new
// conversation is only created once there is an answer, so failed questions
// don't leave empty chats in the list.
// It returns the saved answer's id (0 if only that save failed).
func (h *Handlers) saveChatTurn(ctx context.Context, uid int64, conv *models.ChatConversation, question string, assistant models.ChatMessage) (*models.ChatConversation, int64, error) {
	if conv == nil {
		c, err := h.Store.CreateChatConversation(ctx, uid, chatTitleFromQuestion(question))
		if err != nil {
			log.Printf("chat create conversation (user=%d): %v", uid, err)
			return nil, 0, err
		}
		conv = &c
	}
	if _, err := h.Store.CreateChatMessage(ctx, uid, models.ChatMessage{
		ConversationID: conv.ID, Role: "user", Text: question,
	}); err != nil {
		log.Printf("chat history save user message: %v", err)
	}
	assistant.ConversationID = conv.ID
	saved, err := h.Store.CreateChatMessage(ctx, uid, assistant)
	if err != nil {
		log.Printf("chat history save assistant message: %v", err)
		return conv, 0, nil
	}
	conv.UpdatedAt = saved.CreatedAt
	return conv, saved.ID, nil
}

// --- Instant FAQ answers (Story 12) ---

// normalizeQuestion makes typed questions comparable with FAQ questions:
// lower case, single spaces, no closing punctuation.
func normalizeQuestion(q string) string {
	q = strings.ToLower(strings.Join(strings.Fields(q), " "))
	return strings.TrimRight(q, " ?!.…")
}

// matchFAQ finds an FAQ entry whose question (in any language) is exactly
// the typed one, and returns the language it matched in.
func matchFAQ(faqs []models.FAQ, question string) (models.FAQ, string, bool) {
	want := normalizeQuestion(question)
	if want == "" {
		return models.FAQ{}, "", false
	}
	for _, f := range faqs {
		for lang, q := range map[string]string{"en": f.Question, "kz": f.QuestionKZ, "ru": f.QuestionRU} {
			if q != "" && normalizeQuestion(q) == want {
				return f, lang, true
			}
		}
	}
	return models.FAQ{}, "", false
}

// answerFromFAQ saves and returns the FAQ answer as the assistant's reply,
// without asking the model: instant, and it works while the AI is down.
func (h *Handlers) answerFromFAQ(w http.ResponseWriter, r *http.Request, uid int64, conv *models.ChatConversation, f models.FAQ, lang, question string) {
	_, answer := f.Text(lang)
	basis := "faq"
	conv, messageID, err := h.saveChatTurn(context.WithoutCancel(r.Context()), uid, conv, question, models.ChatMessage{
		Role: "assistant", Text: answer, Basis: &basis, Language: &lang,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save the conversation")
		return
	}
	writeJSON(w, http.StatusOK, chatAskResp{
		RequestID:    fmt.Sprintf("faq-%d", f.ID),
		Status:       "answered",
		Answer:       answer,
		Language:     lang,
		Basis:        basis,
		Source:       &chatSourcePublic{Question: question, Category: f.Category},
		Conversation: conv,
		MessageID:    messageID,
	})
}

type chatFAQReq struct {
	FAQID          int64  `json:"faq_id"`
	ConversationID *int64 `json:"conversation_id,omitempty"`
	// Lang is the site language ("kz", "ru", "en"): the question and answer
	// are saved in it.
	Lang string `json:"lang"`
}

// ChatFAQ answers an FAQ button in the chat at once from the FAQ table.
func (h *Handlers) ChatFAQ(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req chatFAQReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	switch req.Lang {
	case "kz", "ru", "en":
	default:
		req.Lang = "en"
	}
	f, err := h.Store.GetFAQ(r.Context(), req.FAQID)
	if err != nil {
		writeStoreErr(w, err, "could not load the FAQ entry")
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
	question, _ := f.Text(req.Lang)
	h.answerFromFAQ(w, r, uid, conv, f, req.Lang, question)
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
		Followups:     mlResp.Followups,
	}
	if mlResp.SourceType != nil {
		out.SourceType = *mlResp.SourceType
	}
	if mlResp.Source != nil {
		out.Source = &chatSourcePublic{
			Question: mlResp.Source.Question,
			Category: mlResp.Source.Category,
		}
		if out.SourceType == "forum" {
			out.Source.ThreadID = mlResp.Source.ThreadID
			out.Source.Accepted = mlResp.Source.Accepted
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
