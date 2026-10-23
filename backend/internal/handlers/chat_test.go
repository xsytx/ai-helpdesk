package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"campus-forum/internal/auth"
	"campus-forum/internal/middleware"
	"campus-forum/internal/mlclient"
	"campus-forum/internal/models"
	"campus-forum/internal/store"
)

type chatTestStore struct {
	created []models.ChatMessage
	nextID  int64
}

func (s *chatTestStore) CreateChatMessage(_ context.Context, userID int64, msg models.ChatMessage) (models.ChatMessage, error) {
	s.nextID++
	out := msg
	out.ID = s.nextID
	out.UserID = userID
	out.CreatedAt = time.Now()
	s.created = append(s.created, out)
	return out, nil
}

func (s *chatTestStore) ListChatMessages(context.Context, int64, int64) ([]models.ChatMessage, error) {
	return nil, nil
}
func (s *chatTestStore) CreateChatConversation(_ context.Context, _ int64, title string) (models.ChatConversation, error) {
	s.nextID++
	return models.ChatConversation{ID: s.nextID, Title: title, CreatedAt: time.Now(), UpdatedAt: time.Now()}, nil
}
func (s *chatTestStore) GetChatConversation(context.Context, int64, int64) (models.ChatConversation, error) {
	return models.ChatConversation{}, store.ErrNotFound
}
func (s *chatTestStore) ListChatConversations(context.Context, int64) ([]models.ChatConversation, error) {
	return nil, nil
}
func (s *chatTestStore) UpdateChatConversation(context.Context, int64, int64, *string, *bool) (models.ChatConversation, error) {
	return models.ChatConversation{}, store.ErrNotFound
}
func (s *chatTestStore) DeleteChatConversation(context.Context, int64, int64) error { return nil }
func (s *chatTestStore) RateChatMessage(context.Context, int64, int64, int) error  { return nil }
func (s *chatTestStore) SimilarThreads(context.Context, string) ([]models.Thread, error) {
	return nil, nil
}
func (s *chatTestStore) SetAcceptedAnswer(context.Context, int64, int64, *int64) error { return nil }
func (s *chatTestStore) ResolveReportsFor(context.Context, string, int64) error       { return nil }
func (s *chatTestStore) ChatInsights(context.Context, string, time.Time, int) ([]models.ChatInsight, error) {
	return nil, nil
}
func (s *chatTestStore) DeleteStaleChatConversations(context.Context, time.Time) (int64, error) {
	return 0, nil
}

