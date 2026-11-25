package models

import "time"

// --- Courses (Sprint 6) ---

// Program is a study program by the portal's code ("10107").
type Program struct {
	Code    string `json:"code"`
	Title   string `json:"title"`
	Level   string `json:"level"` // B, M, DR, DS
	Tag     string `json:"tag"`   // DD, MBA, EMBA or ""
	Cipher  string `json:"cipher"`
	Lang    string `json:"lang"`
	Faculty string `json:"faculty"`
	// Entry years with an imported curriculum (newest first).
	Years []int `json:"years"`
}

// Course is one course of the catalogue.
type Course struct {
	Code          string `json:"code"`
	Name          string `json:"name"`
	Theory        int    `json:"theory"`
	Practice      string `json:"practice"`
	Hours         int    `json:"hours"`
	ECTS          int    `json:"ects"`
	Description   string `json:"description"`
	DescriptionKZ string `json:"description_kz"`
	DescriptionRU string `json:"description_ru"`
}

// CurriculumInfo is an imported curriculum in the admin list.
type CurriculumInfo struct {
	ID           int64     `json:"id"`
	ProgramCode  string    `json:"program_code"`
	ProgramTitle string    `json:"program_title"`
	Lang         string    `json:"lang"`
	Year         int       `json:"year"`
	Track        string    `json:"track"`
	Courses      int       `json:"courses"`
	ImportedAt   time.Time `json:"imported_at"`
}

// CurriculumView is a program's plan as the Courses page shows it.
type CurriculumView struct {
	CurriculumInfo
	Program   Program              `json:"program"`
	Tracks    []string             `json:"tracks"` // the imported tracks of this program and year
	Semesters []CurriculumSemester `json:"semesters"`
	// Elective lists (AE, NAE…) → the courses in them.
	Electives map[string][]CourseRef `json:"electives"`
	// Ratings: course code → how its visible reviews recommend it (only
	// courses of this plan that have reviews).
	Ratings map[string]ReviewBrief `json:"ratings"`
}

// ReviewBrief is a course's reviews in a few numbers, for lists (and for
// sorting electives: easiest, most useful).
type ReviewBrief struct {
	Count        int     `json:"count"`
	RecommendPct int     `json:"recommend_pct"`
	Difficulty   float64 `json:"difficulty"` // average 1-5
	Usefulness   float64 `json:"usefulness"` // average 1-5
}

// CurriculumSemester is one term.
type CurriculumSemester struct {
	Number int              `json:"number"`
	ECTS   int              `json:"ects"`
	Items  []CurriculumItem `json:"items"`
}

// CurriculumItem is a fixed course (Course set) or an elective slot.
type CurriculumItem struct {
	Course  *CourseRef  `json:"course,omitempty"`
	Kind    string      `json:"kind,omitempty"`  // slot: AE, NAE, NTE…
	Label   string      `json:"label,omitempty"` // slot: "Elective 2"
	Options []CourseRef `json:"options,omitempty"`
	ECTS    int         `json:"ects"`
	Hours   int         `json:"hours"`
	Marked  bool        `json:"marked"`
}

// CourseRef is a course code with its name ("" when the course is not in the
// catalogue yet, e.g. an elective option of a program not imported).
type CourseRef struct {
	Code string `json:"code"`
	Name string `json:"name"`
	ECTS int    `json:"ects"`
}

// CourseDescriptionGap is a course taught in some program that has no
// description in one or more languages (admin panel → Courses).
type CourseDescriptionGap struct {
	Code     string   `json:"code"`
	Name     string   `json:"name"`
	ECTS     int      `json:"ects"`
	Programs int      `json:"programs"` // how many programs teach it
	Missing  []string `json:"missing"`  // en, kz, ru
}

// CourseDetail is the course card: the course and where it is taught.
type CourseDetail struct {
	Course
	Places []CoursePlace `json:"places"`
}

