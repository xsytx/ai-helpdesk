package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sync"
	"testing"
	"time"

	"campus-forum/internal/middleware"
)

// Emails are sent in the background: signing up must not wait for the mail
// server. Real database, skipped without TEST_DATABASE_URL.

// slowMailer is a "real" mail server that takes delay per email.
type slowMailer struct {
	delay time.Duration
	mu    sync.Mutex
	sent  []string // bodies
}

func (m *slowMailer) Send(_, _, body string) error {
	time.Sleep(m.delay)
	m.mu.Lock()
	m.sent = append(m.sent, body)
	m.mu.Unlock()
	return nil
}
func (m *slowMailer) IsStub() bool { return false }

func (m *slowMailer) bodies() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.sent...)
}

func TestSignUpDoesNotWaitForTheEmail(t *testing.T) {
	e := newModEnv(t)
	mailer := &slowMailer{delay: 2 * time.Second}
	e.h.Mailer = mailer
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/register", e.h.Register)
	mux.HandleFunc("POST /api/forgot-password", e.h.ForgotPassword)
	mux.Handle("POST /api/verify-email", middleware.Auth(e.secret)(http.HandlerFunc(e.h.VerifyEmail)))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	post := func(path string, body any, token string) (int, map[string]any, time.Duration) {
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost, srv.URL+path, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		started := time.Now()
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		out := map[string]any{}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out, time.Since(started)
	}

	email := fmt.Sprintf("s%d@sdu.edu.kz", time.Now().UnixNano()%1_000_000_000)
	code, out, took := post("/api/register", map[string]any{"email": email, "password": "Secret-pass-123!", "display_name": fmt.Sprintf("mail%d", time.Now().UnixNano()%1_000_000)}, "")
	if code != http.StatusCreated {
		t.Fatalf("register: %d %v", code, out)
	}
	if took > time.Second {
		t.Fatalf("sign-up waited %s for the 2s mail server", took)
	}
	if _, dev := out["dev_verification_code"]; dev {
		t.Fatal("with a real mail server the code must not be handed back")
	}

	// The email still arrives, and its code works.
	deadline := time.Now().Add(5 * time.Second)
	for len(mailer.bodies()) == 0 && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}
	bodies := mailer.bodies()
	if len(bodies) != 1 {
		t.Fatalf("emails sent: %d", len(bodies))
	}
	sent := regexp.MustCompile(`\b\d{6}\b`).FindString(bodies[0])
	token, _ := out["token"].(string)
	if code, out, _ := post("/api/verify-email", map[string]any{"code": sent}, token); code != http.StatusOK {
		t.Fatalf("verify with the emailed code: %d %v", code, out)
	}

	// "Forgot password" is as quick for a registered address as for an unknown one.
	_, _, known := post("/api/forgot-password", map[string]any{"email": email}, "")
	_, _, unknown := post("/api/forgot-password", map[string]any{"email": "nobody-" + email}, "")
	if known > time.Second || unknown > time.Second {
		t.Fatalf("forgot password took %s (registered) / %s (unknown)", known, unknown)
	}
}
