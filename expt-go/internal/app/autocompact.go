package app

import (
	"context"
	"encoding/json"
	"errors"
	"godie/internal/core"
	"unicode/utf16"
)

// Matches Pi's chars/4 fallback (UTF-16 length, 4800 characters/image).
func estimateMessageTokens(m core.Message) int64 {
	chars := len(utf16.Encode([]rune(m.Content))) + 4800*len(m.Images)
	for _, c := range m.ToolCalls {
		chars += len(utf16.Encode([]rune(c.Name))) + len(utf16.Encode([]rune(string(c.Arguments))))
	}
	return int64((chars + 3) / 4)
}
func (a *Application) contextTokens(req core.Request) int64 {
	entries, err := a.Session.Branch()
	if err != nil {
		return 0
	}
	var measured int64
	trailing := int64(0)
	skipAssistant := false
	for _, e := range entries {
		if e.CustomType == "die-compaction" || e.CustomType == "die-manual-shake" {
			measured = 0
			trailing = 0
			skipAssistant = false
		}
		if e.CustomType == "provider_attempt" {
			var v struct {
				Model  string     `json:"model"`
				Usage  core.Usage `json:"usage"`
				Failed bool       `json:"failed"`
				Kind   string     `json:"kind"`
			}
			if json.Unmarshal(e.Data, &v) == nil && !v.Failed && v.Kind != "compaction" && v.Model == req.Model && v.Usage.Input+v.Usage.Output > 0 {
				measured = v.Usage.Input + v.Usage.Output + v.Usage.CacheRead + v.Usage.CacheWrite
				trailing = 0
				skipAssistant = true
			}
		}
		if e.Message != nil {
			if skipAssistant && e.Message.Role == "assistant" {
				skipAssistant = false
				continue
			}
			trailing += estimateMessageTokens(*e.Message)
		}
	}
	if measured > 0 {
		return measured + trailing
	}
	var estimated int64
	for _, m := range req.Messages {
		estimated += estimateMessageTokens(m)
	}
	return estimated
}
func (a *Application) autoPrepare(ctx context.Context, req *core.Request) error {
	if a.Options.Offline {
		return nil
	}
	window, err := configuredContextWindow(a.Options.StateDir, a.Options.Provider, req.Model)
	if err != nil {
		return err
	}
	if window <= 16384 || a.contextTokens(*req) <= int64(window-16384) {
		return nil
	}
	if a.Runtime.Running() > 0 {
		return errors.New("context requires compaction but owned jobs are running; wait for completion before retrying")
	}
	if _, err := a.compact(ctx); err != nil {
		return err
	}
	messages, err := projectMessages(a.Session)
	if err != nil {
		return err
	}
	req.Messages = messages
	return a.goalContext(req)
}
