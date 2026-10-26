package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"campus-forum/internal/mlclient"
)

// Stories 8-9: the AI chat gets the forum's answered questions and may
// answer with one as the "community answer". Real database, skipped without
// TEST_DATABASE_URL.

func TestChatUsesForumAnswers(t *testing.T) {
	e := newForumEnv(t)
	asker, helper, liker, admin := e.user("user"), e.user("user"), e.user("user"), e.user("admin")

	accepted := e.newThread(asker, "How to get a dorm room?", "First year, need a place to live")
	e.newAnswer(helper, accepted, "Some other answer")
	best := e.newAnswer(helper, accepted, "Apply on the student portal in August.")
	if code, _ := e.call(asker, http.MethodPost, fmt.Sprintf("/api/threads/%d/accept", accepted), map[string]any{"comment_id": best}); code >= 300 {
		t.Fatalf("accept: %d", code)
	}
	liked := e.newThread(asker, "Canteen opening hours?", "When does it open")
	e.newAnswer(helper, liked, "Not liked answer")
	likedAnswer := e.newAnswer(helper, liked, "From 8 to 18.")
	e.call(liker, http.MethodPost, fmt.Sprintf("/api/comments/%d/vote", likedAnswer), map[string]any{"value": 1})
	staff := e.newThread(asker, "Where is the dean's office?", "Looking for it")
	e.newAnswer(admin, staff, "Block A, room 101.")
	plain := e.newThread(asker, "Is the gym free?", "Asking for a friend")
	e.newAnswer(helper, plain, "I think so") // no like, not accepted, not staff: not trusted
	e.newThread(asker, "Nobody answered this", "Question without answers")
	// A wrong answer corrected in a liked reply: the reply is what the bot gets.
	corrected := e.newThread(asker, "Is there a microwave in the canteen?", "Want to warm up my lunch")
	wrong := e.newAnswer(helper, corrected, "No, there is none")
	_, fix := e.call(admin, http.MethodPost, fmt.Sprintf("/api/threads/%d/comments", corrected),
		map[string]any{"body": "There are two, next to the cashier.", "parent_comment_id": wrong})
	e.waitStatus("comment", num(fix["id"]), "ok")
	e.call(liker, http.MethodPost, fmt.Sprintf("/api/comments/%d/vote", num(fix["id"])), map[string]any{"value": 1})

	// The fake model checks what it was given and picks the dorm question.
	var got []mlclient.ForumCandidate
	ml := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/moderate" {
			e.fakeML().ServeHTTP(w, r)
			return
		}
		var in struct {
			Forum []mlclient.ForumCandidate `json:"forum"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		got = in.Forum
		w.Header().Set("Content-Type", "application/x-ndjson")
		line := func(v any) { b, _ := json.Marshal(v); w.Write(append(b, '\n')) }
		line(map[string]any{"type": "delta", "text": "Use the portal in August."})
		line(map[string]any{"type": "done", "request_id": "rid", "status": "answered", "answer": "Use the portal in August.",
			"forum_answer": "Apply on the student portal in August.", "ai_explanation": "Use the portal in August.",
			"language": "en", "basis": "retrieved", "source_type": "forum",
			"source": map[string]any{"id": fmt.Sprintf("forum-%d", accepted), "question": "How to get a dorm room?", "thread_id": accepted, "comment_id": best, "accepted": true}})
	}))
	t.Cleanup(ml.Close)
	e.h.ML = mlclient.New(ml.URL, 5*time.Second)

	_, events := e.streamAsk(asker, map[string]any{"question": "Where do I apply for the dormitory?"}, 0)
	answers := map[int64]mlclient.ForumCandidate{}
	for _, c := range got {
		answers[c.ThreadID] = c
	}
	if a := answers[accepted]; a.Answer != "Apply on the student portal in August." || !a.Accepted || a.Body == "" || a.CommentID != best {
		t.Fatalf("accepted answer: %+v", a)
	}
	if a := answers[liked]; a.Answer != "From 8 to 18." || a.Likes != 1 {
		t.Fatalf("most-liked answer: %+v", a)
	}
	if a := answers[staff]; a.Answer != "Block A, room 101." || !a.Staff {
		t.Fatalf("staff answer: %+v", a)
	}
	if a := answers[corrected]; a.Answer != "There are two, next to the cashier." {
		t.Fatalf("a liked reply under an unliked answer: %+v", a)
	}
	if _, ok := answers[plain]; ok {
		t.Fatalf("an answer without likes/acceptance must not be offered: %+v", got)
	}
	pos := map[int64]int{}
	for i, c := range got {
		pos[c.ThreadID] = i
	}
	if pos[accepted] > pos[liked] || pos[accepted] > pos[staff] {
		t.Fatalf("accepted answers come first: %+v", got)
	}

	done := events[len(events)-1]
	src, _ := done["source"].(map[string]any)
	if done["source_type"] != "forum" || src == nil || num(src["thread_id"]) != accepted || src["accepted"] != true {
		t.Fatalf("done: %v", done)
	}
	conv := done["conversation"].(map[string]any)
	_, msgs := e.call(asker, http.MethodGet, fmt.Sprintf("/api/chat/conversations/%d/messages", num(conv["id"])), nil)
	list := msgs["messages"].([]any)
	saved := list[len(list)-1].(map[string]any)
	if saved["source_type"] != "forum" || num(saved["source_thread_id"]) != accepted || num(saved["source_comment_id"]) != best ||
		saved["forum_answer"] != "Apply on the student portal in August." {
		t.Fatalf("saved answer: %v", saved)
	}
}
