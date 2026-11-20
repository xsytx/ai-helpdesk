package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"campus-forum/internal/models"
	"campus-forum/internal/store"
)

// previewStore serves two questions: 1 published, 2 held by moderation.
type previewStore struct{ chatTestStore }

func (s *previewStore) GetThread(_ context.Context, id int64) (models.Thread, error) {
	switch id {
	case 1:
		cid := int64(9)
		return models.Thread{ID: 1, Title: `Where is the <canteen>?`, Body: "Asking @[Aru](u5)\n\n  for a friend",
			ModerationStatus: "ok", Attachments: []models.Attachment{
				{URL: "/uploads/answer.jpg", CommentID: &cid}, {URL: "/uploads/q.jpg"},
			}}, nil
	case 2:
		return models.Thread{ID: 2, Title: "Secret held title", ModerationStatus: "held"}, nil
	}
	return models.Thread{}, store.ErrNotFound
}

func previewGet(t *testing.T, path string) string {
	t.Helper()
	h := &Handlers{Store: &previewStore{}, BaseURL: "https://helpdesk.example"}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/preview/{path...}", h.LinkPreview)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/preview"+path, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("%s: status %d", path, rec.Code)
	}
	return rec.Body.String()
}

func TestLinkPreviewQuestion(t *testing.T) {
	body := previewGet(t, "/forum/1")
	for _, want := range []string{
		`<meta property="og:title" content="Where is the &lt;canteen&gt;?">`,
		`<meta property="og:description" content="Asking @Aru for a friend">`,
		`<meta property="og:image" content="https://helpdesk.example/uploads/q.jpg">`,
		`<meta property="og:url" content="https://helpdesk.example/forum/1">`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %s in\n%s", want, body)
		}
	}
}

func TestLinkPreviewHidesHeldAndUnknown(t *testing.T) {
	for _, path := range []string{"/forum/2", "/forum/77", "/forum/abc", "/shared/nope", "/users/3"} {
		body := previewGet(t, path)
		if strings.Contains(body, "Secret") {
			t.Fatalf("%s leaks a held post:\n%s", path, body)
		}
		if !strings.Contains(body, `content="https://helpdesk.example/og-image.png"`) {
			t.Fatalf("%s: want the site's card:\n%s", path, body)
		}
	}
	if body := previewGet(t, "/"); !strings.Contains(body, `<meta property="og:title" content="SDU Helpdesk">`) {
		t.Fatalf("home:\n%s", body)
	}
}

func TestClip(t *testing.T) {
	if got := clip("  a  b\n c ", 10); got != "a b c" {
		t.Fatalf("clip: %q", got)
	}
	if got := clip("Сәлем әлем", 6); got != "Сәлем…" {
		t.Fatalf("clip runes: %q", got)
	}
}