func (s *chatTestStore) CreateUser(context.Context, string, string, string, string) (models.User, error) {
	return models.User{}, store.ErrNotFound
}
func (s *chatTestStore) GetUserByEmail(context.Context, string) (models.User, error) {
	return models.User{}, store.ErrNotFound
}
func (s *chatTestStore) GetUserByID(context.Context, int64) (models.User, error) {
	return models.User{}, store.ErrNotFound
}
func (s *chatTestStore) ListThreadsByUser(context.Context, int64, int, int) ([]models.Thread, int, error) {
	return nil, 0, nil
}
func (s *chatTestStore) ListCommentsByUser(context.Context, int64, int, int) ([]models.CommentWithThread, int, error) {
	return nil, 0, nil
}
func (s *chatTestStore) Stats(context.Context) (models.Stats, error) { return models.Stats{}, nil }
func (s *chatTestStore) SearchThreads(context.Context, string, int, int) ([]models.Thread, int, error) {
	return nil, 0, nil
}
func (s *chatTestStore) CreateThread(context.Context, int64, store.ThreadInput) (models.Thread, error) {
	return models.Thread{}, nil
}
func (s *chatTestStore) GetThread(context.Context, int64) (models.Thread, error) {
	return models.Thread{}, store.ErrNotFound
}
func (s *chatTestStore) UpdateThread(context.Context, int64, int64, store.ThreadInput) (models.Thread, error) {
	return models.Thread{}, store.ErrNotFound
}
func (s *chatTestStore) DeleteThread(context.Context, int64, int64) error { return nil }
func (s *chatTestStore) ListComments(context.Context, int64) ([]models.Comment, error) {
	return nil, nil
}
func (s *chatTestStore) CreateComment(context.Context, int64, int64, string, *int64) (models.Comment, error) {
	return models.Comment{}, nil
}
func (s *chatTestStore) UpdateComment(context.Context, int64, int64, string) (models.Comment, error) {
	return models.Comment{}, store.ErrNotFound
}
func (s *chatTestStore) DeleteComment(context.Context, int64, int64) error { return nil }
func (s *chatTestStore) Vote(context.Context, int64, string, int64, int) (int, error) {
	return 0, nil
}
func (s *chatTestStore) ListNotifications(context.Context, int64, int, int) ([]models.Notification, int, int, error) {
	return nil, 0, 0, nil
}
func (s *chatTestStore) UnreadNotificationCount(context.Context, int64) (int, error) { return 0, nil }
func (s *chatTestStore) MarkNotificationRead(context.Context, int64, int64) error    { return nil }
func (s *chatTestStore) MarkAllNotificationsRead(context.Context, int64) error       { return nil }
func (s *chatTestStore) AdminDeleteThread(context.Context, int64) error              { return nil }
func (s *chatTestStore) AdminDeleteComment(context.Context, int64) error             { return nil }
func (s *chatTestStore) SetThreadLocked(context.Context, int64, bool) error          { return nil }
func (s *chatTestStore) SetUserBanned(context.Context, int64, bool) error            { return nil }
func (s *chatTestStore) CreateReport(context.Context, int64, string, int64, string) (models.Report, error) {
	return models.Report{}, nil
}
func (s *chatTestStore) ListReports(context.Context, string, int, int) ([]models.Report, int, error) {
	return nil, 0, nil
}
func (s *chatTestStore) ResolveReport(context.Context, int64) error { return nil }
func (s *chatTestStore) ListFAQs(context.Context) ([]models.FAQ, error) {
	return nil, nil
}
func (s *chatTestStore) GetFAQ(context.Context, int64) (models.FAQ, error) {
	return models.FAQ{}, store.ErrNotFound
}
func (s *chatTestStore) CreateFAQ(context.Context, store.FAQInput) (models.FAQ, error) {
	return models.FAQ{}, nil
}
func (s *chatTestStore) UpdateFAQ(context.Context, int64, store.FAQInput) (models.FAQ, error) {
	return models.FAQ{}, store.ErrNotFound
}
func (s *chatTestStore) ReorderFAQs(context.Context, []int64) error { return nil }
func (s *chatTestStore) DeleteFAQ(context.Context, int64) error { return nil }
func (s *chatTestStore) ListFeed(context.Context, string, int, int) ([]models.Thread, int, error) {
	return nil, 0, nil
}
func (s *chatTestStore) UpdateProfile(context.Context, int64, string, string, string) (models.User, error) {
	return models.User{}, store.ErrNotFound
}
func (s *chatTestStore) TrendingTags(context.Context, int) ([]models.Tag, error) { return nil, nil }
func (s *chatTestStore) ListThreadsByTag(context.Context, string, int, int) ([]models.Thread, int, error) {
	return nil, 0, nil
}
func (s *chatTestStore) SubscribeThread(context.Context, int64, int64) error   { return nil }
func (s *chatTestStore) UnsubscribeThread(context.Context, int64, int64) error { return nil }
func (s *chatTestStore) IsSubscribed(context.Context, int64, int64) (bool, error) {
	return false, nil
}
func (s *chatTestStore) SubscriberEmails(context.Context, int64, int64) ([]string, error) {
	return nil, nil
}
func (s *chatTestStore) CreateAttachment(context.Context, int64, string, string, int64) (models.Attachment, error) {
	return models.Attachment{}, nil
}
func (s *chatTestStore) ListAttachments(context.Context, int64) ([]models.Attachment, error) {
	return nil, nil
}
func (s *chatTestStore) CreateEmailVerification(context.Context, int64, string, time.Time) error {
	return nil
}
func (s *chatTestStore) VerifyEmailCode(context.Context, int64, string) error { return nil }
func (s *chatTestStore) CreatePasswordReset(context.Context, int64, string, time.Time) error {
	return nil
}
func (s *chatTestStore) CheckPasswordResetCode(context.Context, string, string) error { return nil }
func (s *chatTestStore) ResetPassword(context.Context, string, string, string, string) error {
	return nil
}
func (s *chatTestStore) ChangePassword(context.Context, int64, string, string) error { return nil }
func (s *chatTestStore) SetStaffRole(context.Context, int64, string) error            { return nil }

