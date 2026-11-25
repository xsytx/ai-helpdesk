package mlclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// SummaryReview is one published course review sent to the AI (never who wrote it).
type SummaryReview struct {
	Text       string `json:"text"`
	Recommend  bool   `json:"recommend"`
	Difficulty int    `json:"difficulty,omitempty"`
	Workload   int    `json:"workload,omitempty"`
	Usefulness int    `json:"usefulness,omitempty"`
	Interest   int    `json:"interest,omitempty"`
	Practical  int    `json:"practical,omitempty"`
	Beginner   int    `json:"beginner,omitempty"`
}

// SummaryRequest: POST /summarize-reviews. Language is ru, kk or en.
type SummaryRequest struct {
	Course   string             `json:"course"`
	Language string             `json:"language"`
	Reviews  []SummaryReview    `json:"reviews"`
	Averages map[string]float64 `json:"averages,omitempty"`
}

type SummaryResult struct {
	Summary  string   `json:"summary"`
	Liked    []string `json:"liked"`
	Warnings []string `json:"warnings"`
}

// SummarizeReviews asks the ML service for an overview of a course's reviews.
func (c *Client) SummarizeReviews(ctx context.Context, in SummaryRequest) (SummaryResult, error) {
	body, err := json.Marshal(in)
	if err != nil {
		return SummaryResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/summarize-reviews", bytes.NewReader(body))
	if err != nil {
		return SummaryResult{}, err
	}
	c.setHeaders(req)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return SummaryResult{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return SummaryResult{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	switch resp.StatusCode {
	case http.StatusOK:
		var out SummaryResult
		if err := json.Unmarshal(raw, &out); err != nil || out.Summary == "" {
			return SummaryResult{}, ErrInvalidBody
		}
		return out, nil
	case http.StatusUnprocessableEntity:
		return SummaryResult{}, ErrBadRequest
	case http.StatusServiceUnavailable, http.StatusBadGateway:
		return SummaryResult{}, ErrUnavailable
	default:
		return SummaryResult{}, ErrUpstream
	}
}
