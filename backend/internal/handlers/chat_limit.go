package handlers

import (
	"context"
	"log"
	"net/http"
	"time"
)

// --- AI daily limit (030_ai_usage.sql) ---
//
// Each student may have ChatDailyLimit questions answered by the AI chat per
// day (Almaty date, CHAT_DAILY_LIMIT, 0 = no limit). The AI's free quota is
// shared by everyone, so one student can't use it up. Not counted: FAQ
// answers (no AI), questions that failed; counted: answered questions and
// stopped answers (the AI worked on them). Staff have no limit. A refused
// question is 429 {code: "daily_limit", limit, used, resets_at}; the chat
// status and every answer carry what is left, so the page can say so.

// almaty is Kazakhstan's time (UTC+5 all year since 2024): the day resets at its midnight.
var almaty = time.FixedZone("Almaty", 5*60*60)

// chatNow is the clock (tests move it).
var chatNow = time.Now

func chatDay() time.Time { return chatNow().In(almaty) }

// nextMidnight is when today's count ends.
func nextMidnight() time.Time {
	d := chatDay()
	return time.Date(d.Year(), d.Month(), d.Day()+1, 0, 0, 0, 0, almaty)
}

// chatQuota says whether uid has a daily limit, and how many questions are
// left today (limited = false: staff, or no limit set).
func (h *Handlers) chatQuota(ctx context.Context, uid int64) (limited bool, used, left int) {
	if h.ChatDailyLimit <= 0 {
		return false, 0, 0
	}
	if u, err := h.Store.GetUserByID(ctx, uid); err == nil && u.IsModerator() {
		return false, 0, 0
	}
	used, err := h.Store.AIQuestionsOn(ctx, uid, chatDay())
	if err != nil {
		// A failed read never blocks a question.
		log.Printf("ai usage of user %d: %v", uid, err)
		return false, 0, 0
	}
	return true, used, max(h.ChatDailyLimit-used, 0)
}

// refuseOverLimit writes the 429 and returns true when uid has no questions left today.
func (h *Handlers) refuseOverLimit(w http.ResponseWriter, r *http.Request, uid int64) bool {
	limited, used, left := h.chatQuota(r.Context(), uid)
	if !limited || left > 0 {
		return false
	}
	writeJSON(w, http.StatusTooManyRequests, map[string]any{
		"error": "daily AI question limit reached", "code": "daily_limit",
		"limit": h.ChatDailyLimit, "used": used, "resets_at": nextMidnight(),
	})
	return true
}

// countAICall records one call to the AI ("chat", "moderation", "summary")
// for the dashboard's quota bar; a failed write is only logged.
func (h *Handlers) countAICall(ctx context.Context, kind string) {
	if err := h.Store.CountAICall(ctx, chatDay(), kind); err != nil {
		log.Printf("count ai call (%s): %v", kind, err)
	}
}

// countAIQuestion records an answered question (for everyone, also staff and
// with no limit set: the admin dashboard shows the day's total) and returns
// how many are left today (nil = no limit for uid).
func (h *Handlers) countAIQuestion(ctx context.Context, uid int64) *int {
	h.countAICall(ctx, "chat")
	used, err := h.Store.CountAIQuestion(ctx, uid, chatDay())
	if err != nil {
		log.Printf("count ai question of user %d: %v", uid, err)
		return nil
	}
	if h.ChatDailyLimit <= 0 {
		return nil
	}
	if u, err := h.Store.GetUserByID(ctx, uid); err == nil && u.IsModerator() {
		return nil
	}
	left := max(h.ChatDailyLimit-used, 0)
	return &left
}