func TestBuildChatAskResp(t *testing.T) {
	faq := "official"
	resp := buildChatAskResp(mlclient.GenerateResult{
		RequestID: "id1", Status: "answered", Answer: "combined",
		ForumAnswer: &faq, AIExplanation: "because", Language: "en", Basis: "retrieved",
		Source: &mlclient.Source{Question: "Q?", Category: "Cat"},
	})
	if resp.Source == nil || resp.Source.Category != "Cat" {
		t.Fatalf("%+v", resp)
	}
}

func TestChatAskEndpoint(t *testing.T) {
	mlSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"request_id": "rid", "status": "answered", "answer": "A",
			"forum_answer": nil, "ai_explanation": "E", "language": "en",
			"basis": "general", "reason": nil, "source": nil,
			"source_type": nil, "retrieval_score": nil,
		})
	}))
	defer mlSrv.Close()

	st := &chatTestStore{}
	secret := []byte("01234567890123456789012345678901")
	h := &Handlers{Store: st, ML: mlclient.New(mlSrv.URL, 5*time.Second)}
	tok, err := auth.IssueToken(secret, 42, "u@sdu.edu.kz", time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	authMw := middleware.Auth(secret)
	mux.Handle("POST /api/chat/ask", authMw(http.HandlerFunc(h.ChatAsk)))

	body := strings.NewReader(`{"question":"What is GPA?"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/chat/ask", body)
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	var out chatAskResp
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Answer != "A" || out.RequestID != "rid" {
		t.Fatalf("%+v", out)
	}
	if len(st.created) != 2 || st.created[0].Role != "user" || st.created[1].Role != "assistant" {
		t.Fatalf("history %+v", st.created)
	}
	if out.Conversation == nil || out.Conversation.Title != "What is GPA?" ||
		st.created[0].ConversationID != out.Conversation.ID || st.created[1].ConversationID != out.Conversation.ID {
		t.Fatalf("conversation %+v, history %+v", out.Conversation, st.created)
	}
}

func TestChatTitleFromQuestion(t *testing.T) {
	if got := chatTitleFromQuestion("  How do I\n\tget   a dorm?  "); got != "How do I get a dorm?" {
		t.Fatalf("got %q", got)
	}
	long := strings.Repeat("слово ", 30)
	got := chatTitleFromQuestion(long)
	if n := len([]rune(got)); n > chatTitleRunes || !strings.HasSuffix(got, "…") {
		t.Fatalf("got %q (%d runes)", got, n)
	}
}

func TestChatAskEmptyQuestion(t *testing.T) {
	secret := []byte("01234567890123456789012345678901")
	h := &Handlers{Store: &chatTestStore{}, ML: mlclient.New("http://127.0.0.1:1", time.Second)}
	tok, _ := auth.IssueToken(secret, 1, "u@sdu.edu.kz", time.Hour)
	mux := http.NewServeMux()
	mux.Handle("POST /api/chat/ask", middleware.Auth(secret)(http.HandlerFunc(h.ChatAsk)))
	req := httptest.NewRequest(http.MethodPost, "/api/chat/ask", strings.NewReader(`{"question":"   "}`))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status %d", rr.Code)
	}
}
