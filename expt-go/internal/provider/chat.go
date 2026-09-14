package provider

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"godie/internal/core"
)

// NewChatCompletions constructs the intentionally small OpenAI-compatible
// /chat/completions lane. It is separate from New's OpenAI Responses provider.
func NewChatCompletions(cfg Config) (core.Provider, error) {
	cfg.Headers = cloneStringMap(cfg.Headers)
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = http.DefaultClient
	}
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.openai.com/v1"
	}
	if cfg.APIKey == "" {
		return nil, errors.New("provider: Chat Completions API key is required")
	}
	cfg.Kind = strings.ToLower(strings.TrimSpace(cfg.Kind))
	if cfg.Kind == "" {
		cfg.Kind = "openai-completions"
	}
	return &chatCompletionsProvider{cfg: cfg}, nil
}

type chatCompletionsProvider struct{ cfg Config }

type chatToolCall struct {
	ID       string `json:"id,omitempty"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type chatAssistantEnvelope struct {
	Role      string         `json:"role"`
	Content   *string        `json:"content"`
	ToolCalls []chatToolCall `json:"tool_calls,omitempty"`
}

type chatUsage struct {
	Prompt     int64 `json:"prompt_tokens"`
	Completion int64 `json:"completion_tokens"`
	Details    struct {
		Cached     int64 `json:"cached_tokens"`
		CacheWrite int64 `json:"cache_write_tokens"`
	} `json:"prompt_tokens_details"`
	// Compatibility placements used by DeepSeek and Kimi-style endpoints.
	PromptCacheHit int64 `json:"prompt_cache_hit_tokens"`
	Cached         int64 `json:"cached_tokens"`
}

type chatChunk struct {
	ID      string    `json:"id"`
	Usage   chatUsage `json:"usage"`
	Choices []struct {
		Index int `json:"index"`
		Delta struct {
			Content   *string         `json:"content"`
			ToolCalls []chatToolDelta `json:"tool_calls"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

type chatToolDelta struct {
	Index    *int   `json:"index"`
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type pendingChatTool struct {
	index     int
	id, name  string
	arguments strings.Builder
}

func (p *chatCompletionsProvider) Complete(ctx context.Context, req core.Request, cb func(core.StreamEvent)) (core.Response, error) {
	if req.MaxTokens <= 0 {
		req.MaxTokens = p.cfg.DefaultMaxTokens
	}
	if err := unsupported(req.Fast); err != nil {
		return core.Response{}, err
	}
	m := model(req, p.cfg.Model)
	if m == "" {
		return core.Response{}, errors.New("provider: model is required")
	}
	body, err := chatCompletionsBody(req, m, p.cfg.Kind)
	if err != nil {
		return core.Response{}, err
	}
	url := p.cfg.BaseURL
	if !strings.HasSuffix(url, "/chat/completions") {
		url += "/chat/completions"
	}
	resp, err := postJSON(ctx, p.cfg.HTTPClient, url, requestHeaders(map[string]string{"Authorization": "Bearer " + p.cfg.APIKey}, p.cfg.Headers), body)
	if err != nil {
		return core.Response{}, err
	}
	defer resp.Body.Close()

	var text strings.Builder
	pending := map[int]*pendingChatTool{}
	idToIndex := map[string]int{}
	var usage chatUsage
	var responseID, finish string
	sawFinish, sawDone := false, false
	err = readSSE(ctx, resp.Body, func(_ string, data []byte) error {
		if string(data) == "[DONE]" {
			sawDone = true
			return nil
		}
		if sawDone {
			return errors.New("provider: Chat Completions data after [DONE]")
		}
		var chunk chatChunk
		if err := json.Unmarshal(data, &chunk); err != nil {
			return errors.New("provider: invalid Chat Completions stream chunk")
		}
		if cb != nil {
			cb(core.StreamEvent{Type: "native", Data: json.RawMessage(append([]byte(nil), data...))})
		}
		if chunk.ID != "" {
			if responseID != "" && responseID != chunk.ID {
				return errors.New("provider: Chat Completions response id changed during stream")
			}
			responseID = chunk.ID
		}
		if chunk.Usage.Prompt != 0 || chunk.Usage.Completion != 0 || chunk.Usage.Details.Cached != 0 || chunk.Usage.Details.CacheWrite != 0 || chunk.Usage.PromptCacheHit != 0 || chunk.Usage.Cached != 0 {
			usage = chunk.Usage
		}
		for _, choice := range chunk.Choices {
			if choice.Index != 0 {
				continue
			}
			if choice.Delta.Content != nil {
				d := *choice.Delta.Content
				text.WriteString(d)
				if cb != nil && d != "" {
					cb(core.StreamEvent{Type: "text", Text: d})
				}
			}
			for _, delta := range choice.Delta.ToolCalls {
				idx, err := correlateChatTool(delta, pending, idToIndex)
				if err != nil {
					return err
				}
				t := pending[idx]
				if delta.ID != "" {
					if t.id != "" && t.id != delta.ID {
						return errors.New("provider: conflicting Chat Completions tool call id")
					}
					t.id = delta.ID
					idToIndex[delta.ID] = idx
				}
				if delta.Function.Name != "" {
					if t.name != "" && t.name != delta.Function.Name {
						return errors.New("provider: conflicting Chat Completions tool name")
					}
					t.name = delta.Function.Name
				}
				t.arguments.WriteString(delta.Function.Arguments)
			}
			if choice.FinishReason != nil {
				if sawFinish && finish != *choice.FinishReason {
					return errors.New("provider: conflicting Chat Completions finish_reason")
				}
				finish, sawFinish = *choice.FinishReason, true
			}
		}
		return nil
	})
	if err != nil {
		return core.Response{}, err
	}
	if err := ctx.Err(); err != nil {
		return core.Response{}, err
	}
	if !sawDone {
		return core.Response{}, errors.New("provider: Chat Completions stream ended before [DONE]")
	}
	if !sawFinish {
		return core.Response{}, errors.New("provider: Chat Completions stream ended without finish_reason")
	}

	stop, err := chatStopReason(finish)
	if err != nil {
		return core.Response{}, err
	}
	if len(pending) > 0 && stop != "tool" {
		return core.Response{}, errors.New("provider: tool deltas did not finish with tool_calls")
	}
	if stop == "tool" && len(pending) == 0 {
		return core.Response{}, errors.New("provider: tool_calls finish_reason without a tool call")
	}
	calls := make([]core.ToolCall, 0, len(pending))
	wireCalls := make([]chatToolCall, 0, len(pending))
	for i := 0; i < len(pending); i++ {
		t, ok := pending[i]
		if !ok {
			return core.Response{}, errors.New("provider: non-contiguous Chat Completions tool call indices")
		}
		args := t.arguments.String()
		if t.name == "" || args == "" || !json.Valid([]byte(args)) {
			return core.Response{}, errors.New("provider: incomplete Chat Completions tool call")
		}
		if t.id == "" {
			t.id = stableChatToolID(responseID, i, t.name, args)
		}
		calls = append(calls, core.ToolCall{ID: t.id, Name: t.name, Arguments: json.RawMessage(args)})
		w := chatToolCall{ID: t.id, Type: "function"}
		w.Function.Name, w.Function.Arguments = t.name, args
		wireCalls = append(wireCalls, w)
	}
	content := text.String()
	var nativeContent *string
	if content != "" || len(wireCalls) == 0 {
		nativeContent = &content
	}
	envelope := chatAssistantEnvelope{Role: "assistant", Content: nativeContent, ToolCalls: wireCalls}
	native, err := json.Marshal(envelope)
	if err != nil {
		return core.Response{}, err
	}
	cacheRead := usage.Details.Cached
	if cacheRead == 0 {
		cacheRead = usage.PromptCacheHit
	}
	if cacheRead == 0 {
		cacheRead = usage.Cached
	}
	uncached := usage.Prompt - cacheRead - usage.Details.CacheWrite
	if uncached < 0 {
		uncached = 0
	}
	outUsage := core.Usage{Input: uncached, Output: usage.Completion, CacheRead: cacheRead, CacheWrite: usage.Details.CacheWrite}
	applyUsageCost(p.cfg.Kind, m, &outUsage)
	return core.Response{Message: core.Message{Role: "assistant", Content: content, ToolCalls: calls, Native: native, Provider: p.cfg.Kind, Model: m}, Usage: outUsage, StopReason: stop, ResponseID: responseID}, nil
}

func correlateChatTool(d chatToolDelta, pending map[int]*pendingChatTool, ids map[string]int) (int, error) {
	if d.Index != nil {
		i := *d.Index
		if i < 0 {
			return 0, errors.New("provider: invalid Chat Completions tool call index")
		}
		if byID, ok := ids[d.ID]; d.ID != "" && ok && byID != i {
			return 0, errors.New("provider: conflicting Chat Completions tool correlation")
		}
		if _, ok := pending[i]; !ok {
			pending[i] = &pendingChatTool{index: i}
		}
		return i, nil
	}
	if d.ID != "" {
		if i, ok := ids[d.ID]; ok {
			return i, nil
		}
	}
	return 0, errors.New("provider: uncorrelated Chat Completions tool delta")
}

func stableChatToolID(responseID string, index int, name, arguments string) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%d\x00%s\x00%s", responseID, index, name, arguments)))
	return "call_" + hex.EncodeToString(h[:12])
}

func chatStopReason(reason string) (string, error) {
	switch reason {
	case "stop", "end":
		return "stop", nil
	case "length":
		return "length", nil
	case "tool_calls", "function_call":
		return "tool", nil
	case "content_filter", "network_error":
		return "", fmt.Errorf("provider: Chat Completions finish_reason: %s", reason)
	default:
		return "", fmt.Errorf("provider: unsupported Chat Completions finish_reason: %s", reason)
	}
}

func chatCompletionsBody(req core.Request, m, providerID string) (map[string]any, error) {
	messages := make([]any, 0, len(req.Messages)+1)
	if req.System != "" {
		messages = append(messages, map[string]any{"role": "system", "content": req.System})
	}
	for i := 0; i < len(req.Messages); i++ {
		msg := req.Messages[i]
		switch msg.Role {
		case "user":
			if len(msg.Images) == 0 {
				messages = append(messages, map[string]any{"role": "user", "content": msg.Content})
				continue
			}
			parts := make([]any, 0, len(msg.Images)+1)
			if msg.Content != "" {
				parts = append(parts, map[string]any{"type": "text", "text": msg.Content})
			}
			for _, im := range msg.Images {
				parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:" + im.MIME + ";base64," + im.Data}})
			}
			messages = append(messages, map[string]any{"role": "user", "content": parts})
		case "assistant":
			if len(msg.Native) > 0 && nativeReplayAllowed(msg, providerID, m) {
				var native map[string]any
				if json.Unmarshal(msg.Native, &native) == nil && native["role"] == "assistant" {
					messages = append(messages, native)
					continue
				}
			}
			a := map[string]any{"role": "assistant", "content": msg.Content}
			if len(msg.ToolCalls) > 0 {
				calls := make([]any, 0, len(msg.ToolCalls))
				for _, tc := range msg.ToolCalls {
					if tc.ID == "" || tc.Name == "" || !json.Valid(tc.Arguments) {
						return nil, errors.New("provider: invalid assistant tool call history")
					}
					calls = append(calls, map[string]any{"id": tc.ID, "type": "function", "function": map[string]any{"name": tc.Name, "arguments": string(tc.Arguments)}})
				}
				a["tool_calls"] = calls
				if msg.Content == "" {
					a["content"] = nil
				}
			}
			if msg.Content != "" || len(msg.ToolCalls) > 0 {
				messages = append(messages, a)
			}
		case "tool":
			// Keep consecutive tool results consecutive. Pi projects all of their
			// images in one following user message because the tool role cannot
			// carry multimodal content in Chat Completions.
			imageParts := []any{map[string]any{"type": "text", "text": "Attached image(s) from tool result:"}}
			for ; i < len(req.Messages) && req.Messages[i].Role == "tool"; i++ {
				tool := req.Messages[i]
				content := tool.Content
				if content == "" {
					if len(tool.Images) > 0 {
						content = "(see attached image)"
					} else {
						content = "(no tool output)"
					}
				}
				messages = append(messages, map[string]any{"role": "tool", "content": content, "tool_call_id": tool.ToolCallID})
				for _, im := range tool.Images {
					imageParts = append(imageParts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:" + im.MIME + ";base64," + im.Data}})
				}
			}
			i-- // outer loop advances to the first non-tool message
			if len(imageParts) > 1 {
				messages = append(messages, map[string]any{"role": "user", "content": imageParts})
			}
		}
	}
	body := map[string]any{"model": m, "messages": messages, "stream": true, "stream_options": map[string]any{"include_usage": true}, "tools": []any{map[string]any{"type": "function", "function": map[string]any{"name": "execute", "description": "Run JavaScript or TypeScript in the die tool runtime.", "parameters": map[string]any{"type": "object", "properties": map[string]any{"code": map[string]any{"type": "string"}, "timeoutSeconds": map[string]any{"type": "number"}}, "required": []string{"code"}, "additionalProperties": false}}}}}
	if req.MaxTokens > 0 {
		body["max_completion_tokens"] = req.MaxTokens
	}
	if req.Thinking != "" && req.Thinking != "off" && req.Thinking != "none" {
		body["reasoning_effort"] = req.Thinking
	}
	return body, nil
}
