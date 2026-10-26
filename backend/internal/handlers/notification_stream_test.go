package handlers

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"campus-forum/internal/events"
	"campus-forum/internal/middleware"
)

// Live notifications: a new answer reaches the asker's open page at once.
// Real database, skipped without TEST_DATABASE_URL.

func TestNotificationStream(t *testing.T) {
	e := newForumEnv(t)
	asker, helper := e.user("user"), e.user("user")
	tid := e.newThread(asker, "Where is the gym?", "Looking for the gym on campus")

	e.h.Events = events.NewHub()
	ctx, stop := context.WithCancel(context.Background())
	t.Cleanup(stop)
	go func() { _ = e.pg.ListenNotificationEvents(ctx, e.h.Events.Publish) }()
	time.Sleep(300 * time.Millisecond) // LISTEN is in place

	// The stream route on a server of its own (the forum env's mux is fixed).
	mux := http.NewServeMux()
	mux.Handle("GET /api/notifications/stream", middleware.Auth(e.secret)(http.HandlerFunc(e.h.NotificationStream)))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/notifications/stream", nil)
	req.Header.Set("Authorization", "Bearer "+asker.token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); resp.StatusCode != http.StatusOK || ct != "text/event-stream" {
		t.Fatalf("stream: %d %s", resp.StatusCode, ct)
	}

	lines := make(chan string, 16)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
	}()
	e.newAnswer(helper, tid, "Block G, ground floor.")
	want := fmt.Sprintf(`data: {"thread_id":%d}`, tid)
	deadline := time.After(5 * time.Second)
	for {
		select {
		case l := <-lines:
			if strings.HasPrefix(l, "data:") {
				if l != want {
					t.Fatalf("event %q, want %q", l, want)
				}
				return
			}
		case <-deadline:
			t.Fatal("no live event for the new answer")
		}
	}
}
