package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"

	"godie/internal/core"
)

const portableCompactionPrompt = "Create a precise continuation checkpoint for this conversation. Preserve goals, constraints, decisions, completed work, pending work, file paths, and exact identifiers needed to continue. Do not continue the task; output only the checkpoint."

func portableCompact(ctx context.Context, p core.Provider, fallback string, req core.Request, cb func(core.StreamEvent)) (core.Response, error) {
	m := model(req, fallback)
	if m == "" {
		return core.Response{}, errors.New("provider: model is required for compaction")
	}
	req.Model = m // pin the identity used by the checkpoint
	req.Fast = false
	req.Messages = append(append([]core.Message(nil), req.Messages...), core.Message{Role: "user", Content: portableCompactionPrompt})
	return p.Complete(withStandardTier(ctx), req, cb)
}

func (p *openAIProvider) Compact(ctx context.Context, req core.Request, cb func(core.StreamEvent)) (core.Response, error) {
	return portableCompact(ctx, p, p.cfg.Model, req, cb)
}
func (p *anthropicProvider) Compact(ctx context.Context, req core.Request, cb func(core.StreamEvent)) (core.Response, error) {
	return portableCompact(ctx, p, p.cfg.Model, req, cb)
}
func (p *geminiProvider) Compact(ctx context.Context, req core.Request, cb func(core.StreamEvent)) (core.Response, error) {
	return portableCompact(ctx, p, p.cfg.Model, req, cb)
}

type codexCompactionItem struct {
	Type             string `json:"type"`
	ID               string `json:"id"`
	EncryptedContent string `json:"encrypted_content"`
}

func nativeReplayAllowed(message core.Message, providerID, modelID string) bool {
	if message.Provider == providerID && message.Model == modelID {
		return true
	}
	// Legacy ordinary native messages had no identity metadata. They remain
	// replayable, but an opaque compaction item is never accepted unscoped.
	if message.Provider != "" || message.Model != "" || containsCompactionCheckpoint(message.Native) {
		return false
	}
	return true
}

func containsCompactionCheckpoint(raw json.RawMessage) bool {
	var sequence []json.RawMessage
	if json.Unmarshal(raw, &sequence) != nil {
		return false
	}
	for _, item := range sequence {
		var header struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(item, &header) == nil && header.Type == "compaction" {
			return true
		}
	}
	return false
}

func validCompactionItem(raw json.RawMessage) (codexCompactionItem, bool) {
	var fields map[string]json.RawMessage
	var item codexCompactionItem
	if json.Unmarshal(raw, &fields) != nil || len(fields) != 3 || json.Unmarshal(raw, &item) != nil {
		return item, false
	}
	return item, item.Type == "compaction" && strings.HasPrefix(item.ID, "cmp_") && item.ID != "cmp_" && strings.TrimSpace(item.EncryptedContent) != ""
}

func codexResponsesURL(base string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if strings.HasSuffix(base, "/codex/responses") {
		return base
	}
	if strings.HasSuffix(base, "/codex") {
		return base + "/responses"
	}
	return base + "/codex/responses"
}

// Compact invokes Codex native remote-v2 compaction. It never falls back to a
// summary completion: callers can choose a separate provider Compactor instead.
func (p *codexProvider) Compact(ctx context.Context, req core.Request, cb func(core.StreamEvent)) (core.Response, error) {
	m := model(req, p.cfg.Model)
	if m == "" {
		return core.Response{}, errors.New("provider: model is required for Codex native compaction")
	}
	req.Model, req.Fast = m, false
	body, err := responsesBody(req, m, "openai-codex")
	if err != nil {
		return core.Response{}, err
	}
	input, ok := body["input"].([]any)
	if !ok {
		return core.Response{}, errors.New("provider: invalid Codex compaction input")
	}
	for _, value := range input {
		if object, ok := value.(map[string]any); ok && object["type"] == "compaction_trigger" {
			return core.Response{}, errors.New("provider: Codex compaction input already contains a trigger")
		}
	}
	body["input"] = append(input, map[string]any{"type": "compaction_trigger"})
	body["service_tier"] = "default"
	body["stream"], body["store"] = true, false

	token, err := p.token(ctx)
	if err != nil {
		return core.Response{}, err
	}
	account, err := jwtAccountID(token)
	if err != nil {
		return core.Response{}, err
	}
	headers := codexHeaders(token, account, req.SessionID)
	resp, err := postJSON(ctx, p.cfg.HTTPClient, codexResponsesURL(p.cfg.BaseURL), headers, body)
	if err != nil {
		return core.Response{}, err
	}
	defer resp.Body.Close()
	return consumeCodexCompaction(ctx, resp.Body, cb, m)
}

