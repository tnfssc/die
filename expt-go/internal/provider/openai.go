package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"godie/internal/core"
)

type openAIProvider struct{ cfg Config }

func (p *codexProvider) Complete(ctx context.Context, req core.Request, cb func(core.StreamEvent)) (core.Response, error) {
	auth, err := captureFastAuthorization(req, p.cfg, "openai-codex")
	if err != nil {
		return core.Response{}, err
	}
	token, err := p.token(ctx)
	if err != nil {
		return core.Response{}, err
	}
	account, err := jwtAccountID(token)
	if err != nil {
		return core.Response{}, err
	}
	headers := codexHeaders(token, account, req.SessionID)
	endpoint := codexResponsesURL(p.cfg.BaseURL)
	if auth.requested {
		endpoint = officialCodexBase + "/codex/responses"
	}
	return completeResponses(ctx, p.cfg, endpoint, headers, req, cb, "openai-codex", auth)
}
func (p *openAIProvider) Complete(ctx context.Context, req core.Request, cb func(core.StreamEvent)) (core.Response, error) {
	providerID := p.cfg.Kind
	if providerID == "" {
		providerID = "openai"
	}
	auth, err := captureFastAuthorization(req, p.cfg, providerID)
	if err != nil {
		return core.Response{}, err
	}
	endpoint := strings.TrimRight(p.cfg.BaseURL, "/") + "/responses"
	if auth.requested {
		endpoint = officialOpenAIBase + "/responses"
	}
	if req.MaxTokens <= 0 {
		req.MaxTokens = p.cfg.DefaultMaxTokens
	}
	return completeResponses(ctx, p.cfg, endpoint, requestHeaders(map[string]string{"Authorization": "Bearer " + p.cfg.APIKey, "Accept": "text/event-stream"}, p.cfg.Headers), req, cb, providerID, auth)
}

type responsesWire struct {
	ID     string          `json:"id"`
	Output json.RawMessage `json:"output"`
	Status string          `json:"status"`
	Usage  struct {
		Input   int64 `json:"input_tokens"`
		Output  int64 `json:"output_tokens"`
		Details struct {
			Cached     int64 `json:"cached_tokens"`
			CacheWrite int64 `json:"cache_write_tokens"`
		} `json:"input_tokens_details"`
	} `json:"usage"`
}

