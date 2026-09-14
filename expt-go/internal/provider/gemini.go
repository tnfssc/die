package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"godie/internal/core"
	"net/url"
	"strconv"
	"strings"
)

type geminiProvider struct{ cfg Config }

func (p *geminiProvider) Complete(ctx context.Context, req core.Request, cb func(core.StreamEvent)) (core.Response, error) {
	if err := unsupported(req.Fast); err != nil {
		return core.Response{}, err
	}
	providerID := p.cfg.Kind
	if providerID == "" {
		providerID = "gemini"
	}
	m := model(req, p.cfg.Model)
	if m == "" {
		return core.Response{}, errors.New("provider: model is required")
	}
	contents := []any{}
	for _, x := range req.Messages {
		if x.Role == "assistant" && containsCompactionCheckpoint(x.Native) && !nativeReplayAllowed(x, providerID, m) {
			return core.Response{}, errors.New("provider: opaque checkpoint provider/model mismatch")
		}
		role := "user"
		if x.Role == "assistant" {
			role = "model"
		}
		if x.Role == "assistant" && len(x.Native) > 0 && nativeReplayAllowed(x, providerID, m) {
			var native map[string]any
			if json.Unmarshal(x.Native, &native) == nil {
				contents = append(contents, native)
				continue
			}
		}
		parts := []any{}
		switch x.Role {
		case "user":
			if x.Content != "" {
				parts = append(parts, map[string]any{"text": x.Content})
			}
			for _, im := range x.Images {
				parts = append(parts, map[string]any{"inlineData": map[string]any{"mimeType": im.MIME, "data": im.Data}})
			}
		case "assistant":
			if x.Content != "" {
				parts = append(parts, map[string]any{"text": x.Content})
			}
			for _, tc := range x.ToolCalls {
				var args any
				json.Unmarshal(tc.Arguments, &args)
				call := map[string]any{"name": tc.Name, "args": args}
				if geminiRequiresToolCallID(m) {
					call["id"] = tc.ID
				}
				parts = append(parts, map[string]any{"functionCall": call})
			}
		case "tool":
			responseValue := x.Content
			if responseValue == "" && len(x.Images) > 0 {
				responseValue = "(see attached image)"
			}
			functionResponse := map[string]any{"name": "execute", "response": map[string]any{"output": responseValue}}
			if geminiRequiresToolCallID(m) {
				functionResponse["id"] = x.ToolCallID
			}
			imageParts := []any{}
			for _, im := range x.Images {
				imageParts = append(imageParts, map[string]any{"inlineData": map[string]any{"mimeType": im.MIME, "data": im.Data}})
			}
			if len(imageParts) > 0 && geminiMultimodalFunctionResponse(m) {
				functionResponse["parts"] = imageParts
			}
			parts = append(parts, map[string]any{"functionResponse": functionResponse})
			if len(imageParts) > 0 && !geminiMultimodalFunctionResponse(m) {
				contents = append(contents, map[string]any{"role": role, "parts": parts})
				contents = append(contents, map[string]any{"role": "user", "parts": append([]any{map[string]any{"text": "Tool result image:"}}, imageParts...)})
				continue
			}
		}
		contents = append(contents, map[string]any{"role": role, "parts": parts})
	}
	body := map[string]any{"contents": contents, "tools": []any{map[string]any{"functionDeclarations": []any{map[string]any{"name": "execute", "description": "Run JavaScript or TypeScript in the die tool runtime.", "parameters": map[string]any{"type": "OBJECT", "properties": map[string]any{"code": map[string]any{"type": "STRING"}, "timeoutSeconds": map[string]any{"type": "NUMBER"}}, "required": []string{"code"}}}}}}}
	if req.System != "" {
		body["systemInstruction"] = map[string]any{"parts": []any{map[string]any{"text": req.System}}}
	}
	generationConfig := map[string]any{}
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = p.cfg.DefaultMaxTokens
	}
	if maxTokens > 0 {
		generationConfig["maxOutputTokens"] = maxTokens
	}
	if err := configureGeminiThinking(generationConfig, m, req.Thinking); err != nil {
		return core.Response{}, err
	}
	body["generationConfig"] = generationConfig
	endpoint := fmt.Sprintf("%s/models/%s:streamGenerateContent?alt=sse", strings.TrimRight(p.cfg.BaseURL, "/"), url.PathEscape(m))
	resp, err := postJSON(ctx, p.cfg.HTTPClient, endpoint, requestHeaders(map[string]string{"Accept": "text/event-stream", "x-goog-api-key": p.cfg.APIKey}, p.cfg.Headers), body)
	if err != nil {
		return core.Response{}, err
	}
	defer resp.Body.Close()
	var text strings.Builder
	var native map[string]any
	var nativeParts []any
	var calls []core.ToolCall
	var usage core.Usage
	finish := ""
	chosenSet := false
	chosenIndex := 0
	toolOrdinal := 0
	toolIDs := map[string]bool{}
	err = readSSE(ctx, resp.Body, func(_ string, data []byte) error {
		var chunk struct {
			Candidates []struct {
				Index   *int           `json:"index"`
				Content map[string]any `json:"content"`
				Finish  string         `json:"finishReason"`
			} `json:"candidates"`
			Usage struct {
				Prompt     int64 `json:"promptTokenCount"`
				Candidates int64 `json:"candidatesTokenCount"`
				Cached     int64 `json:"cachedContentTokenCount"`
				Thoughts   int64 `json:"thoughtsTokenCount"`
			} `json:"usageMetadata"`
		}
		if json.Unmarshal(data, &chunk) != nil {
			return errors.New("provider: invalid Gemini stream event")
		}
		if cb != nil {
			cb(core.StreamEvent{Type: "native", Data: json.RawMessage(append([]byte(nil), data...))})
		}
		if chunk.Usage.Prompt != 0 || chunk.Usage.Cached != 0 || chunk.Usage.Candidates != 0 || chunk.Usage.Thoughts != 0 {
			usage.Input = chunk.Usage.Prompt - chunk.Usage.Cached
			if usage.Input < 0 {
				return errors.New("provider: invalid Gemini usage accounting")
			}
			usage.Output = chunk.Usage.Candidates + chunk.Usage.Thoughts
			usage.CacheRead = chunk.Usage.Cached
		}
		var cand *struct {
			Index   *int           `json:"index"`
			Content map[string]any `json:"content"`
			Finish  string         `json:"finishReason"`
		}
		if !chosenSet && len(chunk.Candidates) > 0 {
			chosenSet = true
			if chunk.Candidates[0].Index != nil {
				chosenIndex = *chunk.Candidates[0].Index
			}
		}
		for i := range chunk.Candidates {
			idx := 0
			if chunk.Candidates[i].Index != nil {
				idx = *chunk.Candidates[i].Index
			}
			if (chunk.Candidates[i].Index == nil && i == 0) || idx == chosenIndex {
				cand = &chunk.Candidates[i]
				break
			}
		}
		if cand == nil {
			return nil
		}
		if cand.Content != nil {
			if native == nil {
				native = map[string]any{"role": "model"}
			}
			if role, ok := cand.Content["role"]; ok {
				native["role"] = role
			}
			parts, _ := cand.Content["parts"].([]any)
			for _, pv := range parts {
				part, ok := pv.(map[string]any)
				if !ok {
					continue
				}
				if d, _ := part["text"].(string); d != "" && part["thought"] != true {
					text.WriteString(d)
					if cb != nil {
						cb(core.StreamEvent{Type: "text", Text: d})
					}
				}
				if f, _ := part["functionCall"].(map[string]any); f != nil {
					id, _ := f["id"].(string)
					name, _ := f["name"].(string)
					if id == "" || toolIDs[id] {
						for {
							toolOrdinal++
							id = fmt.Sprintf("%s_%d", stableGeminiToolName(name), toolOrdinal)
							if !toolIDs[id] {
								break
							}
						}
						if geminiRequiresToolCallID(m) {
							f["id"] = id
						}
					}
					toolIDs[id] = true
					argValue, exists := f["args"]
					if !exists || argValue == nil {
						argValue = map[string]any{}
						f["args"] = argValue
					}
					if name == "" {
						return errors.New("provider: invalid Gemini function call")
					}
					if _, ok := argValue.(map[string]any); !ok {
						return errors.New("provider: invalid Gemini function arguments")
					}
					args, marshalErr := json.Marshal(argValue)
					if marshalErr != nil {
						return errors.New("provider: invalid Gemini function arguments")
					}
					calls = append(calls, core.ToolCall{ID: id, Name: name, Arguments: args})
				}
				nativeParts = append(nativeParts, part)
			}
		}
		if cand.Finish != "" {
			finish = strings.ToLower(cand.Finish)
		}
		return nil
	})
	if err != nil {
		applyUsageCost("gemini", m, &usage)
		return core.Response{Usage: usage}, err
	}
	if finish == "" {
		applyUsageCost("gemini", m, &usage)
		return core.Response{Usage: usage}, errors.New("provider: Gemini stream ended without a finish reason")
	}
	if finish != "stop" && finish != "max_tokens" {
		applyUsageCost("gemini", m, &usage)
		return core.Response{Usage: usage}, errors.New("provider: Gemini stopped with " + finish)
	}
	if native == nil {
		native = map[string]any{"role": "model"}
	}
	native["parts"] = nativeParts
	raw, marshalErr := json.Marshal(native)
	if marshalErr != nil {
		return core.Response{Usage: usage}, marshalErr
	}
	stop := "stop"
	if finish == "max_tokens" {
		stop = "length"
	}
	if len(calls) > 0 && stop == "stop" {
		stop = "tool"
	}
	applyUsageCost("gemini", m, &usage)
	return core.Response{Message: core.Message{Role: "assistant", Content: text.String(), ToolCalls: calls, Native: raw, Provider: providerID, Model: m}, Usage: usage, StopReason: stop}, nil
}

