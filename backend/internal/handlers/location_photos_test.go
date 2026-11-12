package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"campus-forum/internal/middleware"
)

// Photos of campus places. Real database, skipped without TEST_DATABASE_URL.

func newLocationPhotoEnv(t *testing.T) *modEnv {
	t.Helper()
	e := newModEnv(t)
	authMw := middleware.Auth(e.secret)
	mux := http.NewServeMux()
	mux.Handle("POST /api/location-reports", authMw(http.HandlerFunc(e.h.CreateLocationReport)))
	mux.Handle("PATCH /api/admin/location-reports/{id}", authMw(http.HandlerFunc(e.h.SetLocationReportStatus)))
	mux.Handle("GET /api/admin/location-reports", authMw(http.HandlerFunc(e.h.ListLocationReports)))
	mux.Handle("GET /api/map/photos", authMw(http.HandlerFunc(e.h.ListLocationPhotos)))
	mux.Handle("POST /api/location-reports/{id}/photo", authMw(http.HandlerFunc(e.h.UploadReportPhoto)))
	mux.Handle("POST /api/location-photos", authMw(http.HandlerFunc(e.h.SuggestLocationPhoto)))
	mux.Handle("GET /api/admin/map/photos/suggestions", authMw(http.HandlerFunc(e.h.ListPhotoSuggestions)))
	mux.Handle("POST /api/admin/map/photos", authMw(http.HandlerFunc(e.h.UploadLocationPhoto)))
	mux.Handle("PUT /api/admin/map/photos/order", authMw(http.HandlerFunc(e.h.ReorderLocationPhotos)))
	mux.Handle("PATCH /api/admin/map/photos/{id}", authMw(http.HandlerFunc(e.h.UpdateLocationPhoto)))
	mux.Handle("DELETE /api/admin/map/photos/{id}", authMw(http.HandlerFunc(e.h.DeleteLocationPhoto)))
	mux.Handle("POST /api/admin/map/photos/{id}/approve", authMw(http.HandlerFunc(e.h.ApproveLocationPhoto)))
	e.srv.Close()
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

// uploadForm posts a multipart form with a "file" and extra text fields.
func (e *modEnv) uploadForm(u modUser, path string, content []byte, fields map[string]string) (int, map[string]any) {
	e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		mw.WriteField(k, v)
	}
	fw, _ := mw.CreateFormFile("file", "photo.png")
	fw.Write(content)
	mw.Close()
	req, _ := http.NewRequest(http.MethodPost, e.srv.URL+path, &buf)
	req.Header.Set("Authorization", "Bearer "+u.token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out
}

func (e *modEnv) placePhotos(u modUser, codes string) []map[string]any {
	e.t.Helper()
	code, out := e.call(u, http.MethodGet, "/api/map/photos?codes="+codes, nil)
	if code != http.StatusOK {
		e.t.Fatalf("list photos %s: %d %v", codes, code, out)
	}
	var list []map[string]any
	for _, p := range out["photos"].([]any) {
		list = append(list, p.(map[string]any))
	}
	return list
}

// A fresh place code per run: the test database keeps earlier runs' rows.
func testPlaceCode(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}

func TestLocationPhotoGallery(t *testing.T) {
	e := newLocationPhotoEnv(t)
	student, admin := e.user("user"), e.user("admin")
	place := testPlaceCode("T_GAL")
	up := func(u modUser, fields map[string]string) (int, map[string]any) {
		return e.uploadForm(u, "/api/admin/map/photos", testPNG, fields)
	}

	if code, _ := up(student, map[string]string{"place_code": place}); code != http.StatusForbidden {
		t.Fatalf("a student uploads to the gallery: %d, want 403", code)
	}
	if code, _ := up(admin, map[string]string{"place_code": "no spaces allowed"}); code != http.StatusBadRequest {
		t.Fatalf("bad place code: %d, want 400", code)
	}
	if code, _ := up(admin, map[string]string{"place_code": place, "caption": strings.Repeat("я", maxLocationPhotoCaption+1)}); code != http.StatusBadRequest {
		t.Fatalf("long caption: %d, want 400", code)
	}
	if code, _ := e.uploadForm(admin, "/api/admin/map/photos", []byte("not an image"), map[string]string{"place_code": place}); code != http.StatusBadRequest {
		t.Fatalf("not an image: %d, want 400", code)
	}

	var ids []int64
	var first map[string]any
	for i := 0; i < 3; i++ {
		code, out := up(admin, map[string]string{"place_code": strings.ToLower(place), "caption": fmt.Sprintf("  Вход %d  ", i)})
		if code != http.StatusCreated || out["place_code"] != place || out["caption"] != fmt.Sprintf("Вход %d", i) || out["status"] != "approved" {
			t.Fatalf("upload %d: %d %v", i, code, out)
		}
		if i == 0 {
			first = out
		}
		ids = append(ids, num(out["id"]))
	}
	if _, err := os.Stat(e.uploadedFile(first["url"].(string))); err != nil {
		t.Fatalf("uploaded file missing: %v", err)
	}

	// Students see the gallery in upload order.
	list := e.placePhotos(student, place)
	if len(list) != 3 || num(list[0]["id"]) != ids[0] || num(list[2]["id"]) != ids[2] {
		t.Fatalf("gallery: %v", list)
	}
	if _, leaked := list[0]["uploaded_by"]; leaked {
		t.Fatalf("the uploader's id is shown to students: %v", list[0])
	}
	for _, bad := range []string{"", "a,b%20c", strings.Repeat("AB,", maxPhotoCodesPerRequest+1)} {
		if code, _ := e.call(student, http.MethodGet, "/api/map/photos?codes="+bad, nil); code != http.StatusBadRequest {
			t.Fatalf("codes %q: %d, want 400", bad, code)
		}
	}

	// Caption.
	path := fmt.Sprintf("/api/admin/map/photos/%d", ids[1])
	if code, _ := e.call(student, http.MethodPatch, path, map[string]any{"caption": "x"}); code != http.StatusForbidden {
		t.Fatalf("a student edits a caption: %d, want 403", code)
	}
	if code, out := e.call(admin, http.MethodPatch, path, map[string]any{"caption": "Bochka from the hall"}); code != http.StatusOK || out["caption"] != "Bochka from the hall" {
		t.Fatalf("caption: %d %v", code, out)
	}

	// Order: every photo once, or 400.
	order := func(ids []int64) int {
		code, _ := e.call(admin, http.MethodPut, "/api/admin/map/photos/order", map[string]any{"place_code": place, "ids": ids})
		return code
	}
	for _, bad := range [][]int64{{ids[0], ids[1]}, {ids[0], ids[1], ids[1]}, {ids[0], ids[1], 999999999}} {
		if code := order(bad); code != http.StatusBadRequest {
			t.Fatalf("order %v: %d, want 400", bad, code)
		}
	}
	if code := order([]int64{ids[2], ids[0], ids[1]}); code != http.StatusOK {
		t.Fatalf("order: %d", code)
	}
	if list := e.placePhotos(student, place); num(list[0]["id"]) != ids[2] || num(list[1]["id"]) != ids[0] || list[2]["caption"] != "Bochka from the hall" {
		t.Fatalf("after reorder: %v", list)
	}

	// The limit per place.
	for i := 3; i < maxLocationPhotos; i++ {
		if code, out := up(admin, map[string]string{"place_code": place}); code != http.StatusCreated {
			t.Fatalf("photo %d: %d %v", i+1, code, out)
		}
	}
	if code, _ := up(admin, map[string]string{"place_code": place}); code != http.StatusConflict {
		t.Fatalf("photo over the limit: %d, want 409", code)
	}

	// Delete removes the file too.
	del := fmt.Sprintf("/api/admin/map/photos/%d", ids[0])
	if code, _ := e.call(student, http.MethodDelete, del, nil); code != http.StatusForbidden {
		t.Fatalf("a student deletes a photo: %d, want 403", code)
	}
	if code, _ := e.call(admin, http.MethodDelete, del, nil); code != http.StatusNoContent {
		t.Fatalf("delete: %d", code)
	}
	if _, err := os.Stat(e.uploadedFile(first["url"].(string))); !os.IsNotExist(err) {
		t.Fatalf("file should be gone: %v", err)
	}
	if code, _ := e.call(admin, http.MethodDelete, del, nil); code != http.StatusNotFound {
		t.Fatalf("delete twice: %d, want 404", code)
	}
	if n := len(e.placePhotos(student, place)); n != maxLocationPhotos-1 {
		t.Fatalf("photos after delete: %d", n)
	}
}

func TestReportPhotoApprovedIntoGallery(t *testing.T) {
	e := newLocationPhotoEnv(t)
	student, other, admin := e.user("user"), e.user("user"), e.user("admin")
	place := testPlaceCode("T_REP")

	code, rep := e.call(student, http.MethodPost, "/api/location-reports", map[string]any{"place_code": place, "text": "The door on the photo is the real entrance"})
	if code != http.StatusCreated {
		t.Fatalf("report: %d %v", code, rep)
	}
	photoPath := fmt.Sprintf("/api/location-reports/%d/photo", num(rep["id"]))
	if code, _ := e.uploadForm(other, photoPath, testPNG, nil); code != http.StatusForbidden {
		t.Fatalf("someone else's report: %d, want 403", code)
	}
	if code, _ := e.uploadForm(student, "/api/location-reports/999999999/photo", testPNG, nil); code != http.StatusNotFound {
		t.Fatalf("no such report: %d, want 404", code)
	}
	code, photo := e.uploadForm(student, photoPath, testPNG, nil)
	if code != http.StatusCreated || photo["status"] != "pending" || photo["place_code"] != place {
		t.Fatalf("report photo: %d %v", code, photo)
	}
	if code, _ := e.uploadForm(student, photoPath, testPNG, nil); code != http.StatusConflict {
		t.Fatalf("second photo: %d, want 409", code)
	}

	// Waiting: not in the gallery, shown on the report for admins.
	if n := len(e.placePhotos(student, place)); n != 0 {
		t.Fatalf("a pending photo is public: %d", n)
	}
	_, list := e.call(admin, http.MethodGet, "/api/admin/location-reports?status=open", nil)
	found := false
	for _, x := range list["reports"].([]any) {
		m := x.(map[string]any)
		if num(m["id"]) == num(rep["id"]) {
			p, _ := m["photo"].(map[string]any)
			found = p != nil && num(p["id"]) == num(photo["id"]) && p["status"] == "pending" && p["url"] == photo["url"]
		}
	}
	if !found {
		t.Fatalf("the report's photo is missing in the admin list: %v", list)
	}

	approve := fmt.Sprintf("/api/admin/map/photos/%d/approve", num(photo["id"]))
	if code, _ := e.call(student, http.MethodPost, approve, map[string]any{}); code != http.StatusForbidden {
		t.Fatalf("a student approves: %d, want 403", code)
	}
	if code, out := e.call(admin, http.MethodPost, approve, map[string]any{"caption": "Main door"}); code != http.StatusOK || out["status"] != "approved" || out["caption"] != "Main door" {
		t.Fatalf("approve: %d %v", code, out)
	}
	if code, _ := e.call(admin, http.MethodPost, approve, map[string]any{}); code != http.StatusConflict {
		t.Fatalf("approve twice: %d, want 409", code)
	}
	if gallery := e.placePhotos(other, place); len(gallery) != 1 || gallery[0]["caption"] != "Main door" {
		t.Fatalf("gallery after approval: %v", gallery)
	}

	// Closing the report keeps an approved photo; no new photo on a closed report.
	path := fmt.Sprintf("/api/admin/location-reports/%d", num(rep["id"]))
	if code, out := e.call(admin, http.MethodPatch, path, map[string]any{"status": "rejected"}); code != http.StatusOK || out["photo"] == nil {
		t.Fatalf("reject after approval: %d %v", code, out)
	}
	if n := len(e.placePhotos(other, place)); n != 1 {
		t.Fatalf("rejecting the report removed an approved photo: %d", n)
	}
}

func TestRejectedReportDropsItsPhoto(t *testing.T) {
	e := newLocationPhotoEnv(t)
	student, admin := e.user("user"), e.user("admin")
	place := testPlaceCode("T_REJ")

	_, rep := e.call(student, http.MethodPost, "/api/location-reports", map[string]any{"place_code": place, "text": "Wrong place on the plan"})
	code, photo := e.uploadForm(student, fmt.Sprintf("/api/location-reports/%d/photo", num(rep["id"])), testPNG, nil)
	if code != http.StatusCreated {
		t.Fatalf("report photo: %d %v", code, photo)
	}
	file := e.uploadedFile(photo["url"].(string))
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("file missing: %v", err)
	}
	path := fmt.Sprintf("/api/admin/location-reports/%d", num(rep["id"]))
	if code, out := e.call(admin, http.MethodPatch, path, map[string]any{"status": "rejected"}); code != http.StatusOK || out["photo"] != nil {
		t.Fatalf("reject: %d %v", code, out)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatalf("the rejected photo's file should be gone: %v", err)
	}
	if code, _ := e.call(admin, http.MethodPost, fmt.Sprintf("/api/admin/map/photos/%d/approve", num(photo["id"])), map[string]any{}); code != http.StatusNotFound {
		t.Fatalf("approving a deleted photo: %d, want 404", code)
	}
	// A closed report takes no photo.
	if code, _ := e.uploadForm(student, fmt.Sprintf("/api/location-reports/%d/photo", num(rep["id"])), testPNG, nil); code != http.StatusConflict {
		t.Fatalf("photo on a closed report: %d, want 409", code)
	}
}