// CoursePlace is one program/semester where the course appears.
type CoursePlace struct {
	ProgramCode  string `json:"program_code"`
	ProgramTitle string `json:"program_title"`
	Lang         string `json:"lang"`
	Level        string `json:"level"`
	Year         int    `json:"year"`
	Track        string `json:"track"`
	Semester     int    `json:"semester"` // 0 = only in an elective list
	Kind         string `json:"kind"`     // "" = required; AE, NAE… = elective
	Label        string `json:"label"`    // the slot's label for an elective
}

// UserProgram is a student's program and entry year.
type UserProgram struct {
	ProgramCode string `json:"program_code"`
	EntryYear   int    `json:"entry_year"`
}

// CourseReview is a student's review of a course (stories 17-18). Students
// see reviews without the author; AuthorID/AuthorName, ModerationReason and
// the report fields are filled for staff only.
type CourseReview struct {
	ID         int64      `json:"id"`
	CourseCode string     `json:"course_code"`
	CourseName string     `json:"course_name,omitempty"`
	Difficulty int        `json:"difficulty"`
	Workload   int        `json:"workload"`
	Usefulness int        `json:"usefulness"`
	// The hexagon's three other scores (0 = a review from before they existed).
	Interest   int        `json:"interest"`
	Practical  int        `json:"practical"`
	Beginner   int        `json:"beginner"`
	Recommend  bool       `json:"recommend"`
	Text       string     `json:"text"`
	TakenYear  int        `json:"taken_year"`
	TakenTerm  string     `json:"taken_term"` // fall, spring, summer
	Status     string     `json:"status"`     // checking, ok, held, rejected
	Helpful    int        `json:"helpful"`
	HelpedByMe bool       `json:"helped_by_me"`
	Mine       bool       `json:"mine"`
	CreatedAt  time.Time  `json:"created_at"`
	EditedAt   *time.Time `json:"edited_at,omitempty"`
	// Loaded for every review but never sent as such ("-"): ForStaff copies
	// them into the fields below, which stay empty for students (anonymous reviews).
	UserID  int64    `json:"-"`
	Author  string   `json:"-"`
	Reason  string   `json:"-"`
	Reports int      `json:"-"`
	Reasons []string `json:"-"`
	// Staff only.
	AuthorID         *int64   `json:"author_id,omitempty"`
	AuthorName       string   `json:"author_name,omitempty"`
	ModerationReason string   `json:"moderation_reason,omitempty"`
	OpenReports      int      `json:"open_reports,omitempty"`
	ReportReasons    []string `json:"report_reasons,omitempty"`
}

// ForStaff fills the fields only staff may see: who wrote it, why the
// moderation held it, open reports.
func (r CourseReview) ForStaff() CourseReview {
	id := r.UserID
	r.AuthorID, r.AuthorName, r.ModerationReason, r.OpenReports, r.ReportReasons = &id, r.Author, r.Reason, r.Reports, r.Reasons
	return r
}

// CourseReviewInput is what a student sends.
type CourseReviewInput struct {
	Difficulty int    `json:"difficulty"`
	Workload   int    `json:"workload"`
	Usefulness int    `json:"usefulness"`
	Interest   int    `json:"interest"`
	Practical  int    `json:"practical"`
	Beginner   int    `json:"beginner"`
	Recommend  bool   `json:"recommend"`
	Text       string `json:"text"`
	TakenYear  int    `json:"taken_year"`
	TakenTerm  string `json:"taken_term"`
}

// ReviewSummary is the averages of a course's visible reviews.
// ReviewAISummary is the AI's overview of a course's published reviews in
// one language (saved until the reviews change; Fingerprint says which ones).
type ReviewAISummary struct {
	Summary     string    `json:"summary"`
	Liked       []string  `json:"liked"`
	Warnings    []string  `json:"warnings"`
	ReviewCount int       `json:"review_count"`
	CreatedAt   time.Time `json:"created_at"`
	Fingerprint string    `json:"-"`
}

type ReviewSummary struct {
	Count        int     `json:"count"`
	Difficulty   float64 `json:"difficulty"`
	Workload     float64 `json:"workload"`
	Usefulness   float64 `json:"usefulness"`
	Interest     float64 `json:"interest"`
	Practical    float64 `json:"practical"`
	Beginner     float64 `json:"beginner"`
	RecommendPct int     `json:"recommend_pct"`
}
