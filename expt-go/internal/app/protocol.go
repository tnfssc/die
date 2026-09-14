package app

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"godie/internal/core"
	"io"
	"strings"
	"sync"
	"time"
)

type JSONEmitter struct {
	mu                                                       sync.Mutex
	w                                                        io.Writer
	app                                                      *Application
	enc                                                      *json.Encoder
	err                                                      error
	header, started, userSent, assistantStarted, textStarted bool
	pendingUser                                              string
	textContent                                              strings.Builder
	textIndex                                                int
	lastAssistant                                            map[string]any
	messages                                                 []any
	calls                                                    []core.ToolCall
	callStarted, callEmitted                                 map[string]bool
	toolResults                                              []any
}

func NewJSONEmitter(w io.Writer, a *Application) *JSONEmitter {
	return &JSONEmitter{w: w, app: a, enc: json.NewEncoder(w), callStarted: map[string]bool{}, callEmitted: map[string]bool{}}
}
func (e *JSONEmitter) write(v any) {
	if e.err == nil {
		e.err = e.enc.Encode(v)
	}
}
func (e *JSONEmitter) Err() error { e.mu.Lock(); defer e.mu.Unlock(); return e.err }
func (e *JSONEmitter) Start(text string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.header {
		h := map[string]any{"type": "session", "version": 3, "id": "", "timestamp": time.Now().UTC().Format(time.RFC3339Nano), "cwd": ""}
		if e.app != nil && e.app.Session != nil {
			sh := e.app.Session.Header()
			h["id"], h["timestamp"], h["cwd"] = sh.ID, sh.Timestamp, sh.CWD
		}
		e.write(h)
		e.header = true
	}
	e.startLocked(text)
}
func (e *JSONEmitter) startLocked(text string) {
	e.pendingUser = text
	e.userSent = false
	e.assistantStarted = false
	e.textStarted = false
	e.textIndex = 0
	e.textContent.Reset()
	e.lastAssistant = nil
	e.calls = nil
	e.toolResults = nil
	e.messages = nil
	e.callStarted = map[string]bool{}
	e.callEmitted = map[string]bool{}
	e.started = true
	e.write(map[string]any{"type": "agent_start"})
}
func piUsage(u core.Usage) map[string]any {
	return map[string]any{"input": u.Input, "output": u.Output, "cacheRead": u.CacheRead, "cacheWrite": u.CacheWrite, "totalTokens": u.Input + u.Output + u.CacheRead + u.CacheWrite, "cost": map[string]any{"input": 0.0, "output": 0.0, "cacheRead": 0.0, "cacheWrite": 0.0, "total": u.Cost}}
}
func rawObject(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	return m
}
func piMessage(m core.Message) map[string]any {
	out := rawObject(m.Native)
	if out == nil {
		out = map[string]any{}
	}
	// Provider checkpoints sometimes have an SSE event "type"; it is not a message field.
	delete(out, "type")
	role := m.Role
	if role == "tool" {
		role = "toolResult"
	}
	out["role"] = role
	if _, ok := out["timestamp"]; !ok {
		out["timestamp"] = time.Now().UnixMilli()
	}
	if m.Provider != "" {
		out["provider"] = m.Provider
	}
	if m.Model != "" {
		out["model"] = m.Model
	}
	if role == "toolResult" {
		out["toolCallId"] = m.ToolCallID
		if _, ok := out["content"]; !ok {
			out["content"] = []any{map[string]any{"type": "text", "text": m.Content}}
		}
		return out
	}
	if _, ok := out["content"].([]any); !ok {
		c := make([]any, 0, 1+len(m.ToolCalls))
		if m.Content != "" {
			c = append(c, map[string]any{"type": "text", "text": m.Content})
		}
		for _, tc := range m.ToolCalls {
			var args any = map[string]any{}
			if len(tc.Arguments) > 0 {
				_ = json.Unmarshal(tc.Arguments, &args)
			}
			c = append(c, map[string]any{"type": "toolCall", "id": tc.ID, "name": tc.Name, "arguments": args})
		}
		out["content"] = c
	}
	return out
}
func (e *JSONEmitter) sendUser() {
	if e.userSent {
		return
	}
	m := map[string]any{"role": "user", "content": []any{map[string]any{"type": "text", "text": e.pendingUser}}, "timestamp": time.Now().UnixMilli()}
	e.write(map[string]any{"type": "message_start", "message": m})
	e.write(map[string]any{"type": "message_end", "message": m})
	e.messages = append(e.messages, m)
	e.userSent = true
}
func (e *JSONEmitter) assistantStart() {
	if e.assistantStarted {
		return
	}
	m := map[string]any{"role": "assistant", "content": []any{}, "timestamp": time.Now().UnixMilli()}
	e.write(map[string]any{"type": "message_start", "message": m})
	e.assistantStarted = true
}
func (e *JSONEmitter) update(kind string, fields map[string]any) {
	a := map[string]any{"type": kind, "contentIndex": e.textIndex}
	for k, v := range fields {
		a[k] = v
	}
	e.write(map[string]any{"type": "message_update", "usage": piUsage(core.Usage{}), "assistantMessageEvent": a})
}
func (e *JSONEmitter) Emit(ev core.StreamEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.started {
		return
	}
	switch ev.Type {
	case "native":
		return
	case "turn_start":
		// Godie's engine begins the next provider turn directly after tools; Pi closes
		// that assistant/tool turn before announcing the next one.
		if e.lastAssistant != nil && len(e.toolResults) > 0 {
			e.write(map[string]any{"type": "turn_end", "message": e.lastAssistant, "toolResults": e.toolResults})
			e.assistantStarted, e.textStarted = false, false
			e.textContent.Reset()
			e.calls, e.toolResults = nil, nil
			e.callStarted, e.callEmitted = map[string]bool{}, map[string]bool{}
		}
		e.write(map[string]any{"type": "turn_start"})
		e.sendUser()
	case "text":
		e.assistantStart()
		if !e.textStarted {
			e.update("text_start", nil)
			e.textStarted = true
		}
		if ev.Text != "" {
			e.textContent.WriteString(ev.Text)
			e.update("text_delta", map[string]any{"delta": ev.Text})
		}
	case "message":
		m, ok := ev.Data.(core.Message)
		if !ok {
			return
		}
		e.assistantStart()
		if e.textStarted {
			e.update("text_end", map[string]any{"content": e.textContent.String()})
			e.textStarted = false
		}
		e.calls = append([]core.ToolCall(nil), m.ToolCalls...)
		base := 0
		if m.Content != "" {
			base = 1
		}
		for i, c := range m.ToolCalls {
			var args any = map[string]any{}
			_ = json.Unmarshal(c.Arguments, &args)
			e.textIndex = base + i
			e.update("toolcall_start", map[string]any{"id": c.ID, "toolName": c.Name})
			if len(c.Arguments) > 0 {
				e.update("toolcall_delta", map[string]any{"delta": string(c.Arguments)})
			}
			e.update("toolcall_end", map[string]any{"toolCall": map[string]any{"type": "toolCall", "id": c.ID, "name": c.Name, "arguments": args}})
		}
		e.textIndex = 0
		pm := piMessage(m)
		e.lastAssistant = pm
		e.messages = append(e.messages, pm)
		e.write(map[string]any{"type": "message_end", "message": pm})
	case "tool_start":
		c, ok := ev.Data.(core.ToolCall)
		if !ok {
			return
		}
		e.callStarted[c.ID] = true
		e.flushToolStarts()
	case "tool_end":
		e.toolEnd(ev.Data)
	case "turn_end":
		msg := e.lastAssistant
		if msg == nil {
			msg = map[string]any{"role": "assistant", "content": []any{}, "timestamp": time.Now().UnixMilli()}
		}
		if u, ok := ev.Data.(core.Usage); ok {
			msg = cloneMap(msg)
			msg["usage"] = piUsage(u)
			e.lastAssistant = msg
			for i := len(e.messages) - 1; i >= 0; i-- {
				if m, ok := e.messages[i].(map[string]any); ok && m["role"] == "assistant" {
					e.messages[i] = msg
					break
				}
			}
		}
		e.write(map[string]any{"type": "turn_end", "message": msg, "toolResults": e.toolResults})
		e.assistantStarted, e.textStarted = false, false
		e.textContent.Reset()
		e.calls, e.toolResults = nil, nil
		e.callStarted, e.callEmitted = map[string]bool{}, map[string]bool{}
	}
}
func cloneMap(in map[string]any) map[string]any {
	o := make(map[string]any, len(in))
	for k, v := range in {
		o[k] = v
	}
	return o
}
func (e *JSONEmitter) flushToolStarts() {
	for _, c := range e.calls {
		if e.callEmitted[c.ID] {
			continue
		}
		if !e.callStarted[c.ID] {
			break
		}
		var args any = map[string]any{}
		_ = json.Unmarshal(c.Arguments, &args)
		e.write(map[string]any{"type": "tool_execution_start", "toolCallId": c.ID, "toolName": c.Name, "args": args})
		e.callEmitted[c.ID] = true
	}
}
func (e *JSONEmitter) toolEnd(data any) {
	b, _ := json.Marshal(data)
	var x struct {
		ID     string             `json:"id"`
		Result core.ExecuteResult `json:"result"`
	}
	if json.Unmarshal(b, &x) != nil || x.ID == "" {
		return
	}
	name := ""
	for _, c := range e.calls {
		if c.ID == x.ID {
			name = c.Name
			break
		}
	}
	text := x.Result.Output
	if x.Result.Error != "" {
		if text != "" {
			text += "\n"
		}
		text += x.Result.Error
	}
	bad := x.Result.Error != "" || x.Result.ExitCode != 0
	result := map[string]any{"content": []any{map[string]any{"type": "text", "text": text}}, "details": x.Result}
	e.write(map[string]any{"type": "tool_execution_end", "toolCallId": x.ID, "toolName": name, "result": result, "isError": bad})
	tm := map[string]any{"role": "toolResult", "toolCallId": x.ID, "toolName": name, "content": result["content"], "details": x.Result, "isError": bad, "timestamp": time.Now().UnixMilli()}
	e.write(map[string]any{"type": "message_start", "message": tm})
	e.write(map[string]any{"type": "message_end", "message": tm})
	e.messages = append(e.messages, tm)
	e.toolResults = append(e.toolResults, tm)
}
func (e *JSONEmitter) End(runErr error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.started {
		return
	}
	if !e.userSent {
		e.write(map[string]any{"type": "turn_start"})
		e.sendUser()
	}
	if runErr != nil {
		reason := "error"
		if errors.Is(runErr, context.Canceled) {
			reason = "aborted"
		}
		content := []any{}
		if e.textContent.Len() > 0 {
			content = append(content, map[string]any{"type": "text", "text": e.textContent.String()})
		}
		m := map[string]any{"role": "assistant", "content": content, "stopReason": reason, "errorMessage": runErr.Error(), "timestamp": time.Now().UnixMilli()}
		if !e.assistantStarted {
			e.write(map[string]any{"type": "message_start", "message": map[string]any{"role": "assistant", "content": []any{}, "timestamp": m["timestamp"]}})
		}
		if e.textStarted {
			e.update("text_end", map[string]any{"content": e.textContent.String()})
		}
		e.write(map[string]any{"type": "message_end", "message": m})
		e.write(map[string]any{"type": "turn_end", "message": m, "toolResults": []any{}})
		e.messages = append(e.messages, m)
	}
	out := map[string]any{"type": "agent_end", "messages": e.messages, "willRetry": false}
	e.write(out)
	e.write(map[string]any{"type": "agent_settled"})
	e.started = false
}