func TestStudentPhotoSuggestions(t *testing.T) {
	e := newLocationPhotoEnv(t)
	student, other, admin := e.user("user"), e.user("user"), e.user("admin")
	place := testPlaceCode("T_SUG")
	suggest := func(u modUser, code string) (int, map[string]any) {
		return e.uploadForm(u, "/api/location-photos", testPNG, map[string]string{"place_code": code})
	}

	if code, _ := suggest(student, "bad code!"); code != http.StatusBadRequest {
		t.Fatalf("bad place code: %d, want 400", code)
	}
	code, photo := suggest(student, place)
	if code != http.StatusCreated || photo["status"] != "pending" || photo["place_code"] != place {
		t.Fatalf("suggest: %d %v", code, photo)
	}
	if code, _ := suggest(student, place); code != http.StatusConflict {
		t.Fatalf("second waiting photo of the same place: %d, want 409", code)
	}
	if code, _ := suggest(other, place); code != http.StatusCreated {
		t.Fatalf("another student, same place: %d", code)
	}
	if n := len(e.placePhotos(other, place)); n != 0 {
		t.Fatalf("a waiting suggestion is public: %d", n)
	}

	// Admins see them with the student's name; students can't.
	if code, _ := e.call(student, http.MethodGet, "/api/admin/map/photos/suggestions", nil); code != http.StatusForbidden {
		t.Fatalf("a student lists suggestions: %d, want 403", code)
	}
	_, list := e.call(admin, http.MethodGet, "/api/admin/map/photos/suggestions", nil)
	found := false
	for _, x := range list["photos"].([]any) {
		m := x.(map[string]any)
		if num(m["id"]) == num(photo["id"]) {
			found = m["uploader_name"] != "" && m["place_code"] == place
		}
	}
	if !found {
		t.Fatalf("suggestion missing in the admin list: %v", list)
	}

	// Approved: in the gallery, gone from the list; the student may suggest another.
	if code, out := e.call(admin, http.MethodPost, fmt.Sprintf("/api/admin/map/photos/%d/approve", num(photo["id"])), map[string]any{"caption": "Кіреберіс"}); code != http.StatusOK {
		t.Fatalf("approve: %d %v", code, out)
	}
	if g := e.placePhotos(other, place); len(g) != 1 || g[0]["caption"] != "Кіреберіс" {
		t.Fatalf("gallery: %v", g)
	}
	if code, _ := suggest(student, place); code != http.StatusCreated {
		t.Fatalf("suggest again after approval: %d", code)
	}

	// At most maxPendingSuggestions waiting per student.
	for i := 1; i < maxPendingSuggestions; i++ {
		if code, out := suggest(student, fmt.Sprintf("%s_%d", place, i)); code != http.StatusCreated {
			t.Fatalf("suggestion %d: %d %v", i, code, out)
		}
	}
	if code, out := suggest(student, place+"_X"); code != http.StatusTooManyRequests || out["code"] != "too_many_waiting" {
		t.Fatalf("over the waiting limit: %d %v, want 429", code, out)
	}
}

