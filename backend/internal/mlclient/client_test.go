package mlclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGenerateAnswerSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/generate-answer" {
			t.Fatalf("path %s", r.URL.Path)
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if _, ok := body["language"]; ok {
			t.Fatal("language must not be sent")
		}
		if body["question"] != "GPA?" {
			t.Fatalf("question %q", body["question"])
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"request_id": "abc", "status": "answered", "answer": "full",
			"forum_answer": "faq text", "ai_explanation": "expl",
			"language": "en", "basis": "retrieved", "reason": nil,
			"source": nil, "source_type": "faq", "retrieval_score": 0.9,
		})
	}))
	defer srv.Close()

	c := New(srv.URL, 5*time.Second)
	out, err := c.GenerateAnswer(context.Background(), "GPA?")
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != "answered" || out.Answer != "full" || out.Basis != "retrieved" {
		t.Fatalf("%+v", out)
	}
}

func TestGenerateAnswerFallback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"request_id": "x", "status": "fallback", "answer": "sorry",
			"forum_answer": nil, "ai_explanation": "", "language": "ru",
			"basis": "none", "reason": "llm_unavailable",
			"source": nil, "source_type": nil, "retrieval_score": nil,
		})
	}))
	defer srv.Close()

	out, err := New(srv.URL, 5*time.Second).GenerateAnswer(context.Background(), "q")
	if err != nil || out.Status != "fallback" {
		t.Fatalf("err=%v out=%+v", err, out)
	}
}

func TestGenerateAnswer503(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"request_id": "r", "status": "error", "error": "service_busy",
		})
	}))
	defer srv.Close()

	_, err := New(srv.URL, 5*time.Second).GenerateAnswer(context.Background(), "q")
	if !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("expected unavailable, got %v", err)
	}
}

func TestGenerateAnswer422(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
	}))
	defer srv.Close()

	_, err := New(srv.URL, 5*time.Second).GenerateAnswer(context.Background(), "q")
	if err != ErrBadRequest {
		t.Fatalf("got %v", err)
	}
}

func TestGenerateAnswerInvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("not json"))
	}))
	defer srv.Close()

	_, err := New(srv.URL, 5*time.Second).GenerateAnswer(context.Background(), "q")
	if err != ErrInvalidBody {
		t.Fatalf("got %v", err)
	}
}

func TestGenerateAnswerTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := New(srv.URL, time.Second).GenerateAnswer(ctx, "q")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestNgrokHeader(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "http://example.com", nil)
	if err != nil {
		t.Fatal(err)
	}
	(&Client{baseURL: "https://demo.ngrok-free.app"}).setHeaders(req)
	if req.Header.Get("ngrok-skip-browser-warning") != "true" {
		t.Fatalf("header %q", req.Header.Get("ngrok-skip-browser-warning"))
	}
}

func TestHealth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok", "index_records": 10})
	}))
	defer srv.Close()

	h, err := New(srv.URL, 2*time.Second).Health(context.Background())
	if err != nil || h.Status != "ok" {
		t.Fatalf("err=%v h=%+v", err, h)
	}
}