func completeResponses(ctx context.Context, cfg Config, url string, headers map[string]string, req core.Request, cb func(core.StreamEvent), providerID string, auth fastAuthorization) (core.Response, error) {
	body, err := responsesBody(req, auth.model, providerID)
	if err != nil {
		return core.Response{}, err
	}
	if err := guardResponsesPayload(body, auth, standardTierRequested(ctx)); err != nil {
		return core.Response{}, err
	}
	resp, err := postJSON(ctx, cfg.HTTPClient, url, headers, body)
	if err != nil {
		return core.Response{}, err
	}
	defer resp.Body.Close()
	var completed responsesWire
	sawCompleted := false
	var text strings.Builder
	// Keep only complete output items. Added and argument-delta events are not
	// safe final tool calls: a partial argument string must never be executed.
	completedItems := map[int]json.RawMessage{}
	seenItemIndices := map[int]bool{}
	itemIndexByID := map[string]int{}
	handle := func(event string, data []byte) error {
		if string(data) == "[DONE]" {
			return nil
		}
		var raw map[string]json.RawMessage
		if json.Unmarshal(data, &raw) != nil {
			return fmt.Errorf("provider: invalid Responses stream event")
		}
		typ := event
		if v := raw["type"]; len(v) > 0 {
			json.Unmarshal(v, &typ)
		}
		if cb != nil {
			cb(core.StreamEvent{Type: "native", Data: json.RawMessage(append([]byte(nil), data...))})
		}
		switch typ {
		case "response.output_text.delta", "response.refusal.delta":
			var d string
			json.Unmarshal(raw["delta"], &d)
			text.WriteString(d)
			if cb != nil && d != "" {
				cb(core.StreamEvent{Type: "text", Text: d})
			}
		case "response.output_item.added", "response.output_item.done":
			var index int
			if err := json.Unmarshal(raw["output_index"], &index); err != nil || len(raw["item"]) == 0 {
				return errors.New("provider: invalid Responses output item event")
			}
			seenItemIndices[index] = true
			var identity map[string]json.RawMessage
			if err := json.Unmarshal(raw["item"], &identity); err != nil {
				return errors.New("provider: invalid Responses output item")
			}
			var id string
			json.Unmarshal(identity["id"], &id)
			if previous, ok := itemIndexByID[id]; id != "" && ok && previous != index {
				delete(completedItems, previous)
				delete(seenItemIndices, previous)
			}
			if id != "" {
				itemIndexByID[id] = index
			}
			if typ == "response.output_item.done" {
				completedItems[index] = append(json.RawMessage(nil), raw["item"]...)
			}
		case "response.completed":
			sawCompleted = true
			if v := raw["response"]; len(v) > 0 {
				if err := json.Unmarshal(v, &completed); err != nil {
					return err
				}
			}
		case "response.failed", "error":
			return errors.New("provider: Responses stream reported failure")
		}
		return nil
	}
	var responseBody io.Reader = resp.Body
	isSSE := strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream")
	if !isSSE {
		var sniffed bool
		responseBody, sniffed, err = sniffSSE(resp.Body)
		if err != nil {
			return core.Response{}, err
		}
		isSSE = sniffed
	}
	if isSSE {
		err = readSSE(ctx, responseBody, handle)
	} else {
		b, e := io.ReadAll(io.LimitReader(responseBody, 32<<20))
		if e != nil {
			return core.Response{}, e
		}
		var envelope map[string]json.RawMessage
		if json.Unmarshal(b, &envelope) == nil && envelope["type"] != nil {
			err = handle("", b)
		} else {
			err = json.Unmarshal(b, &completed)
		}
	}
	if err != nil {
		return core.Response{}, err
	}
	if isSSE && !sawCompleted {
		return core.Response{}, errors.New("provider: Responses stream ended before response.completed")
	}
	if err = ctx.Err(); err != nil {
		return core.Response{}, err
	}
	// A non-empty final response.output supersedes the completed item stream.
	// Codex intentionally sends [] here, so an empty array must not erase it.
	var rawItems []json.RawMessage
	if len(completed.Output) > 0 {
		var finalItems []json.RawMessage
		if err := json.Unmarshal(completed.Output, &finalItems); err != nil {
			return core.Response{}, errors.New("provider: invalid completed Responses output")
		}
		if len(finalItems) > 0 {
			rawItems = finalItems
		}
	}
	if len(rawItems) == 0 {
		if len(completedItems) != len(seenItemIndices) {
			return core.Response{}, errors.New("provider: Responses stream ended with an incomplete output item")
		}
		indices := make([]int, 0, len(completedItems))
		for index := range completedItems {
			indices = append(indices, index)
		}
		// Output indices define native replay order, regardless of event arrival.
		for i := 1; i < len(indices); i++ {
			for j := i; j > 0 && indices[j] < indices[j-1]; j-- {
				indices[j], indices[j-1] = indices[j-1], indices[j]
			}
		}
		for _, index := range indices {
			rawItems = append(rawItems, completedItems[index])
		}
	}
	var items []struct {
		Type      string `json:"type"`
		ID        string `json:"id"`
		CallID    string `json:"call_id"`
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
		Content   []struct {
			Type    string `json:"type"`
			Text    string `json:"text"`
			Refusal string `json:"refusal"`
		} `json:"content"`
	}
	if len(rawItems) > 0 {
		encoded, err := json.Marshal(rawItems)
		if err != nil || json.Unmarshal(encoded, &items) != nil {
			return core.Response{}, errors.New("provider: invalid completed output item")
		}
		text.Reset()
	}
	outCalls := make([]core.ToolCall, 0)
	for _, item := range items {
		switch item.Type {
		case "message":
			for _, content := range item.Content {
				switch content.Type {
				case "output_text":
					text.WriteString(content.Text)
				case "refusal":
					text.WriteString(content.Refusal)
				}
			}
		case "function_call":
			arguments := json.RawMessage(item.Arguments)
			if len(arguments) == 0 || !json.Valid(arguments) {
				return core.Response{}, errors.New("provider: completed function call has invalid arguments")
			}
			id := item.CallID
			if id == "" {
				id = item.ID
			}
			outCalls = append(outCalls, core.ToolCall{ID: id, Name: item.Name, Arguments: arguments})
		}
	}
	stop := "stop"
	if len(outCalls) > 0 {
		stop = "tool"
	}
	native, err := json.Marshal(rawItems)
	if err != nil {
		return core.Response{}, err
	}
	uncachedInput := completed.Usage.Input - completed.Usage.Details.Cached - completed.Usage.Details.CacheWrite
	if uncachedInput < 0 {
		return core.Response{}, errors.New("provider: invalid Responses usage accounting")
	}
	usage := core.Usage{Input: uncachedInput, Output: completed.Usage.Output, CacheRead: completed.Usage.Details.Cached, CacheWrite: completed.Usage.Details.CacheWrite}
	applyUsageCost(providerID, auth.model, &usage)
	return core.Response{Message: core.Message{Role: "assistant", Content: text.String(), ToolCalls: outCalls, Native: native, Provider: providerID, Model: auth.model}, Usage: usage, StopReason: stop, ResponseID: completed.ID}, nil
}
func responsesBody(req core.Request, m, providerID string) (map[string]any, error) {
	if m == "" {
		return nil, errors.New("provider: model is required")
	}
	input := []any{}
	for _, msg := range req.Messages {
		if msg.Role == "assistant" && containsCompactionCheckpoint(msg.Native) && !nativeReplayAllowed(msg, providerID, m) {
			return nil, errors.New("provider: opaque checkpoint provider/model mismatch")
		}
		if len(msg.Native) > 0 && msg.Role == "assistant" && nativeReplayAllowed(msg, providerID, m) {
			var a []any
			if json.Unmarshal(msg.Native, &a) == nil {
				input = append(input, a...)
				continue
			}
			var o struct {
				Output []any `json:"output"`
			}
			if json.Unmarshal(msg.Native, &o) == nil && o.Output != nil {
				input = append(input, o.Output...)
				continue
			}
		}
		switch msg.Role {
		case "user":
			content := []any{map[string]any{"type": "input_text", "text": msg.Content}}
			for _, im := range msg.Images {
				content = append(content, map[string]any{"type": "input_image", "image_url": "data:" + im.MIME + ";base64," + im.Data})
			}
			input = append(input, map[string]any{"role": "user", "content": content})
		case "assistant":
			if msg.Content != "" {
				input = append(input, map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": msg.Content}}})
			}
			for _, tc := range msg.ToolCalls {
				input = append(input, map[string]any{"type": "function_call", "call_id": tc.ID, "name": tc.Name, "arguments": string(tc.Arguments)})
			}
		case "tool":
			var output any = msg.Content
			if len(msg.Images) > 0 {
				parts := []any{}
				if msg.Content != "" {
					parts = append(parts, map[string]any{"type": "input_text", "text": msg.Content})
				}
				for _, im := range msg.Images {
					parts = append(parts, map[string]any{"type": "input_image", "detail": "auto", "image_url": "data:" + im.MIME + ";base64," + im.Data})
				}
				output = parts
			}
			input = append(input, map[string]any{"type": "function_call_output", "call_id": msg.ToolCallID, "output": output})
		}
	}
	b := map[string]any{"model": m, "input": input, "stream": true, "store": false, "tools": []any{map[string]any{"type": "function", "name": "execute", "description": "Run JavaScript or TypeScript in the die tool runtime.", "parameters": map[string]any{"type": "object", "properties": map[string]any{"code": map[string]any{"type": "string"}, "timeoutSeconds": map[string]any{"type": "number"}}, "required": []string{"code"}, "additionalProperties": false}}}}
	if req.System != "" {
		b["instructions"] = req.System
	}
	// The ChatGPT Codex endpoint rejects max_output_tokens; the public Responses API supports it.
	if req.MaxTokens > 0 && providerID != "openai-codex" {
		b["max_output_tokens"] = req.MaxTokens
	}
	if providerID == "openai-codex" {
		// Codex is stateless (store:false), so encrypted reasoning must be returned and replayed.
		b["include"] = []string{"reasoning.encrypted_content"}
		b["text"] = map[string]any{"verbosity": "low"}
		b["tool_choice"] = "auto"
		b["parallel_tool_calls"] = true
		if req.SessionID != "" {
			b["prompt_cache_key"] = req.SessionID
		}
		if tools, ok := b["tools"].([]any); ok {
			for _, tool := range tools {
				if object, ok := tool.(map[string]any); ok {
					object["strict"] = nil
				}
			}
		}
		if req.System == "" {
			b["instructions"] = "You are a helpful assistant."
		}
	}
	if req.Thinking != "" && req.Thinking != "off" && req.Thinking != "none" {
		reasoning := map[string]any{"effort": req.Thinking}
		if providerID == "openai-codex" {
			reasoning["summary"] = "auto"
		}
		b["reasoning"] = reasoning
	}
	return b, nil
}