const maxRPCFrame = 1 << 20

type rpcRequest struct {
	ID       json.RawMessage `json:"id"`
	Type     string          `json:"type"`
	Message  string          `json:"message"`
	Provider string          `json:"provider"`
	ModelID  string          `json:"modelId"`
	Level    string          `json:"level"`
}

func rpcModel(a *Application) map[string]any {
	return map[string]any{"provider": a.Options.Provider, "id": a.Options.Model, "name": a.Options.Model}
}
func rpcReply(enc *json.Encoder, mu *sync.Mutex, id json.RawMessage, command string, success bool, data any, errText string) error {
	m := map[string]any{"type": "response", "command": command, "success": success}
	if len(id) > 0 {
		var v any
		if json.Unmarshal(id, &v) == nil {
			m["id"] = v
		}
	}
	if data != nil {
		m["data"] = data
	}
	if errText != "" {
		m["error"] = errText
	}
	mu.Lock()
	defer mu.Unlock()
	return enc.Encode(m)
}
func RunRPC(ctx context.Context, a *Application, reader io.Reader, writer io.Writer) error {
	if a == nil {
		return errors.New("rpc: nil application")
	}
	enc := json.NewEncoder(writer)
	var outMu, stateMu sync.Mutex
	busy := false
	var activeDone chan struct{}
	var asyncErr error
	var wg sync.WaitGroup
	s := bufio.NewScanner(reader)
	s.Buffer(make([]byte, 4096), maxRPCFrame)
	for s.Scan() {
		line := s.Bytes()
		if len(strings.TrimSpace(string(line))) == 0 {
			continue
		}
		var q rpcRequest
		if err := json.Unmarshal(line, &q); err != nil {
			if e := rpcReply(enc, &outMu, nil, "", false, nil, "invalid JSON request"); e != nil {
				return e
			}
			continue
		}
		if q.Type == "" {
			if e := rpcReply(enc, &outMu, q.ID, "", false, nil, "request type is required"); e != nil {
				return e
			}
			continue
		}
		switch q.Type {
		case "prompt":
			if strings.TrimSpace(q.Message) == "" {
				if e := rpcReply(enc, &outMu, q.ID, q.Type, false, nil, "message is required"); e != nil {
					return e
				}
				continue
			}
			stateMu.Lock()
			if busy {
				stateMu.Unlock()
				if e := rpcReply(enc, &outMu, q.ID, q.Type, false, nil, "agent is already running"); e != nil {
					return e
				}
				continue
			}
			busy = true
			activeDone = make(chan struct{})
			done := activeDone
			stateMu.Unlock()
			if e := rpcReply(enc, &outMu, q.ID, q.Type, true, nil, ""); e != nil {
				return e
			}
			wg.Add(1)
			go func(text string, done chan struct{}) {
				defer wg.Done()
				em := NewJSONEmitter(&lockedWriter{w: writer, mu: &outMu}, a)
				em.header = true
				em.mu.Lock()
				em.startLocked(text)
				em.mu.Unlock()
				runErr := a.Submit(ctx, text, em.Emit)
				em.End(runErr)
				stateMu.Lock()
				if asyncErr == nil {
					asyncErr = em.Err()
				}
				busy = false
				close(done)
				stateMu.Unlock()
			}(q.Message, done)
		case "abort":
			stateMu.Lock()
			done := activeDone
			running := busy
			stateMu.Unlock()
			a.Cancel()
			if running {
				select {
				case <-done:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			if e := rpcReply(enc, &outMu, q.ID, q.Type, true, nil, ""); e != nil {
				return e
			}
		case "get_state":
			stateMu.Lock()
			b := busy
			stateMu.Unlock()
			msgs, _ := a.Session.Messages()
			d := map[string]any{"model": rpcModel(a), "thinkingLevel": a.Options.Thinking, "isStreaming": b, "isCompacting": false, "sessionFile": a.Session.File(), "sessionId": a.Session.ID(), "autoCompactionEnabled": false, "messageCount": len(msgs), "pendingMessageCount": 0}
			if e := rpcReply(enc, &outMu, q.ID, q.Type, true, d, ""); e != nil {
				return e
			}
		case "get_messages":
			msgs, err := a.Session.Messages()
			if err != nil {
				if e := rpcReply(enc, &outMu, q.ID, q.Type, false, nil, err.Error()); e != nil {
					return e
				}
			} else {
				out := make([]any, 0, len(msgs))
				for _, m := range msgs {
					if !m.Hidden {
						out = append(out, piMessage(m))
					}
				}
				if e := rpcReply(enc, &outMu, q.ID, q.Type, true, map[string]any{"messages": out}, ""); e != nil {
					return e
				}
			}
		case "get_session_stats":
			u, err := a.Session.CombinedUsage()
			if err != nil {
				if e := rpcReply(enc, &outMu, q.ID, q.Type, false, nil, err.Error()); e != nil {
					return e
				}
			} else {
				msgs, _ := a.Session.Messages()
				d := map[string]any{"sessionId": a.Session.ID(), "sessionFile": a.Session.File(), "messageCount": len(msgs), "usage": piUsage(u)}
				if e := rpcReply(enc, &outMu, q.ID, q.Type, true, d, ""); e != nil {
					return e
				}
			}
		case "get_available_models":
			if e := rpcReply(enc, &outMu, q.ID, q.Type, true, map[string]any{"models": []any{rpcModel(a)}}, ""); e != nil {
				return e
			}
		case "set_model":
			stateMu.Lock()
			b := busy
			if !b && q.ModelID != "" && (q.Provider == "" || q.Provider == a.Options.Provider) {
				a.Options.Model = q.ModelID
				a.Engine.Request.Model = q.ModelID
			}
			stateMu.Unlock()
			if b {
				if e := rpcReply(enc, &outMu, q.ID, q.Type, false, nil, "cannot change model while agent is running"); e != nil {
					return e
				}
			} else if q.ModelID == "" {
				if e := rpcReply(enc, &outMu, q.ID, q.Type, false, nil, "modelId is required"); e != nil {
					return e
				}
			} else if q.Provider != "" && q.Provider != a.Options.Provider {
				if e := rpcReply(enc, &outMu, q.ID, q.Type, false, nil, "provider switching is not supported"); e != nil {
					return e
				}
			} else if e := rpcReply(enc, &outMu, q.ID, q.Type, true, rpcModel(a), ""); e != nil {
				return e
			}
		case "set_thinking_level":
			valid := map[string]bool{"off": true, "minimal": true, "low": true, "medium": true, "high": true, "xhigh": true, "max": true}[q.Level]
			stateMu.Lock()
			b := busy
			if !b && valid {
				a.Options.Thinking = q.Level
				a.Engine.Request.Thinking = q.Level
			}
			stateMu.Unlock()
			if b {
				if e := rpcReply(enc, &outMu, q.ID, q.Type, false, nil, "cannot change thinking while agent is running"); e != nil {
					return e
				}
			} else if !valid {
				if e := rpcReply(enc, &outMu, q.ID, q.Type, false, nil, "invalid thinking level"); e != nil {
					return e
				}
			} else if e := rpcReply(enc, &outMu, q.ID, q.Type, true, nil, ""); e != nil {
				return e
			}
		case "get_available_thinking_levels":
			if e := rpcReply(enc, &outMu, q.ID, q.Type, true, map[string]any{"levels": []string{"off", "minimal", "low", "medium", "high", "xhigh", "max"}}, ""); e != nil {
				return e
			}
		default:
			if e := rpcReply(enc, &outMu, q.ID, q.Type, false, nil, fmt.Sprintf("unsupported command %q", q.Type)); e != nil {
				return e
			}
		}
	}
	if err := s.Err(); err != nil {
		return fmt.Errorf("rpc input: %w", err)
	}
	wg.Wait()
	stateMu.Lock()
	defer stateMu.Unlock()
	return asyncErr
}

type lockedWriter struct {
	w  io.Writer
	mu *sync.Mutex
}

func (w *lockedWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.w.Write(p)
}
