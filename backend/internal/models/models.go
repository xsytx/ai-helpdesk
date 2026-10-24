// Package models holds the core domain types for SDU Helpdesk.
package models

import "time"

type User struct {
	ID              int64      `json:"id"`
	Email           string     `json:"email"`
	PasswordHash    string     `json:"-"`
	Salt            string     `json:"-"`
	DisplayName     string     `json:"display_name"`
	Role            string     `json:"role"` // "user", "moderator", or "admin"
	BannedAt        *time.Time `json:"banned_at,omitempty"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`
	Major           string     `json:"major"`
	Bio             string     `json:"bio"`
	// Avatar: "" (initials), a preset id ("avatar3") or an uploaded photo's URL.
	Avatar    string    `json:"avatar"`
	CreatedAt time.Time `json:"created_at"`
}

// IsModerator reports whether the user can take moderation actions
// (deleting others' posts, locking threads, banning users, resolving
// reports). Admins implicitly have every moderator privilege.
func (u User) IsModerator() bool {
	return u.Role == "moderator" || u.Role == "admin"
}

// Stats is a snapshot of platform-wide counts, for the home feed's
// "Community stats" panel.
type Stats struct {
	Users    int `json:"users"`
	Threads  int `json:"threads"`
	Comments int `json:"comments"`
	Tags     int `json:"tags"`
}

type Thread struct {
	ID          int64        `json:"id"`
	UserID      int64        `json:"user_id"`
	AuthorName  string       `json:"author_name"`
	// AuthorAvatar: see User.Avatar.
	AuthorAvatar string      `json:"author_avatar,omitempty"`
	// PhotoCount and PreviewPhotos (the first 3 URLs) let lists show a
	// question's photos without loading them all.
	PhotoCount    int      `json:"photo_count,omitempty"`
	PreviewPhotos []string `json:"preview_photos,omitempty"`
	Title       string       `json:"title"`
	Body        string       `json:"body"`
	BodyHTML    string       `json:"body_html,omitempty"` // rendered Markdown; populated on the thread-detail response only
	Score       int          `json:"score"`
	CommentCnt  int          `json:"comment_count"`
	LockedAt    *time.Time   `json:"locked_at,omitempty"`
	Tags        []string     `json:"tags,omitempty"`
	Attachments []Attachment `json:"attachments,omitempty"`
	CreatedAt   time.Time    `json:"created_at"`
	// ModerationStatus: ok | checking | held | rejected (see 002_moderation.sql).
	ModerationStatus string `json:"moderation_status"`
	// AcceptedCommentID is the answer the author marked as the solution
	// ("Solved"); nil if none, or if that answer is hidden by moderation.
	AcceptedCommentID *int64 `json:"accepted_comment_id,omitempty"`
	// SearchMatch is set on search results only: where the words were found
	// ("title", "body", "answer", "tag") or "similar" (a near match, e.g. a typo).
	SearchMatch string `json:"search_match,omitempty"`
}

type Comment struct {
	ID              int64     `json:"id"`
	ThreadID        int64     `json:"thread_id"`
	UserID          int64     `json:"user_id"`
	AuthorName      string    `json:"author_name"`
	AuthorAvatar    string    `json:"author_avatar,omitempty"`
	ParentCommentID *int64    `json:"parent_comment_id,omitempty"`
	Body            string    `json:"body"`
	BodyHTML        string    `json:"body_html,omitempty"` // rendered Markdown; populated on the thread-detail response only
	Score           int       `json:"score"`
	CreatedAt       time.Time `json:"created_at"`
	// ModerationStatus: ok | checking | held | rejected (see 002_moderation.sql).
	ModerationStatus string `json:"moderation_status"`
	// Attachments: the answer's photos (thread page only).
	Attachments []Attachment `json:"attachments,omitempty"`
}

