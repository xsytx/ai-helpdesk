package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"campus-forum/internal/mlclient"
	"campus-forum/internal/models"
	"campus-forum/internal/store"
)

// --- AI summary of a course's reviews (Courses, stories 17-18) ---
//
// GET /api/courses/{code}/reviews/ai-summary?lang=en|kz|ru. Made by ai_ml from
// the course's published reviews (at least summaryMinReviews), saved per
// course and language, and made again only when those reviews change (a new
// one is published, edited, hidden or deleted). So any course, also one
// imported later, gets a summary once it has enough reviews, and the AI is
// asked once per change, not once per page view.

const (
	summaryMinReviews = 3
	summaryMaxReviews = 40
	summaryTimeout    = 120 * time.Second
)

var summaryLangs = map[string]string{"en": "en", "kz": "kk", "ru": "ru"}

// summaryLocks: one generation at a time per course and language, so many
// students opening the same card don't each ask the AI.
var summaryLocks sync.Map

func summaryLock(key string) *sync.Mutex {
	m, _ := summaryLocks.LoadOrStore(key, &sync.Mutex{})
	return m.(*sync.Mutex)
}

func summaryRequest(list []models.CourseReview, sum models.ReviewSummary, lang string) mlclient.SummaryRequest {
	course := list[0].CourseCode
	if list[0].CourseName != "" {
		course += " " + list[0].CourseName
	}
	in := mlclient.SummaryRequest{Course: course, Language: summaryLangs[lang], Reviews: make([]mlclient.SummaryReview, len(list))}
	for i, v := range list {
		in.Reviews[i] = mlclient.SummaryReview{Text: v.Text, Recommend: v.Recommend, Difficulty: v.Difficulty,
			Workload: v.Workload, Usefulness: v.Usefulness, Interest: v.Interest, Practical: v.Practical, Beginner: v.Beginner}
	}
	if sum.Count > 0 {
		in.Averages = map[string]float64{"difficulty": sum.Difficulty, "workload": sum.Workload, "usefulness": sum.Usefulness}
		for k, v := range map[string]float64{"interest": sum.Interest, "practical": sum.Practical, "beginner": sum.Beginner} {
			if v > 0 {
				in.Averages[k] = v
			}
		}
	}
	return in
}

// ReviewAISummary answers {status: "too_few", review_count, min} (not enough
// published reviews), {status: "ready", summary} or {status: "unavailable"}
// (the AI is off or failed: the card simply shows no summary).
func (h *Handlers) ReviewAISummary(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.userID(r); !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	code, ok := courseCode(r)
	if !ok {
		writeError(w, http.StatusNotFound, "course not found")
		return
	}
	lang := r.URL.Query().Get("lang")
	if lang == "" {
		lang = "en"
	}
	if _, ok := summaryLangs[lang]; !ok {
		writeError(w, http.StatusBadRequest, "lang must be en, kz or ru")
		return
	}
	ctx := r.Context()
	_, fingerprint, count, err := h.Store.ReviewsForAISummary(ctx, code, 0)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the summary")
		return
	}
	if count < summaryMinReviews {
		writeJSON(w, http.StatusOK, map[string]any{"status": "too_few", "review_count": count, "min": summaryMinReviews})
		return
	}
	ready := func(v models.ReviewAISummary) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ready", "summary": v})
	}
	if saved, err := h.Store.GetReviewAISummary(ctx, code, lang); err == nil && saved.Fingerprint == fingerprint {
		ready(saved)
		return
	} else if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusInternalServerError, "could not load the summary")
		return
	}
	if h.ML == nil {
		writeJSON(w, http.StatusOK, map[string]any{"status": "unavailable"})
		return
	}

	lock := summaryLock(code + "|" + lang)
	lock.Lock()
	defer lock.Unlock()
	// The student leaving the page doesn't stop it: the next visitor gets the result.
	gen, cancel := context.WithTimeout(context.WithoutCancel(ctx), summaryTimeout)
	defer cancel()
	list, fingerprint, count, err := h.Store.ReviewsForAISummary(gen, code, summaryMaxReviews)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the summary")
		return
	}
	if count < summaryMinReviews {
		writeJSON(w, http.StatusOK, map[string]any{"status": "too_few", "review_count": count, "min": summaryMinReviews})
		return
	}
	// Made by another request while this one waited for the lock.
	if saved, err := h.Store.GetReviewAISummary(gen, code, lang); err == nil && saved.Fingerprint == fingerprint {
		ready(saved)
		return
	}
	averages, err := h.Store.CourseReviewSummary(gen, code)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the summary")
		return
	}
	started := time.Now()
	out, err := h.ML.SummarizeReviews(gen, summaryRequest(list, averages, lang))
	if err != nil {
		log.Printf("review summary %s (%s): failed after %s: %v", code, lang, time.Since(started).Round(time.Millisecond), err)
		writeJSON(w, http.StatusOK, map[string]any{"status": "unavailable"})
		return
	}
	h.countAICall(gen, "summary")
	saved, err := h.Store.SaveReviewAISummary(gen, code, lang, models.ReviewAISummary{
		Summary: out.Summary, Liked: out.Liked, Warnings: out.Warnings, ReviewCount: count, Fingerprint: fingerprint})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save the summary")
		return
	}
	log.Printf("review summary %s (%s): %d reviews in %s", code, lang, count, time.Since(started).Round(time.Millisecond))
	ready(saved)
}
