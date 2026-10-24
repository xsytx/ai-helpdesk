package store

import (
	_ "embed"
	"slices"
)

//go:embed migrations/010_tags.sql
var tagsSQL string

// ForumTags are the tags a question can have, chosen from this list (the
// website shows them translated: features/forum/tags.ts). Keep it in sync
// with 010_tags.sql.
var ForumTags = []string{
	"dorm", "campus", "study", "exams", "schedule", "registration", "scholarship",
	"documents", "food", "student-life", "clubs", "it", "other",
}

// MaxTagsPerThread: how many tags one question may have.
const MaxTagsPerThread = 5

// IsForumTag reports whether name is one of ForumTags.
func IsForumTag(name string) bool { return slices.Contains(ForumTags, name) }
