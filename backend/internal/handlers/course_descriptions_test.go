package handlers

import (
	"net/http"
	"testing"

	"campus-forum/internal/middleware"
)

// Admin panel → Courses → courses without descriptions: taught courses only,
// none-at-all first, the missing languages named, staff only.
// Real database, skipped without TEST_DATABASE_URL.
func TestCoursesMissingDescriptions(t *testing.T) {
	e := newReviewsEnv(t)
	authMw := middleware.Auth(e.secret)
	mux := e.srv.Config.Handler.(*http.ServeMux)
	mux.Handle("GET /api/admin/courses/missing-descriptions", authMw(http.HandlerFunc(e.h.CoursesMissingDescriptions)))
	mux.Handle("PUT /api/admin/courses/{code}", authMw(http.HandlerFunc(e.h.UpdateCourse)))

	admin := e.user("admin")
	if code, out := e.call(admin, http.MethodPost, "/api/admin/curricula", map[string]any{"text": sampleCurriculum(t)}); code != http.StatusCreated {
		t.Fatalf("import: %d %v", code, out)
	}
	describe := func(code, en, kz, ru string) {
		t.Helper()
		if status, out := e.call(admin, http.MethodPut, "/api/admin/courses/"+code,
			map[string]any{"description": en, "description_kz": kz, "description_ru": ru}); status != http.StatusOK {
			t.Fatalf("describe %s: %d %v", code, status, out)
		}
	}
	describe("MAT-101", "Limits and derivatives.", "Шектер мен туындылар.", "Пределы и производные.")
	describe("MAT-106", "Computers and networks.", "", "")
	describe("MAT-141", "", "", "")

	if status, _ := e.call(e.user("user"), http.MethodGet, "/api/admin/courses/missing-descriptions", nil); status != http.StatusForbidden {
		t.Fatalf("a student got %d", status)
	}
	status, out := e.call(admin, http.MethodGet, "/api/admin/courses/missing-descriptions", nil)
	if status != http.StatusOK {
		t.Fatalf("list: %d %v", status, out)
	}
	courses := list(out["courses"])
	if num(out["used"]) < 10 || len(courses) == 0 || len(courses) >= int(num(out["used"])) {
		t.Fatalf("used %v, missing %d", out["used"], len(courses))
	}
	at := map[string]int{}
	for i, c := range courses {
		at[c["code"].(string)] = i
		if num(c["programs"]) < 1 {
			t.Fatalf("not counted as taught: %v", c)
		}
	}
	if _, listed := at["MAT 101"]; listed {
		t.Fatal("a course described in all three languages is listed")
	}
	partial, ok := at["MAT 106"]
	if missing := list2(courses[partial]["missing"]); !ok || len(missing) != 2 || missing[0] != "kz" {
		t.Fatalf("partly described: %v", courses[partial])
	}
	if none, ok := at["MAT 141"]; !ok || none > partial || len(list2(courses[none]["missing"])) != 3 {
		t.Fatalf("none at all should come before partly described: %v", courses)
	}
}

func list2(v any) []string {
	var out []string
	if a, ok := v.([]any); ok {
		for _, x := range a {
			out = append(out, x.(string))
		}
	}
	return out
}
