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
	CreatedAt       time.Time  `json:"created_at"`
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
	Title       string       `json:"title"`
	Body        string       `json:"body"`
	BodyHTML    string       `json:"body_html,omitempty"` // rendered Markdown; populated on the thread-detail response only
	Score       int          `json:"score"`
	CommentCnt  int          `json:"comment_count"`
	LockedAt    *time.Time   `json:"locked_at,omitempty"`
	Tags        []string     `json:"tags,omitempty"`
	Attachments []Attachment `json:"attachments,omitempty"`
	CreatedAt   time.Time    `json:"created_at"`
}

type Comment struct {
	ID              int64     `json:"id"`
	ThreadID        int64     `json:"thread_id"`
	UserID          int64     `json:"user_id"`
	AuthorName      string    `json:"author_name"`
	ParentCommentID *int64    `json:"parent_comment_id,omitempty"`
	Body            string    `json:"body"`
	BodyHTML        string    `json:"body_html,omitempty"` // rendered Markdown; populated on the thread-detail response only
	Score           int       `json:"score"`
	CreatedAt       time.Time `json:"created_at"`
}

// Attachment is an uploaded image on a thread, served from local disk at
// URL (see UPLOAD_DIR in cmd/server).
type Attachment struct {
	ID          int64     `json:"id"`
	ThreadID    int64     `json:"thread_id"`
	URL         string    `json:"url"`
	ContentType string    `json:"content_type"`
	SizeBytes   int64     `json:"size_bytes"`
	CreatedAt   time.Time `json:"created_at"`
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
// shown on the public FAQ page in SortOrder (then ID) order.
type FAQ struct {
	ID        int64     `json:"id"`
	Question  string    `json:"question"`
	Answer    string    `json:"answer"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Vote struct {
	UserID     int64  `json:"user_id"`
	TargetType string `json:"target_type"` // "thread" or "comment"
	TargetID   int64  `json:"target_id"`
	Value      int    `json:"value"` // 1 or -1
}
