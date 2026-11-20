package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"campus-forum/internal/middleware"
)

// Courses (story 16). Real database, skipped without TEST_DATABASE_URL.

func newCoursesEnv(t *testing.T) *modEnv {
	t.Helper()
	e := newModEnv(t)
	authMw := middleware.Auth(e.secret)
	mux := http.NewServeMux()
	mux.Handle("GET /api/programs", authMw(http.HandlerFunc(e.h.ListPrograms)))
	mux.Handle("GET /api/curriculum", authMw(http.HandlerFunc(e.h.GetCurriculum)))
	mux.Handle("GET /api/courses", authMw(http.HandlerFunc(e.h.SearchCourses)))
	mux.Handle("GET /api/courses/{code}", authMw(http.HandlerFunc(e.h.GetCourse)))
	mux.Handle("GET /api/me/program", authMw(http.HandlerFunc(e.h.GetMyProgram)))
	mux.Handle("PUT /api/me/program", authMw(http.HandlerFunc(e.h.SetMyProgram)))
	mux.Handle("POST /api/admin/curricula/preview", authMw(http.HandlerFunc(e.h.PreviewCurriculum)))
	mux.Handle("POST /api/admin/curricula", authMw(http.HandlerFunc(e.h.ImportCurriculum)))
	mux.Handle("GET /api/admin/curricula", authMw(http.HandlerFunc(e.h.ListCurricula)))
	mux.Handle("DELETE /api/admin/curricula/{id}", authMw(http.HandlerFunc(e.h.DeleteCurriculum)))
	mux.Handle("PUT /api/admin/courses/{code}", authMw(http.HandlerFunc(e.h.UpdateCourse)))
	e.srv.Close()
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

func sampleCurriculum(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("../curricula/testdata/mathematics_10101_2026.txt")
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func list(v any) []map[string]any {
	var out []map[string]any
	if a, ok := v.([]any); ok {
		for _, x := range a {
			out = append(out, x.(map[string]any))
		}
	}
	return out
}

func TestCurriculumImportAndCatalogue(t *testing.T) {
	e := newCoursesEnv(t)
	student, admin := e.user("user"), e.user("admin")
	text := sampleCurriculum(t)

	// Only staff import; unreadable text is refused.
	if code, _ := e.call(student, http.MethodPost, "/api/admin/curricula", map[string]any{"text": text}); code != http.StatusForbidden {
		t.Fatalf("a student imports: %d, want 403", code)
	}
	if code, out := e.call(admin, http.MethodPost, "/api/admin/curricula/preview", map[string]any{"text": "just some words"}); code != http.StatusUnprocessableEntity || out["code"] != "no_header" {
		t.Fatalf("unreadable text: %d %v", code, out)
	}
	if code, out := e.call(admin, http.MethodPost, "/api/admin/curricula", map[string]any{"text": text + "\n" + text}); code != http.StatusUnprocessableEntity || out["code"] != "two_curricula" {
		t.Fatalf("two pages at once: %d %v", code, out)
	}
	// A row that can't be read: the preview shows it, the import refuses (it would replace a good import).
	broken := strings.Replace(text, "1 \tMAT 101 \tMathematical analysis 1 \t \t2 \t2+0 \t4 \t5", "1 \tMAT 101 \tMathematical analysis 1 \t \t2 \t2+0", 1)
	if broken == text {
		t.Fatal("test setup: the row to break was not found")
	}
	if code, out := e.call(admin, http.MethodPost, "/api/admin/curricula/preview", map[string]any{"text": broken}); code != http.StatusOK || len(out["warnings"].([]any)) == 0 {
		t.Fatalf("preview of a broken row: %d %v", code, out["warnings"])
	}
	if code, out := e.call(admin, http.MethodPost, "/api/admin/curricula", map[string]any{"text": broken}); code != http.StatusUnprocessableEntity || out["code"] != "unreadable_rows" {
		t.Fatalf("import of a broken row: %d %v", code, out)
	}
	code, preview := e.call(admin, http.MethodPost, "/api/admin/curricula/preview", map[string]any{"text": text})
	if code != http.StatusOK || preview["program_code"] != "10101" || len(list(preview["semesters"])) != 8 {
		t.Fatalf("preview: %d %v", code, preview["program_code"])
	}

	code, info := e.call(admin, http.MethodPost, "/api/admin/curricula", map[string]any{"text": text})
	if code != http.StatusCreated || info["program_code"] != "10101" || num(info["year"]) != 2026 || info["track"] != "Main Track" || num(info["courses"]) < 40 {
		t.Fatalf("import: %d %v", code, info)
	}
	// Importing again replaces it (same id), no duplicate.
	if code, again := e.call(admin, http.MethodPost, "/api/admin/curricula", map[string]any{"text": text}); code != http.StatusCreated || num(again["id"]) != num(info["id"]) {
		t.Fatalf("import again: %d %v", code, again)
	}
	_, all := e.call(admin, http.MethodGet, "/api/admin/curricula", nil)
	seen := 0
	for _, c := range list(all["curricula"]) {
		if num(c["id"]) == num(info["id"]) {
			seen++
		}
	}
	if seen != 1 {
		t.Fatalf("curriculum listed %d times", seen)
	}

	// The program now has a year.
	_, progs := e.call(student, http.MethodGet, "/api/programs", nil)
	found := false
	for _, p := range list(progs["programs"]) {
		if p["code"] == "10101" {
			years := p["years"].([]any)
			found = len(years) > 0 && num(years[0]) == 2026 && p["faculty"] == "F_ENG"
		}
	}
	if !found {
		t.Fatal("program 10101 without its 2026 curriculum in /api/programs")
	}

	// The plan: 8 semesters, courses with names, slots with their options.
	code, cur := e.call(student, http.MethodGet, "/api/curriculum?program=10101", nil)
	if code != http.StatusOK {
		t.Fatalf("curriculum: %d %v", code, cur)
	}
	sems := list(cur["semesters"])
	if len(sems) != 8 || num(sems[0]["number"]) != 1 || num(sems[0]["ects"]) != 27 {
		t.Fatalf("semesters: %v", sems)
	}
	first := list(sems[0]["items"])
	if c := first[0]["course"].(map[string]any); c["code"] != "MAT 101" || c["name"] != "Mathematical analysis 1" {
		t.Fatalf("first course: %v", first[0])
	}
	slot := first[6]
	opts := list(slot["options"])
	if slot["kind"] != "NAE" || slot["label"] != "Foreign language 1" || len(opts) != 2 || opts[1]["name"] != "Foreign Language 1 (English for Academic Purposes - B2 level)" {
		t.Fatalf("slot: %v", slot)
	}
	if len(list(cur["electives"].(map[string]any)["AE"])) != 9 {
		t.Fatalf("AE list: %v", cur["electives"])
	}
	for _, bad := range []string{"/api/curriculum", "/api/curriculum?program=abc", "/api/curriculum?program=10101&year=1"} {
		if code, _ := e.call(student, http.MethodGet, bad, nil); code != http.StatusBadRequest {
			t.Fatalf("%s: %d, want 400", bad, code)
		}
	}
	if code, _ := e.call(student, http.MethodGet, "/api/curriculum?program=10101&year=2001", nil); code != http.StatusNotFound {
		t.Fatalf("a year not imported: %d, want 404", code)
	}

	// Search by code (any spacing), by name, cleaned look-alike letters, a typo.
	for q, want := range map[string]string{"mat101": "MAT 101", "MAT 10": "MAT 101", "economy": "MDE 161", "linear algebar": "MAT 123", "machine": "CSS 324"} {
		_, res := e.call(student, http.MethodGet, "/api/courses?q="+url.QueryEscape(q), nil)
		got := list(res["courses"])
		if len(got) == 0 || got[0]["code"] != want {
			t.Fatalf("search %q: %v, want %s first", q, got, want)
		}
	}
	if code, _ := e.call(student, http.MethodGet, "/api/courses?q=", nil); code != http.StatusBadRequest {
		t.Fatalf("empty search: %d", code)
	}

	// Course cards: where a course is taught.
	_, mat101 := e.call(student, http.MethodGet, "/api/courses/MAT-101", nil)
	places := list(mat101["places"])
	if len(places) == 0 || places[0]["program_code"] != "10101" || num(places[0]["semester"]) != 1 || places[0]["kind"] != "" {
		t.Fatalf("MAT 101 places: %v", mat101)
	}
	_, mat127 := e.call(student, http.MethodGet, "/api/courses/mat127", nil)
	if p := list(mat127["places"]); len(p) != 1 || num(p[0]["semester"]) != 5 || p[0]["kind"] != "AE" || p[0]["label"] != "Elective 2" {
		t.Fatalf("an elective option: %v", mat127["places"])
	}
	_, mde001 := e.call(student, http.MethodGet, "/api/courses/MDE%20001", nil)
	if p := list(mde001["places"]); len(p) != 1 || num(p[0]["semester"]) != 0 || p[0]["kind"] != "RC" {
		t.Fatalf("only in an elective list: %v", mde001["places"])
	}
	for _, bad := range []string{"/api/courses/XXX-1XX", "/api/courses/ZZZ-999"} {
		if code, _ := e.call(student, http.MethodGet, bad, nil); code != http.StatusNotFound {
			t.Fatalf("%s: %d, want 404", bad, code)
		}
	}

	// Descriptions: staff only; kept when the curriculum is imported again.
	desc := map[string]any{"description": "Limits and derivatives.", "description_kz": "Шектер мен туындылар.", "description_ru": "Пределы и производные."}
	if code, _ := e.call(student, http.MethodPut, "/api/admin/courses/MAT-101", desc); code != http.StatusForbidden {
		t.Fatalf("a student edits a course: %d, want 403", code)
	}
	if code, out := e.call(admin, http.MethodPut, "/api/admin/courses/MAT-101", desc); code != http.StatusOK || out["description_kz"] != "Шектер мен туындылар." {
		t.Fatalf("description: %d %v", code, out)
	}
	e.call(admin, http.MethodPost, "/api/admin/curricula", map[string]any{"text": text})
	if _, again := e.call(student, http.MethodGet, "/api/courses/MAT-101", nil); again["description_ru"] != "Пределы и производные." {
		t.Fatalf("the description was lost on re-import: %v", again)
	}

	// Delete: the curriculum goes, the courses stay.
	path := fmt.Sprintf("/api/admin/curricula/%d", num(info["id"]))
	if code, _ := e.call(student, http.MethodDelete, path, nil); code != http.StatusForbidden {
		t.Fatalf("a student deletes: %d", code)
	}
	if code, _ := e.call(admin, http.MethodDelete, path, nil); code != http.StatusNoContent {
		t.Fatalf("delete: %d", code)
	}
	if code, _ := e.call(student, http.MethodGet, "/api/curriculum?program=10101", nil); code != http.StatusNotFound {
		t.Fatalf("after delete: %d, want 404", code)
	}
	if code, _ := e.call(student, http.MethodGet, "/api/courses/MAT-101", nil); code != http.StatusOK {
		t.Fatalf("the course should stay: %d", code)
	}
}

func TestMyProgram(t *testing.T) {
	e := newCoursesEnv(t)
	student := e.user("user")
	if _, out := e.call(student, http.MethodGet, "/api/me/program", nil); out["program"] != nil {
		t.Fatalf("not chosen yet: %v", out)
	}
	for _, bad := range []map[string]any{
		{"program_code": "99999", "entry_year": 2025},
		{"program_code": "abc", "entry_year": 2025},
		{"program_code": "10107", "entry_year": 1990},
		{"program_code": "10107", "entry_year": time.Now().Year() + 1},
	} {
		if code, _ := e.call(student, http.MethodPut, "/api/me/program", bad); code != http.StatusBadRequest {
			t.Fatalf("%v: %d, want 400", bad, code)
		}
	}
	if code, out := e.call(student, http.MethodPut, "/api/me/program", map[string]any{"program_code": "10107", "entry_year": 2025}); code != http.StatusOK {
		t.Fatalf("set: %d %v", code, out)
	}
	_, out := e.call(student, http.MethodGet, "/api/me/program", nil)
	if p, _ := out["program"].(map[string]any); p == nil || p["program_code"] != "10107" || num(p["entry_year"]) != 2025 {
		t.Fatalf("get: %v", out)
	}
}
