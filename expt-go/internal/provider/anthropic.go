package provider

import (
	"context"
	"encoding/json"
	"errors"
	"godie/internal/core"
	"io"
	"strings"
)

type anthropicProvider struct{ cfg Config }

func (p *anthropicProvider) Complete(ctx context.Context, req core.Request, cb func(core.StreamEvent)) (core.Response, error) {
	if err := unsupported(req.Fast); err != nil {
		return core.Response{}, err
	}
	providerID := p.cfg.Kind
	if providerID == "" {
		providerID = "anthropic"
	}
	m := model(req, p.cfg.Model)
	if m == "" {
		return core.Response{}, errors.New("provider: model is required")
	}
	msgs := []any{}
	for _, x := range req.Messages {
		if x.Role == "assistant" && containsCompactionCheckpoint(x.Native) && !nativeReplayAllowed(x, providerID, m) {
			return core.Response{}, errors.New("provider: opaque checkpoint provider/model mismatch")
		}
		if x.Role == "assistant" && len(x.Native) > 0 && nativeReplayAllowed(x, providerID, m) {
			var content []any
			if json.Unmarshal(x.Native, &content) == nil {
				msgs = append(msgs, map[string]any{"role": "assistant", "content": content})
				continue
			}
		}
		switch x.Role {
		case "user":
			parts := []any{map[string]any{"type": "text", "text": x.Content}}
			for _, im := range x.Images {
				parts = append(parts, map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": im.MIME, "data": im.Data}})
			}
			msgs = append(msgs, map[string]any{"role": "user", "content": parts})
		case "assistant":
			parts := []any{}
			if x.Content != "" {
				parts = append(parts, map[string]any{"type": "text", "text": x.Content})
			}
			for _, tc := range x.ToolCalls {
				var in any = json.RawMessage(tc.Arguments)
				parts = append(parts, map[string]any{"type": "tool_use", "id": tc.ID, "name": tc.Name, "input": in})
			}
			msgs = append(msgs, map[string]any{"role": "assistant", "content": parts})
		case "tool":
			var result any = x.Content
			if len(x.Images) > 0 {
				content := []any{}
				if x.Content != "" {
					content = append(content, map[string]any{"type": "text", "text": x.Content})
				} else {
					content = append(content, map[string]any{"type": "text", "text": "(see attached image)"})
				}
				for _, im := range x.Images {
					content = append(content, map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": im.MIME, "data": im.Data}})
				}
				result = content
			}
			msgs = append(msgs, map[string]any{"role": "user", "content": []any{map[string]any{"type": "tool_result", "tool_use_id": x.ToolCallID, "content": result}}})
		}
	}
	max := req.MaxTokens
	if max <= 0 {
		max = p.cfg.DefaultMaxTokens
		if max <= 0 {
			max = 8192
		}
	}
	body := map[string]any{"model": m, "messages": msgs, "max_tokens": max, "stream": true, "tools": []any{map[string]any{"name": "execute", "description": "Run JavaScript or TypeScript in the die tool runtime.", "input_schema": map[string]any{"type": "object", "properties": map[string]any{"code": map[string]any{"type": "string"}, "timeoutSeconds": map[string]any{"type": "number"}}, "required": []string{"code"}}}}}
	if req.System != "" {
		body["system"] = req.System
	}
	if err := configureAnthropicThinking(body, m, req.Thinking, &max, req.MaxTokens > 0); err != nil {
		return core.Response{}, err
	}
	body["max_tokens"] = max
	base := strings.TrimRight(p.cfg.BaseURL, "/")
	endpoint := base + "/v1/messages"
	if strings.HasSuffix(base, "/v1") {
		endpoint = base + "/messages"
	}
	resp, err := postJSON(ctx, p.cfg.HTTPClient, endpoint, requestHeaders(map[string]string{"x-api-key": p.cfg.APIKey, "anthropic-version": "2023-06-01", "Accept": "text/event-stream"}, p.cfg.Headers), body)
	if err != nil {
		return core.Response{}, err
	}
	defer resp.Body.Close()
	var text strings.Builder
	blocks := []map[string]any{}
	var usage core.Usage
	stop := ""
	id := ""
	terminal := false
	closedBlocks := map[int]bool{}
	handle := func(event string, data []byte) error {
		var e struct {
			Type    string `json:"type"`
			Index   int    `json:"index"`
			Message struct {
				ID    string `json:"id"`
				Usage struct {
					Input      int64 `json:"input_tokens"`
					Output     int64 `json:"output_tokens"`
					CacheRead  int64 `json:"cache_read_input_tokens"`
					CacheWrite int64 `json:"cache_creation_input_tokens"`
				} `json:"usage"`
			} `json:"message"`
			ContentBlock map[string]any   `json:"content_block"`
			Delta        map[string]any   `json:"delta"`
			Usage        map[string]int64 `json:"usage"`
			Error        struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(data, &e) != nil {
			return errors.New("provider: invalid Anthropic stream event")
		}
		if cb != nil {
			cb(core.StreamEvent{Type: "native", Data: json.RawMessage(append([]byte(nil), data...))})
		}
		switch e.Type {
		case "error":
			if e.Error.Message == "" {
				e.Error.Message = "unknown stream error"
			}
			return errors.New("provider: Anthropic stream error: " + e.Error.Message)
		case "message_start":
			id = e.Message.ID
			usage.Input = e.Message.Usage.Input
			usage.Output = e.Message.Usage.Output
			usage.CacheRead = e.Message.Usage.CacheRead
			usage.CacheWrite = e.Message.Usage.CacheWrite
		case "content_block_start":
			if e.Index < 0 || e.Index > len(blocks) {
				return errors.New("provider: invalid Anthropic block index")
			}
			if e.Index < len(blocks) {
				return errors.New("provider: duplicate Anthropic block index")
			}
			blocks = append(blocks, e.ContentBlock)
		case "content_block_delta":
			if e.Index < 0 || e.Index >= len(blocks) || blocks[e.Index] == nil || len(blocks[e.Index]) == 0 || closedBlocks[e.Index] {
				return errors.New("provider: Anthropic block delta without block")
			}
			typ, _ := e.Delta["type"].(string)
			if typ == "text_delta" {
				if blocks[e.Index]["type"] != "text" {
					return errors.New("provider: Anthropic delta/block type mismatch")
				}
				d, _ := e.Delta["text"].(string)
				text.WriteString(d)
				blocks[e.Index]["text"], _ = blocks[e.Index]["text"].(string)
				blocks[e.Index]["text"] = blocks[e.Index]["text"].(string) + d
				if cb != nil && d != "" {
					cb(core.StreamEvent{Type: "text", Text: d})
				}
			} else if typ == "thinking_delta" {
				if blocks[e.Index]["type"] != "thinking" {
					return errors.New("provider: Anthropic delta/block type mismatch")
				}
				d, _ := e.Delta["thinking"].(string)
				old, _ := blocks[e.Index]["thinking"].(string)
				blocks[e.Index]["thinking"] = old + d
			} else if typ == "signature_delta" {
				if blocks[e.Index]["type"] != "thinking" {
					return errors.New("provider: Anthropic delta/block type mismatch")
				}
				d, _ := e.Delta["signature"].(string)
				old, _ := blocks[e.Index]["signature"].(string)
				blocks[e.Index]["signature"] = old + d
			} else if typ == "input_json_delta" {
				if blocks[e.Index]["type"] != "tool_use" {
					return errors.New("provider: Anthropic delta/block type mismatch")
				}
				d, _ := e.Delta["partial_json"].(string)
				old, _ := blocks[e.Index]["_json"].(string)
				blocks[e.Index]["_json"] = old + d
			}
		case "content_block_stop":
			if e.Index < 0 || e.Index >= len(blocks) || blocks[e.Index] == nil || len(blocks[e.Index]) == 0 {
				return errors.New("provider: Anthropic block stop without block")
			}
			closedBlocks[e.Index] = true
		case "message_delta":
			if r, _ := e.Delta["stop_reason"].(string); r != "" {
				var stopErr error
				stop, stopErr = anthropicStopReason(r)
				if stopErr != nil {
					return stopErr
				}
			}
			if v, ok := e.Usage["output_tokens"]; ok {
				usage.Output = v
			}
		case "message_stop":
			terminal = true
		}
		return nil
	}
	if strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		err = readSSE(ctx, resp.Body, handle)
	} else {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
		var full struct {
			ID         string           `json:"id"`
			StopReason string           `json:"stop_reason"`
			Content    []map[string]any `json:"content"`
			Usage      struct {
				Input      int64 `json:"input_tokens"`
				Output     int64 `json:"output_tokens"`
				CacheRead  int64 `json:"cache_read_input_tokens"`
				CacheWrite int64 `json:"cache_creation_input_tokens"`
			}
		}
		if json.Unmarshal(b, &full) != nil {
			return core.Response{}, errors.New("provider: invalid Anthropic response")
		}
		id = full.ID
		blocks = full.Content
		for i := range blocks {
			closedBlocks[i] = true
		}
		usage.Input = full.Usage.Input
		usage.Output = full.Usage.Output
		usage.CacheRead = full.Usage.CacheRead
		usage.CacheWrite = full.Usage.CacheWrite
		if full.StopReason == "" {
			return core.Response{Usage: usage}, errors.New("provider: Anthropic response has no stop reason")
		}
		stop, err = anthropicStopReason(full.StopReason)
		if err != nil {
			applyUsageCost("anthropic", m, &usage)
			return core.Response{Usage: usage}, err
		}
		terminal = true
	}
	if err != nil {
		applyUsageCost("anthropic", m, &usage)
		return core.Response{Usage: usage}, err
	}
	if !terminal || stop == "" {
		applyUsageCost("anthropic", m, &usage)
		return core.Response{Usage: usage}, errors.New("provider: Anthropic stream ended before message_stop or stop reason")
	}
	applyUsageCost("anthropic", m, &usage)
	calls := []core.ToolCall{}
	deriveText := text.Len() == 0
	for i, b := range blocks {
		if deriveText && b["type"] == "text" {
			if v, ok := b["text"].(string); ok {
				text.WriteString(v)
			}
		}
		if b["type"] == "tool_use" {
			if !closedBlocks[i] {
				return core.Response{Usage: usage}, errors.New("provider: incomplete Anthropic tool block")
			}
			id, _ := b["id"].(string)
			name, _ := b["name"].(string)
			var arg json.RawMessage
			if s, _ := b["_json"].(string); s != "" {
				arg = json.RawMessage(s)
			} else {
				arg, _ = json.Marshal(b["input"])
			}
			var object map[string]any
			if id == "" || name == "" || len(arg) == 0 || json.Unmarshal(arg, &object) != nil || object == nil {
				return core.Response{Usage: usage}, errors.New("provider: invalid Anthropic tool call")
			}
			delete(b, "_json")
			b["input"] = json.RawMessage(arg)
			calls = append(calls, core.ToolCall{ID: id, Name: name, Arguments: arg})
		}
	}
	native, _ := json.Marshal(blocks)
	return core.Response{Message: core.Message{Role: "assistant", Content: text.String(), ToolCalls: calls, Native: native, Provider: providerID, Model: m}, Usage: usage, StopReason: stop, ResponseID: id}, nil
}

func anthropicStopReason(reason string) (string, error) {
	switch reason {
	case "tool_use":
		return "tool", nil
	case "max_tokens":
		return "length", nil
	case "end_turn", "stop_sequence", "pause_turn":
		return "stop", nil
	case "refusal", "sensitive":
		return "", errors.New("provider: Anthropic stopped with " + reason)
	default:
		return "", errors.New("provider: unknown Anthropic stop reason: " + reason)
	}
}

func configureAnthropicThinking(body map[string]any, model, level string, max *int, explicitMax bool) error {
	if level == "" || level == "none" || level == "off" {
		body["thinking"] = map[string]any{"type": "disabled"}
		return nil
	}
	budgets := map[string]int{"minimal": 1024, "low": 2048, "medium": 8192, "high": 32768}
	budget, ok := budgets[level]
	if !ok {
		return errors.New("provider: unsupported Anthropic thinking level: " + level)
	}
	lower := strings.ToLower(model)
	adaptive := strings.Contains(lower, "4-6") || strings.Contains(lower, "4.6") || strings.Contains(lower, "4-7") || strings.Contains(lower, "4.7") || strings.Contains(lower, "4-8") || strings.Contains(lower, "4.8") || strings.Contains(lower, "sonnet-5") || strings.Contains(lower, "opus-5")
	if adaptive {
		body["thinking"] = map[string]any{"type": "adaptive"}
		body["output_config"] = map[string]any{"effort": map[string]string{"minimal": "low", "low": "low", "medium": "medium", "high": "high"}[level]}
		return nil
	}
	if *max <= budget {
		if explicitMax {
			return errors.New("provider: max tokens must exceed Anthropic thinking budget")
		}
		*max = budget + 1024
	}
	body["thinking"] = map[string]any{"type": "enabled", "budget_tokens": budget}
	return nil
}
