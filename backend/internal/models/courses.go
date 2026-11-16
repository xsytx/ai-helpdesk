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
