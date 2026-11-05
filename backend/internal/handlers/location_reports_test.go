package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"campus-forum/internal/middleware"
)

// "Report a mistake" on the campus navigation page. Real database, skipped
// without TEST_DATABASE_URL.

func newLocationReportEnv(t *testing.T) *modEnv {
	t.Helper()
	e := newModEnv(t)
	authMw := middleware.Auth(e.secret)
	mux := http.NewServeMux()
	mux.Handle("POST /api/location-reports", authMw(http.HandlerFunc(e.h.CreateLocationReport)))
	mux.Handle("GET /api/admin/location-reports", authMw(http.HandlerFunc(e.h.ListLocationReports)))
	mux.Handle("PATCH /api/admin/location-reports/{id}", authMw(http.HandlerFunc(e.h.SetLocationReportStatus)))
	e.srv.Close()
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

func TestLocationReports(t *testing.T) {
	e := newLocationReportEnv(t)
	student, other, admin := e.user("user"), e.user("user"), e.user("admin")
	report := func(u modUser, body map[string]any) (int, map[string]any) {
		return e.call(u, http.MethodPost, "/api/location-reports", body)
	}
	good := map[string]any{"place_code": "hall_b", "place_name": "Lecture hall “Bochka B”", "entrance": "G", "text": "The route goes through a locked door"}

	code, rep := report(student, good)
	if code != http.StatusCreated || rep["place_code"] != "HALL_B" || rep["status"] != "open" || rep["reporter_name"] == "" {
		t.Fatalf("report: %d %v", code, rep)
	}
	if code, _ := report(student, good); code != http.StatusConflict {
		t.Fatalf("second open report about the same place: %d, want 409", code)
	}
	if code, _ := report(other, good); code != http.StatusCreated {
		t.Fatalf("another student about the same place: %d", code)
	}
	for _, bad := range []map[string]any{
		{"place_code": "drop table", "text": "Wrong place on the map"},
		{"place_code": "BLOCK_F", "entrance": "X", "text": "Wrong place on the map"},
		{"place_code": "BLOCK_F", "text": "bad"},
	} {
		if code, _ := report(student, bad); code != http.StatusBadRequest {
			t.Fatalf("bad report %v: %d, want 400", bad, code)
		}
	}

	if code, _ := e.call(student, http.MethodGet, "/api/admin/location-reports", nil); code != http.StatusForbidden {
		t.Fatalf("a student listing reports: %d, want 403", code)
	}
	_, list := e.call(admin, http.MethodGet, "/api/admin/location-reports?status=open", nil)
	found := false
	for _, x := range list["reports"].([]any) {
		if m := x.(map[string]any); num(m["id"]) == num(rep["id"]) {
			found = m["text"] == good["text"] && m["entrance"] == "G"
		}
	}
	if !found {
		t.Fatalf("admin list: %v", list)
	}

	path := fmt.Sprintf("/api/admin/location-reports/%d", num(rep["id"]))
	if code, _ := e.call(student, http.MethodPatch, path, map[string]any{"status": "fixed"}); code != http.StatusForbidden {
		t.Fatalf("a student closing a report: %d, want 403", code)
	}
	if code, out := e.call(admin, http.MethodPatch, path, map[string]any{"status": "fixed"}); code != http.StatusOK || out["status"] != "fixed" || out["resolved_at"] == nil {
		t.Fatalf("fix: %d %v", code, out)
	}
	if code, _ := e.call(admin, http.MethodPatch, path, map[string]any{"status": "done"}); code != http.StatusBadRequest {
		t.Fatalf("unknown status: %d, want 400", code)
	}
	// Once fixed, the student may report the place again.
	if code, _ := report(student, good); code != http.StatusCreated {
		t.Fatalf("reporting again after the fix: %d", code)
	}
}
