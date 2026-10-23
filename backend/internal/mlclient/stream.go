package mlclient

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// StreamEvent is one line of POST /generate-answer/stream.
type StreamEvent struct {
	// Type: "delta" (Text is the next piece of the answer), "reset" (throw
	// away the text so far, the model starts again), "done" (Result is the
	// full answer) or "error" (Error is the code).
	Type   string
	Text   string
	Result GenerateResult
	Error  string
}

// GenerateAnswerStream asks like GenerateAnswer but receives the answer
// while the model writes it: onEvent gets every delta/reset, and the final
// result is returned. Cancelling ctx (the student pressed "stop") closes
// the connection, which also stops the model.
//
// An error before the first event is returned like GenerateAnswer's
// (ErrUnavailable, ErrBadRequest, ...); once events have arrived, a broken
// stream is ErrUnavailable and an "error" event is ErrUnavailable/ErrUpstream.
func (c *Client) GenerateAnswerStream(ctx context.Context, question string, history []HistoryItem, onEvent func(StreamEvent)) (GenerateResult, error) {
	payload := map[string]any{"question": question}
	if len(history) > 0 {
		payload["history"] = history
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return GenerateResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/generate-answer/stream", bytes.NewReader(body))
	if err != nil {
		return GenerateResult{}, err
	}
	c.setHeaders(req)
	req.Header.Set("Accept", "application/x-ndjson")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return GenerateResult{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusUnprocessableEntity:
		return GenerateResult{}, ErrBadRequest
	case http.StatusServiceUnavailable, http.StatusBadGateway:
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		var eb errorBody
		if json.Unmarshal(raw, &eb) == nil && eb.Error != "" {
			return GenerateResult{}, fmt.Errorf("%w: %s", mapMLHTTPStatus(resp.StatusCode), eb.Error)
		}
		return GenerateResult{}, mapMLHTTPStatus(resp.StatusCode)
	default:
		return GenerateResult{}, ErrUpstream
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 1<<20)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var head struct {
			Type  string `json:"type"`
			Text  string `json:"text"`
			Error string `json:"error"`
		}
		if err := json.Unmarshal(line, &head); err != nil {
			return GenerateResult{}, ErrInvalidBody
		}
		switch head.Type {
		case "delta", "reset":
			onEvent(StreamEvent{Type: head.Type, Text: head.Text})
		case "done":
			var out GenerateResult
			if err := json.Unmarshal(line, &out); err != nil {
				return GenerateResult{}, ErrInvalidBody
			}
			return out, nil
		case "error":
			if head.Error == "service_busy" || head.Error == "llm_unavailable" || head.Error == "llm_timeout" || head.Error == "llm_overloaded" {
				return GenerateResult{}, fmt.Errorf("%w: %s", ErrUnavailable, head.Error)
			}
			return GenerateResult{}, fmt.Errorf("%w: %s", ErrUpstream, head.Error)
		}
	}
	if err := scanner.Err(); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			return GenerateResult{}, context.Canceled
		}
		return GenerateResult{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if ctx.Err() != nil {
		return GenerateResult{}, ctx.Err()
	}
	return GenerateResult{}, fmt.Errorf("%w: stream ended without an answer", ErrUnavailable)
}
