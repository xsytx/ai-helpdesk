package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"campus-forum/internal/middleware"
)

// Campus map points: students read, admins edit. Real database, skipped
// without TEST_DATABASE_URL.

func newMapPointsEnv(t *testing.T) *modEnv {
	t.Helper()
	e := newModEnv(t)
	authMw := middleware.Auth(e.secret)
	mux := http.NewServeMux()
	mux.Handle("GET /api/map/points", authMw(http.HandlerFunc(e.h.ListMapPoints)))
	mux.Handle("POST /api/admin/map/points", authMw(http.HandlerFunc(e.h.CreateMapPoint)))
	mux.Handle("PUT /api/admin/map/points/{id}", authMw(http.HandlerFunc(e.h.UpdateMapPoint)))
	mux.Handle("DELETE /api/admin/map/points/{id}", authMw(http.HandlerFunc(e.h.DeleteMapPoint)))
	e.srv.Close()
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

func findPoint(list map[string]any, id any) map[string]any {
	for _, p := range list["points"].([]any) {
		if m := p.(map[string]any); m["id"] == id {
			return m
		}
	}
	return nil
}

func TestMapPoints(t *testing.T) {
	e := newMapPointsEnv(t)
	student, admin := e.user("user"), e.user("admin")

	// The seed is loaded on migration: the list is never empty.
	code, list := e.call(student, http.MethodGet, "/api/map/points", nil)
	if code != http.StatusOK || len(list["points"].([]any)) == 0 {
		t.Fatalf("list: %d %v", code, list)
	}

	point := map[string]any{"code": "Z901", "name": "Test room", "type": "room", "floor": "2", "x": 1200, "y": 900, "place": ""}
	if code, _ := e.call(student, http.MethodPost, "/api/admin/map/points", point); code != http.StatusForbidden {
		t.Fatalf("a student adding a point: %d, want 403", code)
	}
	code, created := e.call(admin, http.MethodPost, "/api/admin/map/points", point)
	if code != http.StatusCreated || created["code"] != "Z901" || created["floor"] != "2" {
		t.Fatalf("create: %d %v", code, created)
	}
	id := created["id"]
	t.Cleanup(func() { e.call(admin, http.MethodDelete, fmt.Sprintf("/api/admin/map/points/%v", id), nil) })

	// The same code twice (any letter case) is refused.
	dup := map[string]any{"code": "z901", "type": "room", "floor": "1", "x": 10, "y": 10}
	if code, _ := e.call(admin, http.MethodPost, "/api/admin/map/points", dup); code != http.StatusConflict {
		t.Fatalf("duplicate code: %d, want 409", code)
	}
	for _, bad := range []map[string]any{
		{"type": "castle", "floor": "1", "x": 10, "y": 10},
		{"type": "room", "floor": "9", "x": 10, "y": 10},
		{"type": "room", "floor": "1", "x": -5, "y": 10},
		{"type": "room", "floor": "1", "x": 10, "y": 10, "place": "drop table"},
	} {
		if code, _ := e.call(admin, http.MethodPost, "/api/admin/map/points", bad); code != http.StatusBadRequest {
			t.Fatalf("bad point %v: %d, want 400", bad, code)
		}
	}

	// An admin moves it: the student's list shows the new position.
	moved := map[string]any{"code": "Z901", "name": "Test room", "type": "lab", "floor": "3B", "x": 1300, "y": 950, "place": "library"}
	code, upd := e.call(admin, http.MethodPut, fmt.Sprintf("/api/admin/map/points/%v", id), moved)
	if code != http.StatusOK || upd["type"] != "lab" || upd["floor"] != "3B" || upd["place"] != "LIBRARY" {
		t.Fatalf("update: %d %v", code, upd)
	}
	_, list = e.call(student, http.MethodGet, "/api/map/points", nil)
	if p := findPoint(list, id); p == nil || p["x"] != float64(1300) || p["y"] != float64(950) {
		t.Fatalf("student sees %v, want the moved point", p)
	}

	if code, _ := e.call(student, http.MethodDelete, fmt.Sprintf("/api/admin/map/points/%v", id), nil); code != http.StatusForbidden {
		t.Fatalf("a student deleting: %d, want 403", code)
	}
	if code, _ := e.call(admin, http.MethodDelete, fmt.Sprintf("/api/admin/map/points/%v", id), nil); code != http.StatusNoContent {
		t.Fatalf("delete: %d", code)
	}
	if code, _ := e.call(admin, http.MethodDelete, fmt.Sprintf("/api/admin/map/points/%v", id), nil); code != http.StatusNotFound {
		t.Fatalf("delete again: %d, want 404", code)
	}
}