// Attachment is an uploaded image on a thread, served from local disk at
// URL (see UPLOAD_DIR in cmd/server).
type Attachment struct {
	ID          int64     `json:"id"`
	ThreadID    int64     `json:"thread_id"`
	// CommentID: set for a photo in an answer, nil for one in the question.
	CommentID   *int64    `json:"comment_id,omitempty"`
	URL         string    `json:"url"`
	ContentType string    `json:"content_type"`
	SizeBytes   int64     `json:"size_bytes"`
	CreatedAt   time.Time `json:"created_at"`
}

// Reputation is how much a student has helped others (see store/reputation.go).
type Reputation struct {
	UserID    int64 `json:"user_id"`
	Points    int   `json:"points"`
	Answers   int   `json:"answers"`
	Likes     int   `json:"likes"`
	Solutions int   `json:"solutions"`
	// Level: newcomer, helper, expert or master (by all-time points).
	Level string `json:"level"`
	// NextLevelAt is the points the next level starts at; 0 at the top.
	NextLevelAt int `json:"next_level_at"`
}

// Helper is one line of the "top helpers" list: points earned in the period.
type Helper struct {
	UserID    int64  `json:"user_id"`
	Name      string `json:"name"`
	Points    int    `json:"points"`
	Answers   int    `json:"answers"`
	Likes     int    `json:"likes"`
	Solutions int    `json:"solutions"`
	Level     string `json:"level"`
	Avatar    string `json:"avatar,omitempty"`
}

// Tag is a free-form label a thread can carry — the only organizing
// structure threads have. Count (when populated) is how many threads
// currently carry it, for the trending-tags widget.
type Tag struct {
	Name  string `json:"name"`
	Count int    `json:"count,omitempty"`
}

// CommentWithThread is a Comment plus enough about its parent thread to
// render a link back to it — used for a user's comment history on their
// profile page, where comments span many threads.
type CommentWithThread struct {
	Comment
	ThreadTitle string `json:"thread_title"`
	// IsSolution: the question's author marked this answer as the solution.
	IsSolution bool `json:"is_solution"`
}

// Notification tells a user that someone commented on their thread
// (Type "comment_on_thread") or replied to their comment specifically
// (Type "reply_to_comment"). CommentID is nil if that comment has since
// been deleted, but the notification itself (and the thread it points
// to) survives.
type Notification struct {
	ID          int64     `json:"id"`
	Type        string    `json:"type"`
	ThreadID    int64     `json:"thread_id"`
	ThreadTitle string    `json:"thread_title"`
	CommentID   *int64    `json:"comment_id,omitempty"`
	ActorID     int64     `json:"actor_id"`
	ActorName   string    `json:"actor_name"`
	Read        bool      `json:"read"`
	CreatedAt   time.Time `json:"created_at"`
}

// Report is a user flagging a thread or comment for moderator attention.
// Preview and ThreadID are resolved server-side for display: Preview is
// the thread's title or the comment's body (truncated), or "[deleted]"
// if the target was removed since the report was filed; ThreadID is the
// target itself (for a thread report) or its parent thread (for a
// comment report), so the moderator can jump to context either way.
type Report struct {
	ID           int64      `json:"id"`
	ReporterID   int64      `json:"reporter_id"`
	ReporterName string     `json:"reporter_name"`
	TargetType   string     `json:"target_type"`
	TargetID     int64      `json:"target_id"`
	Reason       string     `json:"reason"`
	Status       string     `json:"status"`
	Preview      string     `json:"preview"`
	ThreadID     int64      `json:"thread_id"`
	CreatedAt    time.Time  `json:"created_at"`
	ResolvedAt   *time.Time `json:"resolved_at,omitempty"`
}

