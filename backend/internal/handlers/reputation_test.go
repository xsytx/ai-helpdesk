package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Reputation, top helpers and photos on questions. Real database, skipped
// without TEST_DATABASE_URL.

func TestReputationPointsLevelsAndTopHelpers(t *testing.T) {
	e := newForumEnv(t)
	asker, helper, liker := e.user("user"), e.user("user"), e.user("user")
	tid := e.newThread(asker, "How do I get a dorm room?", "Where do I apply for the dormitory")
	cid := e.newAnswer(helper, tid, "Apply at the Student Service Center.")

	if code, _ := e.call(liker, http.MethodPost, fmt.Sprintf("/api/comments/%d/vote", cid), map[string]any{"value": 1}); code != http.StatusOK {
		t.Fatalf("like: %d", code)
	}
	// Liking your own answer earns nothing.
	e.call(helper, http.MethodPost, fmt.Sprintf("/api/comments/%d/vote", cid), map[string]any{"value": 1})
	if code, _ := e.call(asker, http.MethodPost, fmt.Sprintf("/api/threads/%d/accept", tid), map[string]any{"comment_id": cid}); code != http.StatusNoContent {
		t.Fatalf("accept: %d", code)
	}
	// Answering and accepting your own question: the answer counts, the solution doesn't.
	own := e.newAnswer(asker, tid, "Thanks, found it.")
	_ = own

	_, me := e.call(helper, http.MethodGet, "/api/me/reputation", nil)
	// 1 answer + 1 like from someone else + 1 solution = 1 + 2 + 10.
	if num(me["points"]) != 13 || num(me["solutions"]) != 1 || num(me["likes"]) != 1 || me["level"] != "helper" || num(me["next_level_at"]) != 50 {
		t.Fatalf("helper reputation %v", me)
	}
	_, a := e.call(asker, http.MethodGet, "/api/me/reputation", nil)
	if num(a["points"]) != 1 || a["level"] != "newcomer" {
		t.Fatalf("asker reputation %v", a)
	}

	// The question page carries everyone's level.
	_, page := e.call(liker, http.MethodGet, fmt.Sprintf("/api/threads/%d", tid), nil)
	rep := page["reputation"].(map[string]any)
	if r := rep[fmt.Sprint(helper.id)].(map[string]any); num(r["points"]) != 13 {
		t.Fatalf("reputation on the page %v", rep)
	}

	_, board := e.call(liker, http.MethodGet, "/api/leaderboard?period=week&limit=20", nil)
	found := false
	for _, h := range board["helpers"].([]any) {
		m := h.(map[string]any)
		if num(m["user_id"]) == helper.id {
			found = num(m["points"]) == 13 && m["level"] == "helper" && m["name"] == helper.name
		}
		if num(m["user_id"]) == liker.id {
			t.Fatal("someone with no points must not be listed")
		}
	}
	if !found {
		t.Fatalf("helper missing from top helpers: %v", board)
	}

	// Taking the solution back takes its points back.
	e.call(asker, http.MethodPost, fmt.Sprintf("/api/threads/%d/accept", tid), map[string]any{"comment_id": nil})
	if _, me := e.call(helper, http.MethodGet, "/api/me/reputation", nil); num(me["points"]) != 3 {
		t.Fatalf("after unaccept %v", me)
	}
}

func (e *modEnv) upload(u modUser, threadID int64, content []byte) (int, map[string]any) {
	e.t.Helper()
	return e.uploadTo(u, fmt.Sprintf("/api/threads/%d/attachments", threadID), content)
}

func (e *modEnv) uploadTo(u modUser, path string, content []byte) (int, map[string]any) {
	e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
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

func TestQuestionPhotos(t *testing.T) {
	e := newForumEnv(t)
	author, other := e.user("user"), e.user("user")
	tid := e.newThread(author, "Where is this room?", "See the photo please")
	png := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)

	if code, _ := e.upload(other, tid, png); code != http.StatusForbidden {
		t.Fatalf("someone else adds a photo: %d, want 403", code)
	}
	if code, _ := e.upload(author, tid, []byte("not an image at all")); code != http.StatusBadRequest {
		t.Fatalf("not an image: %d, want 400", code)
	}
	var first map[string]any
	for i := 0; i < maxAttachmentsPerThread; i++ {
		code, out := e.upload(author, tid, png)
		if code != http.StatusCreated {
			t.Fatalf("photo %d: %d %v", i+1, code, out)
		}
		if i == 0 {
			first = out
		}
	}
	if code, _ := e.upload(author, tid, png); code != http.StatusConflict {
		t.Fatalf("photo over the limit: %d, want 409", code)
	}
	_, page := e.call(other, http.MethodGet, fmt.Sprintf("/api/threads/%d", tid), nil)
	if atts := page["thread"].(map[string]any)["attachments"].([]any); len(atts) != maxAttachmentsPerThread {
		t.Fatalf("photos on the page: %v", atts)
	}

	// Lists carry the count and the first 3 photos to preview.
	_, feed := e.call(other, http.MethodGet, "/api/feed?sort=new&page_size=50", nil)
	found := false
	for _, th := range feed["threads"].([]any) {
		m := th.(map[string]any)
		if num(m["id"]) == tid {
			found = true
			if num(m["photo_count"]) != maxAttachmentsPerThread || len(m["preview_photos"].([]any)) != 3 {
				t.Fatalf("list photos: count %v, previews %v", m["photo_count"], m["preview_photos"])
			}
		}
	}
	if !found {
		t.Fatal("question missing from the feed")
	}

	path := fmt.Sprintf("/api/attachments/%d", num(first["id"]))
	if code, _ := e.call(other, http.MethodDelete, path, nil); code != http.StatusForbidden {
		t.Fatalf("someone else deletes a photo: %d, want 403", code)
	}
	file := filepath.Join(e.h.UploadDir, filepath.FromSlash(strings.TrimPrefix(first["url"].(string), "/uploads/")))
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("uploaded file missing: %v", err)
	}
	if code, _ := e.call(author, http.MethodDelete, path, nil); code != http.StatusNoContent {
		t.Fatalf("author deletes a photo: %d", code)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatalf("file should be gone: %v", err)
	}
	if code, _ := e.upload(author, tid, png); code != http.StatusCreated {
		t.Fatalf("after deleting one, another photo fits again: %d", code)
	}
}
