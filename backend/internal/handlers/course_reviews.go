package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"campus-forum/internal/mlclient"
	"campus-forum/internal/models"
	"campus-forum/internal/store"
)

// --- Course reviews (Sprint 6, stories 17-18) ---
//
// One review per student and course. Students see them without names; staff
// see the author. Moderation reuses the forum's AI checks in a small flow of
// its own: the instant word filter refuses obvious abuse before saving;
// otherwise the review is shown at once ("checking") and the full check runs
// in the background ("ok", or "held" for an admin to publish or reject).

const (
	reviewMinRunes       = 20
	reviewMaxRunes       = 2000
	reviewReportMaxRunes = 300
)

var reviewTerms = map[string]bool{"fall": true, "spring": true, "summer": true}

// reviewsFor shapes reviews for the viewer: staff see the author and the moderation details.
func reviewsFor(list []models.CourseReview, staff bool) []models.CourseReview {
	if !staff {
		return list
	}
	out := make([]models.CourseReview, len(list))
	for i, r := range list {
		out[i] = r.ForStaff()
	}
	return out
}

// ListCourseReviews: GET /api/courses/{code}/reviews?sort=new|helpful → {summary, reviews}.
func (h *Handlers) ListCourseReviews(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	code, ok := courseCode(r)
	if !ok {
		writeError(w, http.StatusNotFound, "course not found")
		return
	}
	sort := r.URL.Query().Get("sort")
	if sort != "" && sort != "new" && sort != "helpful" {
		writeError(w, http.StatusBadRequest, "sort must be new or helpful")
		return
	}
	staff := h.isModerator(r, uid)
	list, err := h.Store.ListCourseReviews(r.Context(), code, uid, staff, sort)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the reviews")
		return
	}
	summary, err := h.Store.CourseReviewSummary(r.Context(), code)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the reviews")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"summary": summary, "reviews": reviewsFor(list, staff)})
}

func validReview(in *models.CourseReviewInput) string {
	in.Text = strings.TrimSpace(in.Text)
	in.TakenTerm = strings.ToLower(strings.TrimSpace(in.TakenTerm))
	for _, v := range []int{in.Difficulty, in.Workload, in.Usefulness, in.Interest, in.Practical, in.Beginner} {
		if v < 1 || v > 5 {
			return "scores must be 1 to 5"
		}
	}
	if n := utf8.RuneCountInString(in.Text); n < reviewMinRunes || n > reviewMaxRunes {
		return "the review must be 20 to 2000 characters"
	}
	if now := time.Now().Year(); in.TakenYear < now-10 || in.TakenYear > now {
		return "invalid year"
	}
	if !reviewTerms[in.TakenTerm] {
		return "term must be fall, spring or summer"
	}
	return ""
}

// SaveCourseReview: PUT /api/courses/{code}/review — writes or replaces the
// student's review. 422 {code: "breaks_rules"} when the instant filter refuses it.
func (h *Handlers) SaveCourseReview(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireCanPost(w, r, uid) {
		return
	}
	code, ok := courseCode(r)
	if !ok {
		writeError(w, http.StatusNotFound, "course not found")
		return
	}
	var in models.CourseReviewInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if problem := validReview(&in); problem != "" {
		writeError(w, http.StatusBadRequest, problem)
		return
	}
	status := "ok"
	if h.moderationActive() {
		if v, ok := h.quickVerdict(r.Context(), in.Text); ok && v.Decision == "block" {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "the review breaks the rules", "code": "breaks_rules"})
			return
		}
		status = "checking"
	}
	review, err := h.Store.SaveCourseReview(r.Context(), code, uid, in, status)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "course not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save the review")
		return
	}
	if review.Status == "checking" {
		go h.checkReview(review.ID, review.Text)
	}
	writeJSON(w, http.StatusOK, review)
}

// checkReview runs the full AI check of a review in the background. The result
// applies only while the review is still being checked with the same text (an
// admin's decision or a newer edit wins).
func (h *Handlers) checkReview(id int64, text string) {
	backgroundSlots <- struct{}{}
	defer func() { <-backgroundSlots }()
	ctx := context.Background()
	verdict, ok := h.verdictFor(ctx, text)
	if !ok {
		verdict = mlclient.ModerationResult{Decision: "review", Reason: "moderation_unavailable"}
	}
	status, reason := "held", verdict.Reason
	if verdict.Decision == "allow" && verdict.PublishAllowed {
		status, reason = "ok", ""
	}
	err := h.Store.SetReviewStatus(ctx, id, status, reason, "checking", text)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		log.Printf("moderation: review %d: %v", id, err)
	} else if err == nil && status == "held" {
		log.Printf("moderation: review %d held (%s)", id, reason)
	}
}

