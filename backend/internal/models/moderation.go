package models

import "time"

// ModerationItem is a forum post (new thread or new comment) that the AI
// moderation held back. Decision is the AI verdict ("block" or "review");
// Status is the human outcome ("pending", "approved", "rejected").
type ModerationItem struct {
	ID                 int64      `json:"id"`
	Kind               string     `json:"kind"` // "thread" or "comment"
	UserID             int64      `json:"user_id"`
	AuthorName         string     `json:"author_name"`
	Title              string     `json:"title"`
	Body               string     `json:"body"`
	Tags               []string   `json:"tags"`
	ThreadID           *int64     `json:"thread_id,omitempty"`
	ThreadTitle        string     `json:"thread_title,omitempty"`
	ParentCommentID    *int64     `json:"parent_comment_id,omitempty"`
	Decision           string     `json:"decision"`
	Categories         []string   `json:"categories"`
	Reason             string     `json:"reason"`
	PolicyVersion      string     `json:"policy_version"`
	Status             string     `json:"status"`
	ReviewedBy         *int64     `json:"reviewed_by,omitempty"`
	ReviewerName       string     `json:"reviewer_name,omitempty"`
	ReviewedAt         *time.Time `json:"reviewed_at,omitempty"`
	AdminNote          string     `json:"admin_note"`
	PublishedThreadID  *int64     `json:"published_thread_id,omitempty"`
	PublishedCommentID *int64     `json:"published_comment_id,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
}
