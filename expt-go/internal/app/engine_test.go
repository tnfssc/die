package app

import (
	"context"
	"encoding/json"
	"godie/internal/core"
	"sync"
	"testing"
	"time"
)

type memJournal struct {
	messages []core.Message
	records  []string
}

func (m *memJournal) Messages() ([]core.Message, error) { return m.messages, nil }
func (m *memJournal) AppendMessage(v core.Message) error {
	m.messages = append(m.messages, v)
	return nil
}
func (m *memJournal) Record(k string, v any) error { m.records = append(m.records, k); return nil }

type fakeProvider struct {
	n     int
	calls []core.ToolCall
}

func (p *fakeProvider) Complete(_ context.Context, r core.Request, _ func(core.StreamEvent)) (core.Response, error) {
	p.n++
	if p.n == 1 {
		return core.Response{Message: core.Message{Role: "assistant", ToolCalls: p.calls}}, nil
	}
	return core.Response{Message: core.Message{Role: "assistant", Content: "done"}}, nil
}

type fakeExecutor struct {
	mu      sync.Mutex
	n       int
	handoff bool
}

func (e *fakeExecutor) Execute(_ context.Context, code string, _ time.Duration) (core.ExecuteResult, error) {
	e.mu.Lock()
	e.n++
	e.mu.Unlock()
	return core.ExecuteResult{Output: code, Handoff: e.handoff}, nil
}
func TestToolCycleAndOriginalOrder(t *testing.T) {
	j := &memJournal{}
	p := &fakeProvider{}
	x := &fakeExecutor{}
	for i := 0; i < 50; i++ {
		b, _ := json.Marshal(map[string]string{"code": "console.log(1)"})
		p.calls = append(p.calls, core.ToolCall{ID: string(rune(65 + i)), Name: "execute", Arguments: b})
	}
	e := &Engine{Provider: p, Executor: x, Journal: j}
	if err := e.Turn(context.Background(), "go", nil); err != nil {
		t.Fatal(err)
	}
	if x.n != 50 || p.n != 2 || len(j.messages) != 53 {
		t.Fatalf("calls=%d turns=%d msgs=%d", x.n, p.n, len(j.messages))
	}
	for i, c := range p.calls {
		if j.messages[i+2].ToolCallID != c.ID {
			t.Fatal("tool result order changed")
		}
	}
}
func TestHandoffEndsInferenceWithoutShutdown(t *testing.T) {
	j := &memJournal{}
	p := &fakeProvider{calls: []core.ToolCall{{ID: "a", Name: "execute", Arguments: json.RawMessage(`{"code":"await handoff('wait')"}`)}}}
	x := &fakeExecutor{handoff: true}
	e := &Engine{Provider: p, Executor: x, Journal: j}
	if err := e.Turn(context.Background(), "go", nil); err != nil {
		t.Fatal(err)
	}
	if p.n != 1 {
		t.Fatal("handoff continued inference")
	}
}
func TestDelegation(t *testing.T) {
	for _, v := range []struct {
		depth       int
		role, child string
		ok          bool
	}{{0, "", "orchestrator", true}, {1, "orchestrator", "normal", true}, {1, "orchestrator", "orchestrator", false}, {1, "normal", "fast", false}, {2, "orchestrator", "fast", false}} {
		if (CanDelegate(v.depth, v.role, v.child) == nil) != v.ok {
			t.Fatalf("%+v", v)
		}
	}
}
func TestOptionInterspersingAndRejection(t *testing.T) {
	o, e := ParseOptions([]string{"hello", "--provider", "openai", "--model=x", "world", "--", "--text"})
	if e != nil || len(o.Messages) != 3 || o.Provider != "openai" {
		t.Fatalf("%+v %v", o, e)
	}
	for _, a := range []string{"--tools=read", "--no-tools", "update"} {
		if _, e := ParseOptions([]string{a}); e == nil {
			t.Fatal(a)
		}
	}
}