// FAQ is one question/answer entry, managed by moderators/admins and
// shown on the public FAQ page in SortOrder (then ID) order. Question and
// Answer are the English text; the _kz/_ru fields hold the translations.
type FAQ struct {
	ID         int64     `json:"id"`
	Question   string    `json:"question"`
	QuestionKZ string    `json:"question_kz"`
	QuestionRU string    `json:"question_ru"`
	Answer     string    `json:"answer"`
	AnswerKZ   string    `json:"answer_kz"`
	AnswerRU   string    `json:"answer_ru"`
	Category   string    `json:"category"` // general, account, study, campus, forum
	Pinned     bool      `json:"pinned"`   // shown as an instant-answer button in the chat
	SortOrder  int       `json:"sort_order"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// Text returns the question and answer in lang ("kz", "ru", anything else =
// English), falling back to English where a translation is missing.
func (f FAQ) Text(lang string) (question, answer string) {
	question, answer = f.Question, f.Answer
	switch lang {
	case "kz", "kk":
		if f.QuestionKZ != "" && f.AnswerKZ != "" {
			question, answer = f.QuestionKZ, f.AnswerKZ
		}
	case "ru":
		if f.QuestionRU != "" && f.AnswerRU != "" {
			question, answer = f.QuestionRU, f.AnswerRU
		}
	}
	return question, answer
}

type Vote struct {
	UserID     int64  `json:"user_id"`
	TargetType string `json:"target_type"` // "thread" or "comment"
	TargetID   int64  `json:"target_id"`
	Value      int    `json:"value"` // 1 or -1
}

// ChatConversation is one of a user's separate chats with the AI assistant.
type ChatConversation struct {
	ID        int64     `json:"id"`
	Title     string    `json:"title"`
	Pinned    bool      `json:"pinned"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"` // time of the last message
	// ShareToken is the read-only link (/shared/<token>); nil = not shared.
	ShareToken *string `json:"share_token,omitempty"`
}

// ChatMessage is one message in a chat conversation.
type ChatMessage struct {
	ID             int64     `json:"id"`
	ConversationID int64     `json:"conversation_id"`
	UserID         int64     `json:"user_id"`
	Role           string    `json:"role"` // "user" or "assistant"
	Text           string    `json:"text"`
	ForumAnswer    *string   `json:"forum_answer,omitempty"`
	AIExplanation  *string   `json:"ai_explanation,omitempty"`
	Basis          *string   `json:"basis,omitempty"`
	Language       *string   `json:"language,omitempty"`
	// SourceType is where forum_answer came from: "faq" (knowledge base) or
	// "forum" (a forum answer; SourceThreadID is its question, nil once deleted).
	SourceType     *string `json:"source_type,omitempty"`
	SourceThreadID *int64  `json:"source_thread_id,omitempty"`
	// How far the community answer can be trusted (when the bot used it).
	SourceAccepted bool `json:"source_accepted,omitempty"`
	SourceLikes    int  `json:"source_likes,omitempty"`
	SourceStaff    bool `json:"source_staff,omitempty"`
	// Followups: questions the student may ask next (buttons under an AI answer).
	Followups []string `json:"followups,omitempty"`
	// Rating is the student's 👍 (1) / 👎 (-1) on an answer; nil = not rated.
	Rating    *int16    `json:"rating,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// UserSuggestion is a person offered after "@" in a post.
type UserSuggestion struct {
	ID          int64  `json:"id"`
	DisplayName string `json:"display_name"`
	Avatar      string `json:"avatar"`
}

// ForumAnswer is a published question with its best answer, offered to the
// AI chat as a possible "community answer" (store.ForumAnswers).
type ForumAnswer struct {
	ThreadID int64
	Title    string
	Body     string
	Answer   string
	Accepted bool
	Likes    int
	Staff    bool
}

// ChatInsight is one line in the admin panel's "AI chat" lists: a question
// (and the AI's answer, if any) without who asked it.
type ChatInsight struct {
	MessageID int64     `json:"message_id,omitempty"` // the answer; 0 for "frequent"
	Question  string    `json:"question"`
	Context   string    `json:"context,omitempty"` // the student's question before it, if any
	Answer    string    `json:"answer,omitempty"`
	Language  *string   `json:"language,omitempty"`
	Students  int       `json:"students"` // how many students asked it ("frequent")
	At        time.Time `json:"at"`       // latest time asked / rated
}
