package handlers

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"campus-forum/internal/curricula"
	"campus-forum/internal/store"
)

// --- Courses (Sprint 6, story 16): the catalogue by program and semester ---
//
// Admins paste a program's curriculum page from the SDU portal (Curricula →
// program → track; Ctrl+A, Ctrl+C) into the admin panel; internal/curricula
// reads it. Everyone signed in browses programs, semesters and courses.

var programCodeRx = regexp.MustCompile(`^\d{5}$`)

const (
	maxCourseQueryRunes  = 100
	maxDescriptionRunes  = 3000
	maxCurriculumRequest = curricula.MaxText + 100_000 // the JSON around the pasted text
)

// ListPrograms: GET /api/programs.
func (h *Handlers) ListPrograms(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.userID(r); !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	programs, err := h.Store.ListPrograms(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the programs")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"programs": programs})
}

// GetCurriculum: GET /api/curriculum?program=10107&year=2026&track=Main%20Track
// (year and track optional: the newest year, the main track).
func (h *Handlers) GetCurriculum(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.userID(r); !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	q := r.URL.Query()
	program := strings.TrimSpace(q.Get("program"))
	if !programCodeRx.MatchString(program) {
		writeError(w, http.StatusBadRequest, "invalid program")
		return
	}
	year := 0
	if s := q.Get("year"); s != "" {
		y, err := strconv.Atoi(s)
		if err != nil || y < 2000 || y > 2100 {
			writeError(w, http.StatusBadRequest, "invalid year")
			return
		}
		year = y
	}
	track := strings.TrimSpace(q.Get("track"))
	if utf8.RuneCountInString(track) > 120 {
		writeError(w, http.StatusBadRequest, "invalid track")
		return
	}
	cur, err := h.Store.GetCurriculum(r.Context(), program, year, track)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no curriculum for this program yet")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the curriculum")
		return
	}
	// How students rate the plan's courses (the list shows it next to each).
	var codes []string
	for _, sem := range cur.Semesters {
		for _, it := range sem.Items {
			if it.Course != nil {
				codes = append(codes, it.Course.Code)
			}
			for _, o := range it.Options {
				codes = append(codes, o.Code)
			}
		}
	}
	for _, list := range cur.Electives {
		for _, c := range list {
			codes = append(codes, c.Code)
		}
	}
	if cur.Ratings, err = h.Store.ReviewBriefs(r.Context(), codes); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the curriculum")
		return
	}
	writeJSON(w, http.StatusOK, cur)
}

// SearchCourses: GET /api/courses?q=algebra (by code or name).
func (h *Handlers) SearchCourses(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.userID(r); !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || utf8.RuneCountInString(q) > maxCourseQueryRunes {
		writeError(w, http.StatusBadRequest, "type 1 to 100 characters")
		return
	}
	courses, err := h.Store.SearchCourses(r.Context(), q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not search the courses")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"courses": courses})
}

// courseCode reads {code} from the path: "MAT-101", "MAT 101", "mat101".
func courseCode(r *http.Request) (string, bool) {
	return curricula.NormalizeCode(strings.ReplaceAll(r.PathValue("code"), "-", " "))
}

// GetCourse: GET /api/courses/{code} — the course card.
func (h *Handlers) GetCourse(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.userID(r); !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	code, ok := courseCode(r)
	if !ok {
		writeError(w, http.StatusNotFound, "course not found")
		return
	}
	course, err := h.Store.GetCourse(r.Context(), code)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "course not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the course")
		return
	}
	writeJSON(w, http.StatusOK, course)
}

// GetMyProgram: GET /api/me/program → {"program": {...} | null}.
func (h *Handlers) GetMyProgram(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	up, err := h.Store.GetUserProgram(r.Context(), uid)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"program": nil})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load your program")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"program": up})
}