// Gemini 3 and newer support images directly inside functionResponse.parts.
// Earlier Gemini models require a correlated function response followed by a user image turn.
func geminiMultimodalFunctionResponse(model string) bool {
	lower := strings.ToLower(model)
	var rest string
	switch {
	case strings.HasPrefix(lower, "gemini-live-"):
		rest = strings.TrimPrefix(lower, "gemini-live-")
	case strings.HasPrefix(lower, "gemini-"):
		rest = strings.TrimPrefix(lower, "gemini-")
	default:
		return true
	}
	end := strings.IndexByte(rest, '.')
	if end < 0 {
		end = strings.IndexByte(rest, '-')
	}
	if end < 0 {
		end = len(rest)
	}
	major, err := strconv.Atoi(rest[:end])
	return err != nil || major >= 3
}

func geminiRequiresToolCallID(model string) bool {
	lower := strings.ToLower(model)
	if strings.HasPrefix(lower, "claude-") || strings.HasPrefix(lower, "gpt-oss-") {
		return true
	}
	var rest string
	if strings.HasPrefix(lower, "gemini-live-") {
		rest = strings.TrimPrefix(lower, "gemini-live-")
	} else if strings.HasPrefix(lower, "gemini-") {
		rest = strings.TrimPrefix(lower, "gemini-")
	} else {
		return false
	}
	end := strings.IndexAny(rest, ".-")
	if end < 0 {
		end = len(rest)
	}
	major, err := strconv.Atoi(rest[:end])
	return err == nil && major >= 3
}