// Limits hold when requests arrive at the same moment.
func TestPhotoLimitsUnderParallelRequests(t *testing.T) {
	e := newLocationPhotoEnv(t)
	student, admin := e.user("user"), e.user("admin")
	place := testPlaceCode("T_PAR")

	parallel := func(n int, do func(i int) int) map[int]int {
		codes := make(chan int, n)
		var wg sync.WaitGroup
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				codes <- do(i)
			}(i)
		}
		wg.Wait()
		close(codes)
		got := map[int]int{}
		for c := range codes {
			got[c]++
		}
		return got
	}

	// 8 suggestions of different places at once: exactly 5 wait, the rest are refused.
	got := parallel(8, func(i int) int {
		code, _ := e.uploadForm(student, "/api/location-photos", testPNG, map[string]string{"place_code": fmt.Sprintf("%s_%d", place, i)})
		return code
	})
	if got[http.StatusCreated] != maxPendingSuggestions || got[http.StatusTooManyRequests] != 8-maxPendingSuggestions {
		t.Fatalf("parallel suggestions: %v", got)
	}

	// A gallery with one free slot: of 4 uploads at once, exactly one gets in.
	for i := 0; i < maxLocationPhotos-1; i++ {
		if code, out := e.uploadForm(admin, "/api/admin/map/photos", testPNG, map[string]string{"place_code": place}); code != http.StatusCreated {
			t.Fatalf("photo %d: %d %v", i+1, code, out)
		}
	}
	got = parallel(4, func(int) int {
		code, _ := e.uploadForm(admin, "/api/admin/map/photos", testPNG, map[string]string{"place_code": place})
		return code
	})
	if got[http.StatusCreated] != 1 || got[http.StatusConflict] != 3 {
		t.Fatalf("parallel uploads into the last slot: %v", got)
	}
	if n := len(e.placePhotos(student, place)); n != maxLocationPhotos {
		t.Fatalf("gallery size: %d, want %d", n, maxLocationPhotos)
	}
}
