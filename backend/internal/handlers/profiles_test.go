package handlers

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Avatars on the server, public profiles, photos in answers. Real database,
// skipped without TEST_DATABASE_URL.

var testPNG = append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)

func (e *modEnv) uploadedFile(url string) string {
	return filepath.Join(e.h.UploadDir, filepath.FromSlash(strings.TrimPrefix(url, "/uploads/")))
}

func TestAvatarsOnTheServer(t *testing.T) {
	e := newForumEnv(t)
	u, other := e.user("user"), e.user("user")

	if code, out := e.call(u, http.MethodPut, "/api/me/avatar", map[string]any{"avatar": "avatar3"}); code != http.StatusOK || out["avatar"] != "avatar3" {
		t.Fatalf("preset: %d %v", code, out)
	}
	for _, bad := range []string{"../../etc/passwd", "avatar100", "https://evil.example/x.png"} {
		if code, _ := e.call(u, http.MethodPut, "/api/me/avatar", map[string]any{"avatar": bad}); code != http.StatusBadRequest {
			t.Fatalf("avatar %q: %d, want 400", bad, code)
		}
	}
	code, out := e.uploadTo(u, "/api/me/avatar", testPNG)
	first, _ := out["avatar"].(string)
	if code != http.StatusOK || !strings.HasPrefix(first, fmt.Sprintf("/uploads/avatars/%d/", u.id)) {
		t.Fatalf("upload: %d %v", code, out)
	}
	if _, err := os.Stat(e.uploadedFile(first)); err != nil {
		t.Fatalf("avatar file missing: %v", err)
	}
	_, out = e.uploadTo(u, "/api/me/avatar", testPNG)
	second := out["avatar"].(string)
	if _, err := os.Stat(e.uploadedFile(first)); !os.IsNotExist(err) {
		t.Fatal("the replaced photo must be deleted")
	}
	if _, me := e.call(u, http.MethodGet, "/api/me", nil); me["avatar"] != second {
		t.Fatalf("/api/me avatar %v", me["avatar"])
	}

	// Everyone sees it next to the author's posts.
	tid := e.newThread(u, "Avatar visible to others", "Checking the author avatar")
	e.newAnswer(u, tid, "My own answer here")
	_, page := e.call(other, http.MethodGet, fmt.Sprintf("/api/threads/%d", tid), nil)
	if page["thread"].(map[string]any)["author_avatar"] != second ||
		page["comments"].([]any)[0].(map[string]any)["author_avatar"] != second {
		t.Fatalf("author avatar on the page: %v", page)
	}

	// Back to initials: the uploaded file goes too.
	e.call(u, http.MethodPut, "/api/me/avatar", map[string]any{"avatar": ""})
	if _, err := os.Stat(e.uploadedFile(second)); !os.IsNotExist(err) {
		t.Fatal("removing the avatar must delete its photo")
	}
}

func TestPublicProfile(t *testing.T) {
	e := newForumEnv(t)
	u, asker, visitor := e.user("user"), e.user("user"), e.user("user")
	e.newThread(u, "My first question here", "Some body text here")
	tid := e.newThread(asker, "Question for the profile", "Some body text here")
	cid := e.newAnswer(u, tid, "A helpful answer")
	e.call(asker, http.MethodPost, fmt.Sprintf("/api/threads/%d/accept", tid), map[string]any{"comment_id": cid})

	code, p := e.call(visitor, http.MethodGet, fmt.Sprintf("/api/users/%d", u.id), nil)
	rep, _ := p["reputation"].(map[string]any)
	if code != http.StatusOK || num(p["questions"]) != 1 || p["staff"] != false || rep == nil || num(rep["points"]) != 11 || num(rep["solutions"]) != 1 {
		t.Fatalf("profile: %d %v", code, p)
	}
	if _, leaked := p["email"]; leaked {
		t.Fatal("a public profile must not show the email")
	}
	_, answers := e.call(visitor, http.MethodGet, fmt.Sprintf("/api/users/%d/comments", u.id), nil)
	if list := answers["comments"].([]any); len(list) != 1 || list[0].(map[string]any)["is_solution"] != true {
		t.Fatalf("answers on the profile: %v", answers)
	}
}

func TestAnswerPhotos(t *testing.T) {
	e := newForumEnv(t)
	asker, answerer := e.user("user"), e.user("user")
	tid := e.newThread(asker, "Where is room D116?", "Looking for the room")
	cid := e.newAnswer(answerer, tid, "Here, see the photo")
	path := fmt.Sprintf("/api/comments/%d/attachments", cid)

	if code, _ := e.uploadTo(asker, path, testPNG); code != http.StatusForbidden {
		t.Fatalf("someone else adds a photo to the answer: %d, want 403", code)
	}
	var firstID int64
	for i := 0; i < maxAttachmentsPerAnswer; i++ {
		code, out := e.uploadTo(answerer, path, testPNG)
		if code != http.StatusCreated {
			t.Fatalf("answer photo %d: %d %v", i+1, code, out)
		}
		if i == 0 {
			firstID = num(out["id"])
		}
	}
	if code, _ := e.uploadTo(answerer, path, testPNG); code != http.StatusConflict {
		t.Fatalf("photo over the limit: %d, want 409", code)
	}

	_, page := e.call(asker, http.MethodGet, fmt.Sprintf("/api/threads/%d", tid), nil)
	if atts, _ := page["thread"].(map[string]any)["attachments"].([]any); len(atts) != 0 {
		t.Fatalf("answer photos must not show as question photos: %v", atts)
	}
	if atts := page["comments"].([]any)[0].(map[string]any)["attachments"].([]any); len(atts) != maxAttachmentsPerAnswer {
		t.Fatalf("answer photos: %v", atts)
	}

	del := fmt.Sprintf("/api/attachments/%d", firstID)
	if code, _ := e.call(asker, http.MethodDelete, del, nil); code != http.StatusForbidden {
		t.Fatalf("the question's author deletes an answer photo: %d, want 403", code)
	}
	if code, _ := e.call(answerer, http.MethodDelete, del, nil); code != http.StatusNoContent {
		t.Fatalf("the answer's author deletes its photo: %d", code)
	}
}