func stableGeminiToolName(name string) string {
	var b strings.Builder
	for _, r := range name {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	if b.Len() == 0 {
		return "tool"
	}
	return b.String()
}

func configureGeminiThinking(config map[string]any, model, level string) error {
	lower := strings.ToLower(model)
	is3Pro := strings.Contains(lower, "gemini-3") && strings.Contains(lower, "pro")
	is3Flash := strings.Contains(lower, "gemini-3") && strings.Contains(lower, "flash")
	if level == "" || level == "none" || level == "off" {
		if is3Pro {
			config["thinkingConfig"] = map[string]any{"thinkingLevel": "LOW"}
		} else if is3Flash || strings.Contains(lower, "gemma-4") {
			config["thinkingConfig"] = map[string]any{"thinkingLevel": "MINIMAL"}
		} else {
			config["thinkingConfig"] = map[string]any{"thinkingBudget": 0}
		}
		return nil
	}
	valid := map[string]bool{"minimal": true, "low": true, "medium": true, "high": true}
	if !valid[level] {
		return errors.New("provider: unsupported Gemini thinking level: " + level)
	}
	t := map[string]any{"includeThoughts": true}
	if strings.Contains(lower, "gemini-3") || strings.Contains(lower, "gemma-4") {
		mapped := strings.ToUpper(level)
		if is3Pro && (level == "minimal" || level == "low") {
			mapped = "LOW"
		}
		if is3Pro && (level == "medium" || level == "high") {
			mapped = "HIGH"
		}
		if strings.Contains(lower, "gemma-4") && (level == "minimal" || level == "low") {
			mapped = "MINIMAL"
		}
		if strings.Contains(lower, "gemma-4") && (level == "medium" || level == "high") {
			mapped = "HIGH"
		}
		t["thinkingLevel"] = mapped
	} else if strings.Contains(lower, "2.5-pro") {
		t["thinkingBudget"] = map[string]int{"minimal": 128, "low": 2048, "medium": 8192, "high": 32768}[level]
	} else if strings.Contains(lower, "2.5-flash-lite") {
		t["thinkingBudget"] = map[string]int{"minimal": 512, "low": 2048, "medium": 8192, "high": 24576}[level]
	} else if strings.Contains(lower, "2.5-flash") {
		t["thinkingBudget"] = map[string]int{"minimal": 128, "low": 2048, "medium": 8192, "high": 24576}[level]
	} else {
		return errors.New("provider: Gemini thinking level unsupported for model " + model)
	}
	config["thinkingConfig"] = t
	return nil
}
