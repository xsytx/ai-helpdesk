package handlers

import (
	"context"
	"fmt"
	"log"
	"slices"
	"strconv"
	"strings"

	"campus-forum/internal/mlclient"
	"campus-forum/internal/models"
)

// --- Questions about courses in the AI chat ---
//
// A question that names a course by code ("Is CSS 331 hard?") or full name
// ("What is Operating Systems about?") gets that course's catalogue facts and
// published reviews (anonymous, "ok" only: never a text the moderation may
// still hide) next to it, and the answer links to the course card. A
// follow-up without a course ("and the workload?") uses the course of the
// latest earlier question that named one.

const (
	chatCourseLimit   = 2
	chatCourseReviews = 6
	chatCoursePlaces  = 8
)

// chatCourses finds the courses the question is about: named in it, or in
// the latest earlier question of the chat that named any.
func (h *Handlers) chatCourses(ctx context.Context, question string, history []mlclient.HistoryItem) []models.Course {
	texts := []string{question}
	for i := len(history) - 1; i >= 0; i-- {
		if history[i].Role == "user" {
			texts = append(texts, history[i].Text)
		}
	}
	for _, text := range texts {
		list, err := h.Store.CoursesInText(ctx, text, chatCourseLimit)
		if err != nil {
			log.Printf("chat courses in question: %v", err)
			return nil
		}
		if len(list) > 0 {
			return list
		}
	}
	return nil
}

// courseFacts is what the model gets about a course. A failed read only
// leaves that part out.
func (h *Handlers) courseFacts(ctx context.Context, c models.Course) mlclient.CourseFacts {
	f := mlclient.CourseFacts{
		Code: c.Code, Name: c.Name, ECTS: c.ECTS, Theory: c.Theory, Practice: c.Practice, Hours: c.Hours,
		Description: map[string]string{}, TaughtIn: []string{}, Averages: map[string]float64{}, Reviews: []mlclient.CourseReviewText{},
	}
	for lang, text := range map[string]string{"en": c.Description, "kk": c.DescriptionKZ, "ru": c.DescriptionRU} {
		if text != "" {
			f.Description[lang] = text
		}
	}
	if d, err := h.Store.GetCourse(ctx, c.Code); err == nil {
		f.TaughtIn = coursePlacesText(d.Places, chatCoursePlaces)
	} else {
		log.Printf("chat course %s places: %v", c.Code, err)
	}
	reviews, _, count, err := h.Store.ReviewsForAISummary(ctx, c.Code, chatCourseReviews)
	if err != nil {
		log.Printf("chat course %s reviews: %v", c.Code, err)
		return f
	}
	f.ReviewCount = count
	for _, r := range reviews {
		f.Reviews = append(f.Reviews, mlclient.CourseReviewText{Text: r.Text, Recommend: r.Recommend})
	}
	if count == 0 {
		return f
	}
	if sum, err := h.Store.CourseReviewSummary(ctx, c.Code); err == nil && sum.Count > 0 {
		pct := sum.RecommendPct
		f.RecommendPct = &pct
		for k, v := range map[string]float64{"difficulty": sum.Difficulty, "workload": sum.Workload, "usefulness": sum.Usefulness,
			"interest": sum.Interest, "practical": sum.Practical, "beginner": sum.Beginner} {
			if v > 0 {
				f.Averages[k] = v
			}
		}
	}
	return f
}

// coursePlacesText says where a course is taught, once per program and
// semester, with the entry years that have it there (plans change between
// years): "Computer Science (EN), semester 5, required (entry 2024, 2023)".
func coursePlacesText(places []models.CoursePlace, limit int) []string {
	order, years := []string{}, map[string][]string{}
	for _, p := range places {
		where := fmt.Sprintf("%s (%s)", p.ProgramTitle, p.Lang)
		switch {
		case p.Semester == 0:
			where += ", in the elective list " + p.Kind
		case p.Kind == "":
			where += fmt.Sprintf(", semester %d, required", p.Semester)
		default:
			where += fmt.Sprintf(", semester %d, elective %s", p.Semester, p.Kind)
		}
		if _, ok := years[where]; !ok {
			if len(order) == limit {
				continue
			}
			order = append(order, where)
		}
		y := strconv.Itoa(p.Year)
		if !slices.Contains(years[where], y) {
			years[where] = append(years[where], y)
		}
	}
	out := make([]string, len(order))
	for i, where := range order {
		out[i] = where + " (entry " + strings.Join(years[where], ", ") + ")"
	}
	return out
}

// chatCourseRefs are the links under the answer.
func chatCourseRefs(facts []mlclient.CourseFacts) []models.ChatCourse {
	if len(facts) == 0 {
		return nil
	}
	out := make([]models.ChatCourse, len(facts))
	for i, f := range facts {
		out[i] = models.ChatCourse{Code: f.Code, Name: f.Name}
	}
	return out
}
