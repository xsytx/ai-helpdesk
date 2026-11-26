package models

import "time"

// Dashboard is the admin overview (story 19): counts for a period, the chat
// per day, and the lists an admin acts on. No student names anywhere.
type Dashboard struct {
	Days   int             `json:"days"`
	Totals DashboardTotals `json:"totals"`
	// Previous: the same counts for the days just before (as many as Days), to compare.
	Previous DashboardTotals `json:"previous"`
	Daily    []DashboardDay  `json:"daily"`
	// AICallsToday: what the AI was asked for today; AIQuota: the day's free
	// quota to compare with (AI_DAILY_QUOTA; 0 = not set, no bar).
	AICallsToday map[string]int `json:"ai_calls_today"`
	AIQuota      int            `json:"ai_quota"`
	// TopQuestions: the most asked chat questions (same wording, ignoring case,
	// spaces and the final "?"), FAQ-answered ones left out: they are covered.
	TopQuestions []TopQuestion `json:"top_questions"`
	// Unanswered: the latest questions the AI had no answer for.
	Unanswered []ChatInsight `json:"unanswered"`
	// Disliked: the latest answers students marked 👎 (the answers to fix first).
	Disliked []ChatInsight `json:"disliked"`
	// TopCourses: the courses students asked the chat about most.
	TopCourses []CourseAsked `json:"top_courses"`
	// OpenThreads: the newest forum questions with no answer yet.
	OpenThreads []OpenThread `json:"open_threads"`
}

// DashboardTotals are counts for the period (Total… = all time).
type DashboardTotals struct {
	ChatQuestions   int `json:"chat_questions"`   // questions asked in the AI chat
	AIAnswers       int `json:"ai_answers"`       // answered by the AI (the daily-limit counter)
	AIAnswersToday  int `json:"ai_answers_today"` // the same, today (Almaty date)
	FAQAnswers      int `json:"faq_answers"`      // answered from the FAQ, without the AI
	Unanswered      int `json:"unanswered"`       // the AI had no answer
	Liked           int `json:"liked"`            // answers rated 👍
	Disliked        int `json:"disliked"`         // answers rated 👎
	ActiveStudents  int `json:"active_students"`  // students who asked the chat anything
	NewStudents     int `json:"new_students"`     // accounts made in the period
	TotalStudents   int `json:"total_students"`
	ForumQuestions  int `json:"forum_questions"`  // new forum questions (visible)
	ForumAnswers    int `json:"forum_answers"`    // new forum answers and replies (visible)
	ForumOpenTotal  int `json:"forum_open_total"` // visible questions with no visible answer, all time
	Reviews         int `json:"reviews"`          // new course reviews (visible)
}

// DashboardDay is one day of the chat (Almaty date).
type DashboardDay struct {
	Day        string `json:"day"` // 2026-11-26
	Answered   int    `json:"answered"`
	FAQ        int    `json:"faq"`
	Unanswered int    `json:"unanswered"`
}

// TopQuestion is one question as students typed it (the latest wording).
type TopQuestion struct {
	Question string    `json:"question"`
	Students int       `json:"students"` // different students who asked it
	Asks     int       `json:"asks"`     // times asked in all
	LastAt   time.Time `json:"last_at"`
}

// CourseAsked is a course the chat answered questions about.
type CourseAsked struct {
	Code      string `json:"code"`
	Name      string `json:"name"`
	Questions int    `json:"questions"`
}

// OpenThread is a forum question still waiting for an answer.
type OpenThread struct {
	ID        int64     `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
}
