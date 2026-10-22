package mlclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// ModerationResult is the ML service's verdict for one text (POST /moderate).
// Decision is "allow", "block" or "review"; Categories explains block/review
// (profanity, harassment, hate, threat, sexual_harassment).
type ModerationResult struct {
	RequestID      string   `json:"request_id"`
	Decision       string   `json:"decision"`
	PublishAllowed bool     `json:"publish_allowed"`
	Categories     []string `json:"categories"`
	Reason         string   `json:"reason"`
	PolicyVersion  string   `json:"policy_version"`
}

// Moderate asks the ML service to classify text. Any failure to get a clean
// verdict is an error (the caller decides what to do: it never means "allow").
func (c *Client) Moderate(ctx context.Context, text string) (ModerationResult, error) {
	body, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		return ModerationResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/moderate", bytes.NewReader(body))
	if err != nil {
		return ModerationResult{}, err
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return ModerationResult{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return ModerationResult{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}

	switch resp.StatusCode {
	case http.StatusOK:
		var out ModerationResult
		if err := json.Unmarshal(raw, &out); err != nil || out.Decision == "" {
			return ModerationResult{}, ErrInvalidBody
		}
		return out, nil
	case http.StatusUnprocessableEntity:
		return ModerationResult{}, ErrBadRequest
	case http.StatusServiceUnavailable, http.StatusBadGateway:
		return ModerationResult{}, ErrUnavailable
	default:
		return ModerationResult{}, ErrUpstream
	}
}
