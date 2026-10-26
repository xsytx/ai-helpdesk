// Package store implements the forum's persistence layer, backed by
// PostgreSQL. It is written behind the Store interface so the HTTP
// handlers never touch SQL directly — see postgres.go for the
// implementation and migrations/001_init.sql for the schema.
package store

import (
	"context"
	"errors"
	"time"

	"campus-forum/internal/models"
)

var (
	ErrNotFound      = errors.New("not found")
	ErrConflict      = errors.New("conflict")
	ErrInvalidTarget = errors.New("invalid vote target")
	ErrForbidden     = errors.New("not the owner of this resource")
	ErrLocked        = errors.New("thread is locked")
	// ErrUsernameTaken is CreateUser/UpdateProfile's distinct conflict for
	// display_name (this forum's username), kept separate from the plain
	// ErrConflict used for a duplicate email so the handler can say which
	// field the caller needs to change.
	ErrUsernameTaken = errors.New("username already taken")
)

// ThreadInput bundles the fields a caller supplies when creating or
// editing a thread.
type ThreadInput struct {
	Title string
	Body  string
	Tags  []string
}

// Store is the persistence interface used by all HTTP handlers.
type Store interface {
	CreateUser(ctx context.Context, email, displayName, passwordHash, salt string) (models.User, error)
	GetUserByEmail(ctx context.Context, email string) (models.User, error)
	GetUserByID(ctx context.Context, id int64) (models.User, error)
	// ListThreadsByUser and ListCommentsByUser page through one user's
	// post history, newest first, for their profile page.
	ListThreadsByUser(ctx context.Context, userID int64, page, pageSize int) (threads []models.Thread, total int, err error)
	ListCommentsByUser(ctx context.Context, userID int64, page, pageSize int) (comments []models.CommentWithThread, total int, err error)

	// Stats returns platform-wide counts (users, threads, comments, tags)
	// for the home feed's stats panel.
	Stats(ctx context.Context) (models.Stats, error)

	// SearchThreads full-text-searches thread titles/bodies for q, ranked
	// by relevance (then newest first). Paged.
	SearchThreads(ctx context.Context, q string, page, pageSize int) (threads []models.Thread, total int, err error)
	CreateThread(ctx context.Context, userID int64, in ThreadInput) (models.Thread, error)
	GetThread(ctx context.Context, id int64) (models.Thread, error)
	// UpdateThread and DeleteThread only affect the row if userID owns it;
	// they return ErrForbidden if the thread exists but belongs to someone
	// else, and ErrNotFound if it doesn't exist at all.
	UpdateThread(ctx context.Context, id, userID int64, in ThreadInput) (models.Thread, error)
	DeleteThread(ctx context.Context, id, userID int64) error

	ListComments(ctx context.Context, threadID int64) ([]models.Comment, error)
	// CreateComment posts a top-level comment on threadID if parentCommentID
	// is nil, or a reply to that comment (which must belong to the same
	// thread) otherwise.
	CreateComment(ctx context.Context, threadID, userID int64, body string, parentCommentID *int64) (models.Comment, error)
	// UpdateComment and DeleteComment only affect the row if userID owns
	// it; same ErrForbidden/ErrNotFound distinction as thread edits.
	UpdateComment(ctx context.Context, id, userID int64, body string) (models.Comment, error)
	DeleteComment(ctx context.Context, id, userID int64) error

	Vote(ctx context.Context, userID int64, targetType string, targetID int64, value int) (int, error)

	// ListNotifications pages through userID's notifications, newest
	// first, and also reports how many of ALL their notifications (not
	// just this page) are unread — for a badge count.
	ListNotifications(ctx context.Context, userID int64, page, pageSize int) (notifications []models.Notification, total, unread int, err error)
	// UnreadNotificationCount is a cheap standalone count — the header
	// bell uses this instead of ListNotifications so loading every page
	// doesn't run the notifications JOIN query just to show a badge.
	UnreadNotificationCount(ctx context.Context, userID int64) (int, error)
	// MarkNotificationRead only affects the row if userID owns it (same
	// ErrForbidden/ErrNotFound distinction as thread/comment edits), and
	// is a no-op (not an error) if it's already read.
	MarkNotificationRead(ctx context.Context, id, userID int64) error
	MarkAllNotificationsRead(ctx context.Context, userID int64) error

	// --- Moderation ---

	// AdminDeleteThread and AdminDeleteComment delete regardless of who
	// owns the post — for moderators/admins only; enforce that at the
	// handler layer before calling these.
	AdminDeleteThread(ctx context.Context, id int64) error
	AdminDeleteComment(ctx context.Context, id int64) error
	// SetThreadLocked toggles whether new comments can be posted to a
	// thread; existing comments and votes are unaffected.
	SetThreadLocked(ctx context.Context, id int64, locked bool) error
	// SetUserBanned toggles whether a user can log in.
	SetUserBanned(ctx context.Context, id int64, banned bool) error

	CreateReport(ctx context.Context, reporterID int64, targetType string, targetID int64, reason string) (models.Report, error)
	// ListReports filters by status ("open"/"resolved"); an empty status
	// returns every report. Newest first.
	ListReports(ctx context.Context, status string, page, pageSize int) (reports []models.Report, total int, err error)
	ResolveReport(ctx context.Context, id int64) error

	// --- FAQ (public read, moderator/admin write — enforced at the
	// handler layer, same as the other moderation actions) ---

	// ListFAQs: in the admins' order (sort_order, then id).
	ListFAQs(ctx context.Context) ([]models.FAQ, error)
	// Saved questions.
	SetThreadSaved(ctx context.Context, userID, threadID int64, saved bool) error
	IsThreadSaved(ctx context.Context, userID, threadID int64) (bool, error)
	ListSavedThreads(ctx context.Context, userID int64, limit int) ([]models.Thread, error)
	// Mute ("mute") and ban ("ban") with an end (nil = none) and a reason.
	RestrictUser(ctx context.Context, id int64, kind string, until *time.Time, reason string) error
	LiftRestriction(ctx context.Context, id int64, kind string) error
	ListRestrictedUsers(ctx context.Context) ([]models.RestrictedUser, error)
	// PostRevisions: earlier versions of a question ("thread") or answer ("comment"), newest first.
	PostRevisions(ctx context.Context, kind string, id int64) ([]models.PostRevision, error)
	// SearchUsers: people to @mention whose name (a word of it) starts with q.
	SearchUsers(ctx context.Context, q string, limit int) ([]models.UserSuggestion, error)
	// Read-only chat links.
	ShareChatConversation(ctx context.Context, userID, id int64) (string, error)
	UnshareChatConversation(ctx context.Context, userID, id int64) error
	SharedChat(ctx context.Context, token string) (models.ChatConversation, []models.ChatMessage, error)
	// ForumAnswers: published questions with a trustworthy answer, for the AI chat.
	ForumAnswers(ctx context.Context, limit int) ([]models.ForumAnswer, error)
	GetFAQ(ctx context.Context, id int64) (models.FAQ, error)
	// CreateFAQ adds the entry at the end of the list. ErrConflict if the
	// English question already exists.
	CreateFAQ(ctx context.Context, in FAQInput) (models.FAQ, error)
	UpdateFAQ(ctx context.Context, id int64, in FAQInput) (models.FAQ, error)
	DeleteFAQ(ctx context.Context, id int64) error
	// ReorderFAQs puts the given entries first, in this order; others follow
	// in their previous order. ErrNotFound if an id doesn't exist.
	ReorderFAQs(ctx context.Context, ids []int64) error

	// --- Feed ---

	// ListFeed pages through every thread — the Threads-app-style home
	// feed. sort is "new" (default, newest first), "top" (highest score
	// first), or "comments" (most commented first).
	ListFeed(ctx context.Context, sort string, tags []string, page, pageSize int) (threads []models.Thread, total int, err error)

	// --- Profile ---

	UpdateProfile(ctx context.Context, userID int64, displayName, major, bio string) (models.User, error)

	// --- Tags ---

	// TrendingTags returns the most-used tags, most-used first.
	TrendingTags(ctx context.Context, limit int) ([]models.Tag, error)
	ListThreadsByTag(ctx context.Context, tagName string, page, pageSize int) (threads []models.Thread, total int, err error)

	// --- Thread subscriptions ---

	// SubscribeThread and UnsubscribeThread are idempotent. Creating a
	// thread or posting a comment on one auto-subscribes you to it (see
	// CreateThread/CreateComment); call UnsubscribeThread to opt back out.
	SubscribeThread(ctx context.Context, userID, threadID int64) error
	UnsubscribeThread(ctx context.Context, userID, threadID int64) error
	IsSubscribed(ctx context.Context, userID, threadID int64) (bool, error)
	// SubscriberEmails lists the email addresses of everyone subscribed
	// to threadID except excludeUserID (normally the comment's author) —
	// for sending the best-effort notification email.
	SubscriberEmails(ctx context.Context, threadID, excludeUserID int64) ([]string, error)

	// --- Attachments ---

	// CreateAttachment: a photo of a question (commentID nil) or of one of its answers.
	CreateAttachment(ctx context.Context, threadID int64, commentID *int64, path, contentType string, sizeBytes int64) (models.Attachment, error)
	// AnswerAttachments: photos of a thread's answers, by answer id.
	AnswerAttachments(ctx context.Context, threadID int64) (map[int64][]models.Attachment, error)
	CountAnswerAttachments(ctx context.Context, commentID int64) (int, error)
	GetComment(ctx context.Context, id int64) (models.Comment, error)
	// SetAvatar changes a user's avatar and returns the previous one.
	SetAvatar(ctx context.Context, userID int64, avatar string) (string, error)
	ListAttachments(ctx context.Context, threadID int64) ([]models.Attachment, error)

	// --- Email verification ---

	// CreateEmailVerification issues userID a fresh verification code,
	// replacing any still-pending one (at most one active code per user
	// at a time — see the upsert in the implementation).
	CreateEmailVerification(ctx context.Context, userID int64, token string, expiresAt time.Time) error
	// VerifyEmailCode consumes userID's pending code if it matches and
	// hasn't expired, marking their email verified. Returns ErrNotFound
	// for a wrong or expired code (deliberately indistinguishable, so a
	// guesser can't tell which failure mode they hit).
	VerifyEmailCode(ctx context.Context, userID int64, code string) error

	// --- Password reset ---

	// CreatePasswordReset issues userID a fresh reset code, replacing any
	// still-pending one (and resetting its wrong-attempt count).
	CreatePasswordReset(ctx context.Context, userID int64, code string, expiresAt time.Time) error
	// CheckPasswordResetCode reports whether code is the valid pending reset
	// code for email, without consuming it. A wrong guess counts toward the
	// code's attempt limit. Returns ErrNotFound for a wrong, expired, or
	// exhausted code (indistinguishable on purpose).
	CheckPasswordResetCode(ctx context.Context, email, code string) error
	// ResetPassword consumes email's reset code if it's valid (same rules as
	// CheckPasswordResetCode) and sets that user's password.
	ResetPassword(ctx context.Context, email, code, newPasswordHash, newSalt string) error
	// ChangePassword sets userID's password directly, for an authenticated
	// user changing their own password (the handler checks the current
	// password first) — unlike ResetPassword, no reset code is involved.
	ChangePassword(ctx context.Context, userID int64, newPasswordHash, newSalt string) error

	// SetStaffRole gives a user the "moderator" or "admin" role. It never
	// lowers an admin.
	SetStaffRole(ctx context.Context, userID int64, role string) error

	// --- AI chat conversations ---
	// All of these are scoped to userID: another user's conversation is
	// ErrNotFound, never ErrForbidden, so ids can't be probed.

	CreateChatConversation(ctx context.Context, userID int64, title string) (models.ChatConversation, error)
	GetChatConversation(ctx context.Context, userID, id int64) (models.ChatConversation, error)
	// ListChatConversations: pinned first, then most recently active.
	ListChatConversations(ctx context.Context, userID int64) ([]models.ChatConversation, error)
	// UpdateChatConversation changes the title and/or pin; nil leaves it as is.
	UpdateChatConversation(ctx context.Context, userID, id int64, title *string, pinned *bool) (models.ChatConversation, error)
	DeleteChatConversation(ctx context.Context, userID, id int64) error
	// DeleteStaleChatConversations removes unpinned conversations with no
	// message since olderThan (all users) and returns how many.
	DeleteStaleChatConversations(ctx context.Context, olderThan time.Time) (int64, error)

	// CreateChatMessage adds msg to msg.ConversationID (ErrNotFound if that
	// is not the user's conversation).
	CreateChatMessage(ctx context.Context, userID int64, msg models.ChatMessage) (models.ChatMessage, error)
	ListChatMessages(ctx context.Context, userID, conversationID int64) ([]models.ChatMessage, error)
	// RateChatMessage: 1 = 👍, -1 = 👎, 0 = clear, on one of the user's answers.
	RateChatMessage(ctx context.Context, userID, messageID int64, value int) error
	// SimilarThreads: visible questions about the same topic as title
	// ("maybe this was already asked"), see forum_extras.go.
	SimilarThreads(ctx context.Context, title string) ([]models.Thread, error)
	// SetAcceptedAnswer marks (or clears, nil) the solution of a thread; author only.
	SetAcceptedAnswer(ctx context.Context, threadID, userID int64, commentID *int64) error
	// Reputation: all-time points and level of some users (see reputation.go).
	Reputation(ctx context.Context, userIDs []int64) (map[int64]models.Reputation, error)
	// TopHelpers: users by points earned since a time, best first.
	TopHelpers(ctx context.Context, since time.Time, limit int) ([]models.Helper, error)
	// GetAttachment: one photo (ErrNotFound if it doesn't exist).
	GetAttachment(ctx context.Context, id int64) (models.Attachment, error)
	// DeleteAttachment removes a photo's row and returns it (for the file path
	// and its thread); ErrNotFound if it doesn't exist.
	DeleteAttachment(ctx context.Context, id int64) (models.Attachment, string, error)
	// ResolveReportsFor closes all open reports about one post.
	ResolveReportsFor(ctx context.Context, targetType string, targetID int64) error
	// ChatInsights: "disliked", "unanswered" or "frequent" (see chat_feedback.go).
	ChatInsights(ctx context.Context, kind string, since time.Time, limit int) ([]models.ChatInsight, error)
}
