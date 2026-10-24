// Package mlclient calls the Python ML helpdesk service (generate-answer, health).
package mlclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

var (
	ErrBadRequest   = errors.New("ml bad request")
	ErrUnavailable  = errors.New("ml unavailable")
	ErrUpstream     = errors.New("ml upstream error")
	ErrInvalidBody  = errors.New("ml invalid response body")
)

type Source struct {
	ID         string `json:"id"`
	Question   string `json:"question"`
	Category   string `json:"category"`
	Language   string `json:"language"`
	SourceRow  string `json:"source_row"`
	// A forum answer (source_type "forum"): its question and how it was rated.
	ThreadID *int64 `json:"thread_id,omitempty"`
	Accepted bool   `json:"accepted,omitempty"`
	Likes    int    `json:"likes,omitempty"`
}

type GenerateResult struct {
	RequestID      string   `json:"request_id"`
	Status         string   `json:"status"`
	Answer         string   `json:"answer"`
	ForumAnswer    *string  `json:"forum_answer"`
	AIExplanation  string   `json:"ai_explanation"`
	Language       string   `json:"language"`
	Basis          string   `json:"basis"`
	Reason         *string  `json:"reason"`
	Source         *Source  `json:"source"`
	SourceType     *string  `json:"source_type"`
	RetrievalScore *float64 `json:"retrieval_score"`
	// Followups: 0-3 questions the student may ask next.
	Followups []string `json:"followups"`
}

type errorBody struct {
	RequestID string `json:"request_id"`
	Status    string `json:"status"`
	Error     string `json:"error"`
}

type HealthResult struct {
	Status       string         `json:"status"`
	IndexRecords int            `json:"index_records"`
	LLM          map[string]any `json:"llm"`
}

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func New(baseURL string, requestTimeout time.Duration) *Client {
	return &Client{
		baseURL: strings.TrimSuffix(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: requestTimeout,
			Transport: &http.Transport{
				Proxy: http.ProxyFromEnvironment,
				DialContext: (&net.Dialer{
					Timeout: 5 * time.Second,
				}).DialContext,
				ForceAttemptHTTP2:     true,
				MaxIdleConns:          4,
				IdleConnTimeout:       90 * time.Second,
				TLSHandshakeTimeout:   5 * time.Second,
				ExpectContinueTimeout: 1 * time.Second,
			},
		},
	}
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if strings.Contains(strings.ToLower(c.baseURL), "ngrok") {
		req.Header.Set("ngrok-skip-browser-warning", "true")
	}
}

// HistoryItem is an earlier message of the same chat, sent so the model
// understands follow-up questions ("and how much is it?").
type HistoryItem struct {
	Role string `json:"role"` // "user" or "assistant"
	Text string `json:"text"`
}

// ForumCandidate is a published forum question with its best answer, which
// the model may use as the "community answer" (Stories 8-9).
type ForumCandidate struct {
	ThreadID int64  `json:"thread_id"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	Answer   string `json:"answer"`
	Accepted bool   `json:"accepted"`
	Likes    int    `json:"likes"`
	Staff    bool   `json:"staff"`
}

// Background is what the model gets besides the question.
type Background struct {
	History []HistoryItem    // earlier messages of the chat, oldest first
	Forum   []ForumCandidate // answered forum questions it may use
}

// askBody is {"question": …, "history": […], "forum": […]} — language is
// omitted so the ML service auto-detects it; empty lists are left out.
func askBody(question string, bg Background) ([]byte, error) {
	payload := map[string]any{"question": question}
	if len(bg.History) > 0 {
		payload["history"] = bg.History
	}
	if len(bg.Forum) > 0 {
		payload["forum"] = bg.Forum
	}
	return json.Marshal(payload)
}

// GenerateAnswer asks the model for an answer to question.
func (c *Client) GenerateAnswer(ctx context.Context, question string, bg Background) (GenerateResult, error) {
	body, err := askBody(question, bg)
	if err != nil {
		return GenerateResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/generate-answer", bytes.NewReader(body))
	if err != nil {
		return GenerateResult{}, err
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return GenerateResult{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
		return GenerateResult{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return GenerateResult{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}

	switch resp.StatusCode {
	case http.StatusOK:
		var out GenerateResult
		if err := json.Unmarshal(raw, &out); err != nil {
			return GenerateResult{}, ErrInvalidBody
		}
		return out, nil
	case http.StatusUnprocessableEntity:
		return GenerateResult{}, ErrBadRequest
	case http.StatusServiceUnavailable, http.StatusBadGateway:
		var eb errorBody
		if json.Unmarshal(raw, &eb) == nil && eb.Error != "" {
			return GenerateResult{}, fmt.Errorf("%w: %s", mapMLHTTPStatus(resp.StatusCode), eb.Error)
		}
		return GenerateResult{}, mapMLHTTPStatus(resp.StatusCode)
	default:
		return GenerateResult{}, ErrUpstream
	}
}

func mapMLHTTPStatus(code int) error {
	if code == http.StatusServiceUnavailable {
		return ErrUnavailable
	}
	return ErrUpstream
}

func (c *Client) Health(ctx context.Context) (HealthResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health", nil)
	if err != nil {
		return HealthResult{}, err
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return HealthResult{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return HealthResult{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if resp.StatusCode != http.StatusOK {
		return HealthResult{}, ErrUnavailable
	}
	var out HealthResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return HealthResult{}, ErrInvalidBody
	}
	return out, nil
}
