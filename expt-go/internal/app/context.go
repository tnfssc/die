package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"godie/internal/core"
	"godie/internal/provider"
	"godie/internal/session"
	"time"
)

type shakeRecord struct {
	Version      int      `json:"version"`
	SessionID    string   `json:"sessionId"`
	AssistantIDs []string `json:"assistantEntryIds"`
	ResultIDs    []string `json:"toolResultEntryIds"`
	ShakenAt     int64    `json:"shakenAt"`
}

func projectMessages(s *session.Session) ([]core.Message, error) {
	entries, err := s.Branch()
	if err != nil {
		return nil, err
	}
	assist, results := map[string]bool{}, map[string]bool{}
	for _, e := range entries {
		if e.CustomType == "die-manual-shake" {
			var r shakeRecord
			if err := json.Unmarshal(e.Data, &r); err != nil || r.Version != 1 || r.AssistantIDs == nil || r.ResultIDs == nil {
				return nil, errors.New("invalid shake record; refusing unsafe projection")
			}
			for _, id := range r.AssistantIDs {
				assist[id] = true
			}
			for _, id := range r.ResultIDs {
				results[id] = true
			}
		}
	}
	out := []core.Message{}
	for _, e := range entries {
		if e.CustomType == "die-compaction" {
			var c compactionRecord
			if err := json.Unmarshal(e.Data, &c); err != nil || c.Version != 1 {
				return nil, errors.New("invalid compaction record")
			}
			out = []core.Message{c.Message}
			continue
		}
		if e.Message == nil || results[e.ID] {
			continue
		}
		m := *e.Message
		if assist[e.ID] {
			m.ToolCalls = nil
			m.Native = stripProtocol(m.Native)
			if m.Content == "" && len(m.Native) <= 2 {
				continue
			}
		}
		out = append(out, m)
	}
	return out, nil
}
func stripProtocol(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return nil
	}
	var items []json.RawMessage
	if json.Unmarshal(raw, &items) != nil {
		return nil
	}
	out := []json.RawMessage{}
	for _, item := range items {
		var h struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(item, &h) != nil {
			continue
		}
		switch h.Type {
		case "function_call", "tool_use", "thinking", "redacted_thinking", "reasoning":
			continue
		}
		out = append(out, item)
	}
	b, _ := json.Marshal(out)
	return b
}
func hasOpaqueCheckpoint(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return true
	}
	var scan func(any) bool
	scan = func(v any) bool {
		switch x := v.(type) {
		case map[string]any:
			if x["type"] == "compaction" || x["encrypted_content"] != nil && x["type"] != "reasoning" {
				return true
			}
			for _, v := range x {
				if scan(v) {
					return true
				}
			}
		case []any:
			for _, v := range x {
				if scan(v) {
					return true
				}
			}
		}
		return false
	}
	return scan(v)
}
func (a *Application) shake() (string, error) {
	if a.Runtime.Running() > 0 {
		return "", errors.New("cannot shake while jobs are running")
	}
	entries, err := a.Session.Branch()
	if err != nil {
		return "", err
	}
	calls, results := map[string]int{}, map[string]int{}
	assistIDs, resultIDs := []string{}, []string{}
	for i, e := range entries {
		if e.CustomType == "die-compaction" {
			var c compactionRecord
			if json.Unmarshal(e.Data, &c) != nil || hasOpaqueCheckpoint(c.Message.Native) {
				return "", errors.New("cannot shake an opaque native compaction checkpoint")
			}
		}
		if e.Message == nil {
			continue
		}
		m := e.Message
		if hasOpaqueCheckpoint(m.Native) {
			return "", errors.New("cannot shake an opaque native compaction checkpoint")
		}
		if m.Role == "assistant" {
			if len(m.ToolCalls) > 0 || len(m.Native) > 0 {
				assistIDs = append(assistIDs, e.ID)
			}
			for _, c := range m.ToolCalls {
				if c.ID == "" {
					return "", errors.New("invalid tool call ID")
				}
				if _, ok := calls[c.ID]; ok {
					return "", errors.New("ambiguous duplicate tool calls")
				}
				calls[c.ID] = i
			}
		}
		if m.Role == "tool" {
			if _, ok := results[m.ToolCallID]; ok {
				return "", errors.New("ambiguous duplicate tool results")
			}
			results[m.ToolCallID] = i
			resultIDs = append(resultIDs, e.ID)
		}
	}
	for id, i := range calls {
		j, ok := results[id]
		if !ok || j <= i {
			return "", errors.New("cannot shake unresolved execution batch")
		}
	}
	for id, j := range results {
		i, ok := calls[id]
		if !ok || j <= i {
			return "", errors.New("cannot shake orphan tool result")
		}
	}
	if len(assistIDs) == 0 && len(resultIDs) == 0 {
		return "Nothing to shake.", nil
	}
	r := shakeRecord{1, a.Session.ID(), assistIDs, resultIDs, time.Now().UnixMilli()}
	if _, err = a.Session.AppendCustom("die-manual-shake", r); err != nil {
		return "", err
	}
	return fmt.Sprintf("Shook execution protocol from %d assistant messages and %d tool results; transcript and usage retained.", len(assistIDs), len(resultIDs)), nil
}

type compactionRecord struct {
	Version  int          `json:"version"`
	Provider string       `json:"provider"`
	Model    string       `json:"model"`
	Leaf     string       `json:"leaf"`
	Message  core.Message `json:"message"`
	Usage    core.Usage   `json:"usage"`
	Native   bool         `json:"native"`
}

func (a *Application) compact(ctx context.Context) (string, error) {
	if a.Runtime.Running() > 0 {
		return "", errors.New("cannot compact with running jobs")
	}
	p, ok := a.Engine.Provider.(provider.Compactor)
	if !ok {
		return "", errors.New("provider compaction unavailable (offline or unsupported)")
	}
	req := a.Engine.Request
	messages, err := projectMessages(a.Session)
	if err != nil {
		return "", err
	}
	if len(messages) == 0 {
		return "Nothing to compact.", nil
	}
	req.Messages = messages
	if err := a.goalContext(&req); err != nil {
		return "", err
	}
	req.Fast = false
	leaf := a.Session.LeafID()
	response, err := p.Compact(ctx, req, nil)
	unchanged := leaf == a.Session.LeafID() && req.Model == a.Engine.Request.Model
	_, persistErr := a.Session.AppendCustom("provider_attempt", map[string]any{"model": req.Model, "kind": "compaction", "usage": response.Usage, "failed": err != nil})
	if persistErr != nil {
		return "", persistErr
	}
	if err != nil {
		return "", err
	}
	if !unchanged {
		return "", errors.New("session/model changed during compaction; checkpoint not committed (attempt retained)")
	}
	if len(response.Message.ToolCalls) > 0 {
		return "", errors.New("compaction returned tool calls; checkpoint rejected")
	}
	native := hasOpaqueCheckpoint(response.Message.Native)
	if !native {
		if response.Message.Content == "" {
			return "", errors.New("compaction returned empty checkpoint")
		}
		response.Message.Native = nil
		response.Message.Content = "Conversation checkpoint:\n" + response.Message.Content
	}
	record := compactionRecord{1, a.Options.Provider, req.Model, leaf, response.Message, response.Usage, native}
	if _, err = a.Session.AppendCustom("die-compaction", record); err != nil {
		return "", err
	}
	if native {
		return "Native compaction checkpoint committed; original transcript retained.", nil
	}
	return "Plaintext compaction checkpoint committed; original transcript retained.", nil
}