// SetMyProgram: PUT /api/me/program {"program_code": "10107", "entry_year": 2024}.
func (h *Handlers) SetMyProgram(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req struct {
		ProgramCode string `json:"program_code"`
		EntryYear   int    `json:"entry_year"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !programCodeRx.MatchString(req.ProgramCode) {
		writeError(w, http.StatusBadRequest, "invalid program")
		return
	}
	// No future entry years (nobody has started them yet).
	if now := time.Now().Year(); req.EntryYear < now-10 || req.EntryYear > now {
		writeError(w, http.StatusBadRequest, "invalid entry year")
		return
	}
	up, err := h.Store.SetUserProgram(r.Context(), uid, req.ProgramCode, req.EntryYear)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusBadRequest, "unknown program")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save your program")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"program": up})
}

// readCurriculum reads {"text": "..."} (a pasted portal page) and parses it;
// on a problem it has written the error.
func (h *Handlers) readCurriculum(w http.ResponseWriter, r *http.Request) (curricula.Curriculum, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxCurriculumRequest)
	var req struct {
		Text string `json:"text"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body or the text is too long")
		return curricula.Curriculum{}, false
	}
	cur, err := curricula.Parse(req.Text)
	var pe *curricula.ParseError
	if errors.As(err, &pe) {
		writeUnreadable(w, pe.Code)
		return cur, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not read the text")
		return cur, false
	}
	return cur, true
}

// PreviewCurriculum: POST /api/admin/curricula/preview {"text"} — what an
// import would save, without saving it.
func (h *Handlers) PreviewCurriculum(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.mapAdmin(w, r); !ok {
		return
	}
	cur, ok := h.readCurriculum(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, cur)
}

// ImportCurriculum: POST /api/admin/curricula {"text"} — saves it (replacing
// an earlier import of the same program, year and track).
func (h *Handlers) ImportCurriculum(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.mapAdmin(w, r)
	if !ok {
		return
	}
	cur, ok := h.readCurriculum(w, r)
	if !ok {
		return
	}
	// An import replaces the earlier one: never with a half-read page.
	if problem := cur.ImportProblem(); problem != "" {
		writeUnreadable(w, problem)
		return
	}
	info, err := h.Store.ImportCurriculum(r.Context(), cur, uid)
	if errors.Is(err, store.ErrInvalidTarget) {
		writeUnreadable(w, "duplicate_semester")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save the curriculum")
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

// ListCurricula: GET /api/admin/curricula.
func (h *Handlers) ListCurricula(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.mapAdmin(w, r); !ok {
		return
	}
	list, err := h.Store.ListCurricula(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load the curricula")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"curricula": list})
}

// DeleteCurriculum: DELETE /api/admin/curricula/{id}.
func (h *Handlers) DeleteCurriculum(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.mapAdmin(w, r); !ok {
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid curriculum id")
		return
	}
	if err := h.Store.DeleteCurriculum(r.Context(), id); err != nil {
		writeStoreErr(w, err, "could not delete the curriculum")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// UpdateCourse: PUT /api/admin/courses/{code} {"description", "description_kz", "description_ru"}.
func (h *Handlers) UpdateCourse(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.mapAdmin(w, r); !ok {
		return
	}
	code, ok := courseCode(r)
	if !ok {
		writeError(w, http.StatusNotFound, "course not found")
		return
	}
	var req struct {
		Description   string `json:"description"`
		DescriptionKZ string `json:"description_kz"`
		DescriptionRU string `json:"description_ru"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	texts := []*string{&req.Description, &req.DescriptionKZ, &req.DescriptionRU}
	for _, t := range texts {
		*t = strings.TrimSpace(*t)
		if utf8.RuneCountInString(*t) > maxDescriptionRunes {
			writeError(w, http.StatusBadRequest, "a description is too long")
			return
		}
	}
	course, err := h.Store.UpdateCourseDescription(r.Context(), code, req.Description, req.DescriptionKZ, req.DescriptionRU)
	if err != nil {
		writeStoreErr(w, err, "could not save the course")
		return
	}
	writeJSON(w, http.StatusOK, course)
}

// writeUnreadable: 422 with a code the website turns into a message in the
// admin's language (too_long, no_header, no_semesters, two_curricula,
// unreadable_rows, empty_semester, duplicate_semester).
func writeUnreadable(w http.ResponseWriter, code string) {
	writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "the text is not one readable curriculum: " + code, "code": code})
}
