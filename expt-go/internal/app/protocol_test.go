package app

import (
	"bytes"
	"context"
	"encoding/json"
	"godie/internal/core"
	"io"
	"strings"
	"testing"
)

func decodeLines(t *testing.T, b string) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(b), "\n") {
		var v map[string]any
		if err := json.Unmarshal([]byte(line), &v); err != nil {
			t.Fatalf("bad JSON line %q: %v", line, err)
		}
		out = append(out, v)
	}
	return out
}
func eventTypes(xs []map[string]any) []string {
	r := make([]string, len(xs))
	for i, x := range xs {
		r[i], _ = x["type"].(string)
	}
	return r
}
func indexType(xs []map[string]any, typ string) int {
	for i, x := range xs {
		if x["type"] == typ {
			return i
		}
	}
	return -1
}

func TestJSONEmitterPiOrderAndNativeMetadata(t *testing.T) {
	var b bytes.Buffer
	e := NewJSONEmitter(&b, nil)
	e.Start("use tool")
	e.Emit(core.StreamEvent{Type: "turn_start"})
	e.Emit(core.StreamEvent{Type: "native", Data: json.RawMessage(`{"type":"response.output_text.delta","delta":"must-not-leak"}`)})
	e.Emit(core.StreamEvent{Type: "text", Text: "checking"})
	call := core.ToolCall{ID: "call_native_7", Name: "execute", Arguments: json.RawMessage(`{"code":"1+1"}`)}
	native := json.RawMessage(`{"role":"assistant","api":"responses","usage":{"input":3,"cost":{"total":0.25}},"responseId":"resp_1","content":[{"type":"text","text":"checking"},{"type":"toolCall","id":"call_native_7","name":"execute","arguments":{"code":"1+1"}}]}`)
	e.Emit(core.StreamEvent{Type: "message", Data: core.Message{Role: "assistant", Content: "checking", ToolCalls: []core.ToolCall{call}, Native: native, Provider: "openai", Model: "m"}})
	e.Emit(core.StreamEvent{Type: "tool_start", Data: call})
	e.Emit(core.StreamEvent{Type: "tool_end", Data: map[string]any{"id": call.ID, "result": core.ExecuteResult{Output: "2", ExitCode: 0}}})
	e.Emit(core.StreamEvent{Type: "turn_end", Data: core.Usage{Input: 3, Output: 2, Cost: .25}})
	e.End(nil)
	xs := decodeLines(t, b.String())
	wantPrefix := []string{"session", "agent_start", "turn_start", "message_start", "message_end", "message_start", "message_update", "message_update"}
	got := eventTypes(xs)
	for i, w := range wantPrefix {
		if got[i] != w {
			t.Fatalf("event %d=%q, want %q; all=%v", i, got[i], w, got)
		}
	}
	ms, ts, te := indexType(xs, "message_end"), indexType(xs, "tool_execution_start"), indexType(xs, "tool_execution_end")
	_ = ms
	// The assistant message_end (the second message_end) precedes tool execution.
	assistantEnd := -1
	for i, x := range xs {
		if x["type"] == "message_end" {
			m, _ := x["message"].(map[string]any)
			if m["role"] == "assistant" {
				assistantEnd = i
				u := m["usage"].(map[string]any)
				if u["cost"].(map[string]any)["total"] != .25 {
					t.Fatalf("native cost lost: %#v", m)
				}
				content := m["content"].([]any)
				tc := content[1].(map[string]any)
				if tc["id"] != call.ID {
					t.Fatalf("tool id lost: %#v", tc)
				}
			}
		}
	}
	if !(assistantEnd >= 0 && assistantEnd < ts && ts < te) {
		t.Fatalf("bad tool ordering: assistant_end=%d start=%d end=%d", assistantEnd, ts, te)
	}
	if strings.Contains(b.String(), "must-not-leak") {
		t.Fatal("native SSE was emitted as a CLI event")
	}
	if got[len(got)-2] != "agent_end" || got[len(got)-1] != "agent_settled" {
		t.Fatalf("bad ending: %v", got)
	}
}

func TestJSONEmitterOrdersConcurrentToolStartsByAssistantSource(t *testing.T) {
	var b bytes.Buffer
	e := NewJSONEmitter(&b, nil)
	e.Start("x")
	e.Emit(core.StreamEvent{Type: "turn_start"})
	a := core.ToolCall{ID: "a", Name: "execute", Arguments: json.RawMessage(`{"code":"a"}`)}
	c := core.ToolCall{ID: "b", Name: "execute", Arguments: json.RawMessage(`{"code":"b"}`)}
	e.Emit(core.StreamEvent{Type: "message", Data: core.Message{Role: "assistant", ToolCalls: []core.ToolCall{a, c}}})
	e.Emit(core.StreamEvent{Type: "tool_start", Data: c})
	e.Emit(core.StreamEvent{Type: "tool_start", Data: a})
	xs := decodeLines(t, b.String())
	var ids []string
	for _, x := range xs {
		if x["type"] == "tool_execution_start" {
			ids = append(ids, x["toolCallId"].(string))
		}
	}
	if strings.Join(ids, ",") != "a,b" {
		t.Fatalf("starts=%v", ids)
	}
}

type protocolProvider struct{}

func (protocolProvider) Complete(_ context.Context, _ core.Request, emit func(core.StreamEvent)) (core.Response, error) {
	emit(core.StreamEvent{Type: "text", Text: "ok"})
	return core.Response{Message: core.Message{Role: "assistant", Content: "ok", Provider: "fake", Model: "fake-model"}, Usage: core.Usage{Input: 1, Output: 1}, StopReason: "stop"}, nil
}
func TestRunRPCAsyncResponsesStateAndErrors(t *testing.T) {
	dir := t.TempDir()
	a, err := NewApplication(Options{StateDir: dir, CWD: dir, Offline: true, Model: "fake-model", Provider: "fake", Thinking: "low"})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	a.Interactive = true
	a.Engine.Provider = protocolProvider{}
	input := strings.Join([]string{`{"id":"p1","type":"prompt","message":"hello"}`, `{"id":"s1","type":"get_state"}`, `{"id":"m1","type":"get_messages"}`, `{"id":"bad","type":"not_a_command"}`, `{"id":"t1","type":"set_thinking_level","level":"high"}`}, "\n") + "\n"
	var out bytes.Buffer
	if err = RunRPC(context.Background(), a, strings.NewReader(input), &out); err != nil {
		t.Fatal(err)
	}
	xs := decodeLines(t, out.String())
	if xs[0]["type"] != "response" || xs[0]["id"] != "p1" || xs[0]["success"] != true {
		t.Fatalf("prompt ack not first: %#v", xs[0])
	}
	foundSettled, foundBad := false, false
	for _, x := range xs {
		if x["type"] == "agent_settled" {
			foundSettled = true
		}
		if x["type"] == "response" && x["id"] == "bad" {
			foundBad = x["success"] == false && strings.Contains(x["error"].(string), "unsupported")
		}
	}
	if !foundSettled || !foundBad {
		t.Fatalf("settled=%v structured unknown=%v output=%s", foundSettled, foundBad, out.String())
	}
	if strings.Contains(out.String(), "APIKey") {
		t.Fatal("RPC exposed credentials")
	}
}
func TestRunRPCRejectsOversizeFrame(t *testing.T) {
	a := &Application{}
	err := RunRPC(context.Background(), a, strings.NewReader(strings.Repeat("x", maxRPCFrame+1)), io.Discard)
	if err == nil || !strings.Contains(err.Error(), "too long") {
		t.Fatalf("oversize err=%v", err)
	}
}