type compactionTerminal struct {
	ID     string            `json:"id"`
	Status string            `json:"status"`
	Output []json.RawMessage `json:"output"`
	Usage  *struct {
		Input        int64  `json:"input_tokens"`
		Output       int64  `json:"output_tokens"`
		Total        *int64 `json:"total_tokens"`
		InputDetails struct {
			Cached     int64 `json:"cached_tokens"`
			CacheWrite int64 `json:"cache_write_tokens"`
		} `json:"input_tokens_details"`
		OutputDetails struct {
			Reasoning int64 `json:"reasoning_tokens"`
		} `json:"output_tokens_details"`
	} `json:"usage"`
}

func consumeCodexCompaction(ctx context.Context, r io.Reader, cb func(core.StreamEvent), modelID string) (core.Response, error) {
	var terminal *compactionTerminal
	var terminalType string
	var done []json.RawMessage
	err := readSSE(ctx, r, func(event string, data []byte) error {
		if string(data) == "[DONE]" {
			return nil
		}
		var envelope struct {
			Type     string          `json:"type"`
			Item     json.RawMessage `json:"item"`
			Response json.RawMessage `json:"response"`
		}
		if json.Unmarshal(data, &envelope) != nil {
			return errors.New("provider: malformed Codex compaction event")
		}
		if envelope.Type == "" {
			envelope.Type = event
		}
		if cb != nil {
			cb(core.StreamEvent{Type: "native", Data: json.RawMessage(append([]byte(nil), data...))})
		}
		switch envelope.Type {
		case "response.output_item.done":
			if _, ok := validCompactionItem(envelope.Item); !ok {
				return errors.New("provider: Codex compaction returned unsupported output")
			}
			done = append(done, append(json.RawMessage(nil), envelope.Item...))
		case "response.completed", "response.done":
			if terminal != nil {
				return errors.New("provider: Codex compaction returned multiple terminal events")
			}
			var value compactionTerminal
			if len(envelope.Response) == 0 || json.Unmarshal(envelope.Response, &value) != nil {
				return errors.New("provider: invalid Codex compaction terminal event")
			}
			terminal, terminalType = &value, envelope.Type
		case "error", "response.failed", "response.cancelled", "response.incomplete":
			return errors.New("provider: Codex native compaction did not complete")
		}
		return nil
	})
	if err != nil {
		return core.Response{}, err
	}
	if terminal == nil || (terminalType != "response.completed" && terminalType != "response.done") || terminal.Status != "completed" {
		return core.Response{}, errors.New("provider: Codex native compaction did not complete")
	}
	if terminal.Usage == nil || terminal.Usage.Input < 0 || terminal.Usage.Output < 0 || terminal.Usage.InputDetails.Cached < 0 || terminal.Usage.InputDetails.CacheWrite < 0 || terminal.Usage.InputDetails.Cached+terminal.Usage.InputDetails.CacheWrite > terminal.Usage.Input || terminal.Usage.OutputDetails.Reasoning < 0 || terminal.Usage.OutputDetails.Reasoning > terminal.Usage.Output || (terminal.Usage.Total != nil && (*terminal.Usage.Total < 0 || *terminal.Usage.Total < terminal.Usage.Input+terminal.Usage.Output)) {
		return core.Response{}, errors.New("provider: invalid Codex compaction accounting")
	}
	var raw json.RawMessage
	if len(terminal.Output) == 1 {
		raw = terminal.Output[0]
	} else if len(terminal.Output) == 0 && len(done) == 1 {
		raw = done[0]
	} else {
		return core.Response{}, fmt.Errorf("provider: invalid Codex compaction item set (terminal=%d streamed=%d)", len(terminal.Output), len(done))
	}
	if _, ok := validCompactionItem(raw); !ok {
		return core.Response{}, errors.New("provider: Codex compaction returned invalid opaque checkpoint")
	}
	var canonical any
	_ = json.Unmarshal(raw, &canonical)
	for _, streamed := range done {
		var v any
		_ = json.Unmarshal(streamed, &v)
		if !reflect.DeepEqual(v, canonical) {
			return core.Response{}, errors.New("provider: Codex compaction item representations disagree")
		}
	}
	native, _ := json.Marshal([]json.RawMessage{raw})
	usage := core.Usage{Input: terminal.Usage.Input - terminal.Usage.InputDetails.Cached - terminal.Usage.InputDetails.CacheWrite, Output: terminal.Usage.Output, CacheRead: terminal.Usage.InputDetails.Cached, CacheWrite: terminal.Usage.InputDetails.CacheWrite}
	applyUsageCost("openai-codex", modelID, &usage)
	return core.Response{Message: core.Message{Role: "assistant", Native: native, Provider: "openai-codex", Model: modelID}, Usage: usage, StopReason: "stop", ResponseID: terminal.ID}, nil
}