// ResumeReviewChecks finishes review checks that were running when the server stopped.
func (h *Handlers) ResumeReviewChecks(ctx context.Context) {
	if !h.moderationActive() {
		return
	}
	list, err := h.Store.ReviewsBeingChecked(ctx)
	if err != nil {
		log.Printf("moderation: could not list unfinished review checks: %v", err)
		return
	}
	for _, rv := range list {
		go h.checkReview(rv.ID, rv.Text)
	}
}

// DeleteCourseReview: DELETE /api/courses/{code}/review — the student's own.
func (h *Handlers) DeleteCourseReview(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	code, ok := courseCode(r)
	if !ok {
		writeError(w, http.StatusNotFound, "course not found")
		return
	}
	if err := h.Store.DeleteMyCourseReview(r.Context(), code, uid); err != nil {
		writeStoreErr(w, err, "could not delete the review")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SetReviewHelpful: PUT /api/reviews/{id}/helpful {"helpful": true|false} → {"helpful": count}.
func (h *Handlers) SetReviewHelpful(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireNotBanned(w, r, uid) {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid review id")
		return
	}
	var req struct {
		Helpful bool `json:"helpful"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	n, err := h.Store.SetReviewHelpful(r.Context(), id, uid, req.Helpful)
	if errors.Is(err, store.ErrForbidden) {
		writeError(w, http.StatusForbidden, "you can't mark your own review")
		return
	}
	if err != nil {
		writeStoreErr(w, err, "could not save")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"helpful": n})
}

// ReportReview: POST /api/reviews/{id}/report {"reason"}.
func (h *Handlers) ReportReview(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if !h.requireNotBanned(w, r, uid) {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid review id")
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if utf8.RuneCountInString(reason) > reviewReportMaxRunes {
		writeError(w, http.StatusBadRequest, "the reason is too long")
		return
	}
	switch err := h.Store.ReportReview(r.Context(), id, uid, reason); {
	case errors.Is(err, store.ErrForbidden):
		writeError(w, http.StatusForbidden, "you can't report your own review")
	case errors.Is(err, store.ErrConflict):
		writeError(w, http.StatusConflict, "you already reported this review")
	case err != nil:
		writeStoreErr(w, err, "could not send the report")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// ListReviewsForAdmin: GET /api/admin/reviews — held or reported reviews, with their authors.
func (h *Handlers) ListReviewsForAdmin(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.mapAdmin(w, r); !ok {
		return
	}
	list, err := h.Store.ReviewsForAdmin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the reviews")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reviews": reviewsFor(list, true)})
}

// DecideReview: POST /api/admin/reviews/{id}/{action} {"text": the text the
// admin read}, action = publish (shown, reports closed), reject (hidden for
// good, reports closed) or keep (reports closed, the review stays as it is).
// Publish and keep apply only to that text: if the author changed the review
// meanwhile, 409 and the admin looks again.
func (h *Handlers) DecideReview(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.mapAdmin(w, r)
	if !ok {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid review id")
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
	}
	action := r.PathValue("action")
	current, err := h.Store.GetCourseReview(r.Context(), id, 0)
	if err != nil {
		writeStoreErr(w, err, "could not load the review")
		return
	}
	if (action == "publish" || action == "keep") && req.Text != current.Text {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "the review was changed; look at it again", "code": "changed"})
		return
	}
	switch action {
	case "publish":
		// Only the version the admin read (an edit made meanwhile gets its own check).
		if err := h.Store.SetReviewStatus(r.Context(), id, "ok", "", "", req.Text); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeJSON(w, http.StatusConflict, map[string]any{"error": "the review was changed; look at it again", "code": "changed"})
				return
			}
			writeStoreErr(w, err, "could not save")
			return
		}
	case "reject":
		if err := h.Store.SetReviewStatus(r.Context(), id, "rejected", "", "", ""); err != nil {
			writeStoreErr(w, err, "could not save")
			return
		}
	case "keep":
	default:
		writeError(w, http.StatusBadRequest, "action must be publish, reject or keep")
		return
	}
	if err := h.Store.ResolveReviewReports(r.Context(), id, uid); err != nil {
		writeError(w, http.StatusInternalServerError, "could not close the reports")
		return
	}
	review, err := h.Store.GetCourseReview(r.Context(), id, 0)
	if err != nil {
		writeStoreErr(w, err, "could not load the review")
		return
	}
	writeJSON(w, http.StatusOK, review.ForStaff())
}
