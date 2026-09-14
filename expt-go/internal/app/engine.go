package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"godie/internal/core"
	"strings"
	"sync"
	"time"
)

// Journal is deliberately narrower than the session implementation. Native
// provider envelopes must survive AppendMessage/Messages unchanged.
type Journal interface {
	Messages() ([]core.Message, error)
	AppendMessage(core.Message) error
	Record(string, any) error
}
type Engine struct {
	Provider        core.Provider
	Executor        core.Executor
	Journal         Journal
	Request         core.Request
	MaxTurns        int
	ToolConcurrency int
	BeforeRequest   func(*core.Request) error
	AutoPrepare     func(context.Context, *core.Request) error
	OnResponse      func(core.Request, time.Time)
	InitialImages   []core.Image
	mu              sync.Mutex
	queueMu         sync.Mutex
	queueRunning    bool
	steer           []string
	followUp        []string
	cancelMu        sync.Mutex
	cancel          context.CancelFunc
}

// Turn owns one complete provider/tool cycle. Jobs are owned outside this call;
// a handoff ends this turn, never the session or its background work.
func (e *Engine) Turn(ctx context.Context, text string, emit func(core.StreamEvent)) error {
	return e.turn(ctx, text, false, emit)
}
func (e *Engine) TurnHidden(ctx context.Context, text string, emit func(core.StreamEvent)) error {
	return e.turn(ctx, text, true, emit)
}
func (e *Engine) Cancel() {
	e.cancelMu.Lock()
	defer e.cancelMu.Unlock()
	if e.cancel != nil {
		e.cancel()
	}
}
func (e *Engine) turn(ctx context.Context, text string, hidden bool, emit func(core.StreamEvent)) (retErr error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.queueMu.Lock()
	e.queueRunning = true
	e.queueMu.Unlock()
	defer func() { e.queueMu.Lock(); e.queueRunning = false; e.queueMu.Unlock() }()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	e.cancelMu.Lock()
	e.cancel = cancel
	e.cancelMu.Unlock()
	defer func() { e.cancelMu.Lock(); e.cancel = nil; e.cancelMu.Unlock() }()
	if emit == nil {
		emit = func(core.StreamEvent) {}
	}
	defer func() {
		if retErr != nil {
			emit(core.StreamEvent{Type: "error", Text: retErr.Error()})
			emit(core.StreamEvent{Type: "turn_end"})
		}
	}()
	if text != "" {
		for _, old := range e.takeQueued(true) {
			if err := e.Journal.AppendMessage(core.Message{Role: "user", Content: old}); err != nil {
				return err
			}
		}
		images := []core.Image(nil)
		if !hidden && len(e.InitialImages) > 0 {
			images = e.InitialImages
		}
		if err := e.Journal.AppendMessage(core.Message{Role: "user", Content: text, Hidden: hidden, Images: images}); err != nil {
			return err
		}
		if images != nil {
			e.InitialImages = nil
		}
	}
	limit := e.MaxTurns
	if limit <= 0 {
		limit = 100
	}
	for turn := 0; turn < limit; turn++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		for _, queued := range e.takeQueued(false) {
			if err := e.Journal.AppendMessage(core.Message{Role: "user", Content: queued}); err != nil {
				return err
			}
		}
		req := e.Request
		var projectErr error
		req.Messages, projectErr = e.Journal.Messages()
		if projectErr != nil {
			return projectErr
		}
		if e.BeforeRequest != nil {
			if err := e.BeforeRequest(&req); err != nil {
				return err
			}
		}
		if e.AutoPrepare != nil {
			if err := e.AutoPrepare(ctx, &req); err != nil {
				return err
			}
		}
		emit(core.StreamEvent{Type: "turn_start"})
		started := time.Now()
		var observeOnce sync.Once
		response, err := e.Provider.Complete(ctx, req, func(event core.StreamEvent) {
			observeOnce.Do(func() {
				if e.OnResponse != nil {
					e.OnResponse(req, time.Now())
				}
			})
			emit(event)
		})
		// Usage/attempt provenance is retained even when a request failed.
		if persistErr := e.Journal.Record("provider_attempt", map[string]any{"model": req.Model, "provider": req.Provider, "startedAt": started.UTC(), "durationMs": time.Since(started).Milliseconds(), "usage": response.Usage, "failed": err != nil}); persistErr != nil {
			return persistErr
		}
		if err != nil {
			return err
		}
		if response.Message.Role == "" {
			response.Message.Role = "assistant"
		}
		if err = e.Journal.AppendMessage(response.Message); err != nil {
			return err
		}
		emit(core.StreamEvent{Type: "message", Data: response.Message})
		calls := response.Message.ToolCalls
		if len(calls) == 0 {
			if e.hasQueuedNext() {
				continue
			}
			emit(core.StreamEvent{Type: "turn_end", Data: response.Usage})
			return nil
		}
		results := make([]core.ExecuteResult, len(calls))
		errs := make([]error, len(calls))
		workers := e.ToolConcurrency
		if workers <= 0 {
			workers = 8
		}
		sem := make(chan struct{}, workers)
		var wg sync.WaitGroup
		for i, call := range calls {
			wg.Add(1)
			go func(i int, call core.ToolCall) {
				defer wg.Done()
				select {
				case sem <- struct{}{}:
				case <-ctx.Done():
					errs[i] = ctx.Err()
					return
				}
				defer func() { <-sem }()
				if call.Name != "execute" {
					errs[i] = fmt.Errorf("unknown tool %q: only execute is available", call.Name)
					return
				}
				var args struct {
					Code           string  `json:"code"`
					TimeoutSeconds float64 `json:"timeoutSeconds"`
				}
				if err := json.Unmarshal(call.Arguments, &args); err != nil {
					errs[i] = fmt.Errorf("invalid execute arguments: %w", err)
					return
				}
				if strings.TrimSpace(args.Code) == "" {
					errs[i] = errors.New("execute code must not be empty")
					return
				}
				if args.TimeoutSeconds < 0 || args.TimeoutSeconds > 86400 {
					errs[i] = errors.New("execute timeoutSeconds out of range")
					return
				}
				emit(core.StreamEvent{Type: "tool_start", Data: call})
				results[i], errs[i] = e.Executor.Execute(ctx, args.Code, time.Duration(args.TimeoutSeconds*float64(time.Second)))
			}(i, call)
		}
		wg.Wait()
		allHandoff := len(calls) > 0
		for i, call := range calls {
			r := results[i]
			if errs[i] != nil {
				r.Error = errs[i].Error()
				r.ExitCode = 1
			}
			allHandoff = allHandoff && r.Handoff
			textResult := r
			textResult.Images = nil
			raw, _ := json.Marshal(textResult)
			if err = e.Journal.AppendMessage(core.Message{Role: "tool", ToolCallID: call.ID, Content: string(raw), Images: r.Images}); err != nil {
				return err
			}
			emit(core.StreamEvent{Type: "tool_end", Data: map[string]any{"id": call.ID, "result": r}})
			if r.Handoff && r.HandoffMessage != "" {
				emit(core.StreamEvent{Type: "handoff", Text: r.HandoffMessage})
			}
		}
		if allHandoff {
			if e.hasQueuedNext() {
				continue
			}
			emit(core.StreamEvent{Type: "turn_end"})
			return nil
		}
	}
	return fmt.Errorf("turn limit (%d) reached; conversation is saved", limit)
}

// Enqueue accepts steering only while a turn owns the engine. Follow-ups wait
// for the tool loop to settle; steering enters the next provider boundary.
func (e *Engine) Enqueue(text string, followUp bool) bool {
	if strings.TrimSpace(text) == "" {
		return false
	}
	e.queueMu.Lock()
	defer e.queueMu.Unlock()
	if !e.queueRunning {
		return false
	}
	if followUp {
		e.followUp = append(e.followUp, text)
	} else {
		e.steer = append(e.steer, text)
	}
	return true
}
func (e *Engine) takeQueued(includeFollow bool) []string {
	e.queueMu.Lock()
	defer e.queueMu.Unlock()
	out := e.steer
	e.steer = nil
	if includeFollow {
		out = append(out, e.followUp...)
		e.followUp = nil
	}
	return out
}
func (e *Engine) hasQueuedNext() bool {
	e.queueMu.Lock()
	defer e.queueMu.Unlock()
	if len(e.followUp) > 0 {
		e.steer = append(e.steer, e.followUp...)
		e.followUp = nil
	}
	if len(e.steer) > 0 {
		return true
	}
	e.queueRunning = false
	return false
}
