package tui

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
)

type backendStub struct {
	prompts   []string
	events    []Event
	err       error
	cancelled bool
}

func (b *backendStub) Submit(_ context.Context, prompt string, emit EmitFunc) error {
	b.prompts = append(b.prompts, prompt)
	for _, event := range b.events {
		emit(event)
	}
	return b.err
}
func (b *backendStub) Cancel() { b.cancelled = true }

func key(code rune) tea.KeyPressMsg { return tea.KeyPressMsg(tea.Key{Code: code}) }
func textKey(s string) tea.KeyPressMsg {
	r := []rune(s)
	return tea.KeyPressMsg(tea.Key{Code: r[0], Text: s})
}

func TestSubmitStreamsWithoutReplacingDraftEditor(t *testing.T) {
	backend := &backendStub{events: []Event{
		{Kind: EventAssistantDelta, Text: "hello "},
		{Kind: EventAssistantDelta, Text: "world"},
		{Kind: EventDone},
	}}
	m := New(Config{Backend: backend, InitialDraft: "question"})
	_, cmd := m.Update(key(tea.KeyEnter))
	if cmd == nil {
		t.Fatal("submit returned no command")
	}
	if got := m.Draft(); got != "" {
		t.Fatalf("draft after submit = %q", got)
	}
	if !m.Active() {
		t.Fatal("turn should be active while backend command runs")
	}

	result := cmd()
	if len(backend.prompts) != 1 || backend.prompts[0] != "question" {
		t.Fatalf("prompts = %#v", backend.prompts)
	}
	// Events are delivered independently of the blocking Submit callback.
	for range backend.events {
		event := <-m.events
		m.Update(eventMsg(event))
	}
	m.Update(result)

	messages := m.Messages()
	if len(messages) != 2 || messages[0].Role != RoleUser || messages[1].Text != "hello world" {
		t.Fatalf("messages = %#v", messages)
	}
	if m.Active() {
		t.Fatal("turn still active after completion")
	}
	if got := m.History(); len(got) != 1 || got[0] != "question" {
		t.Fatalf("history = %#v", got)
	}
}

func TestEditorRemainsUsableAndKeepsSecondDraftDuringTurn(t *testing.T) {
	m := New(Config{Backend: &backendStub{}, InitialDraft: "first"})
	m.Update(key(tea.KeyEnter))
	m.Update(textKey("n"))
	m.Update(textKey("e"))
	m.Update(textKey("x"))
	m.Update(textKey("t"))
	if got := m.Draft(); got != "next" {
		t.Fatalf("draft while active = %q", got)
	}
	_, cmd := m.Update(key(tea.KeyEnter))
	if cmd != nil {
		t.Fatal("second submit should not start concurrently")
	}
	if got := m.Draft(); got != "next" {
		t.Fatalf("second draft was lost: %q", got)
	}
}

func TestHistoryRestoresUnsentDraft(t *testing.T) {
	m := New(Config{History: []string{"one", "two"}, InitialDraft: "work"})
	m.Update(key(tea.KeyUp))
	if got := m.Draft(); got != "two" {
		t.Fatalf("first up = %q", got)
	}
	m.Update(key(tea.KeyUp))
	if got := m.Draft(); got != "one" {
		t.Fatalf("second up = %q", got)
	}
	m.Update(key(tea.KeyDown))
	m.Update(key(tea.KeyDown))
	if got := m.Draft(); got != "work" {
		t.Fatalf("restored draft = %q", got)
	}

	m.Update(key(tea.KeyUp))
	m.Update(key(tea.KeyEscape))
	if got := m.Draft(); got != "work" {
		t.Fatalf("escape restored draft = %q", got)
	}
}

// Source contract: pi-tui/dist/keybindings.js maps newLine to Shift+Enter/Ctrl+J;
// pi-coding-agent/dist/core/keybindings.js reserves Alt+Enter for follow-up.
func TestSourceNewlineBindings(t *testing.T) {
	for _, mod := range []tea.KeyMod{tea.ModShift, tea.ModCtrl} {
		m := New(Config{InitialDraft: "first"})
		code := rune(tea.KeyEnter)
		if mod == tea.ModCtrl {
			code = 'j'
		}
		m.Update(tea.KeyPressMsg(tea.Key{Code: code, Mod: mod}))
		if got := m.Draft(); got != "first\n" {
			t.Fatalf("mod %v draft = %q", mod, got)
		}
	}
}

// Source contract: interactive editor Escape aborts streaming, Ctrl+C clears,
// a second idle Ctrl+C exits, and Ctrl+D exits only with an empty editor.
func TestSourceCancelClearAndExitBindings(t *testing.T) {
	backend := &backendStub{}
	m := New(Config{Backend: backend, InitialDraft: "go"})
	m.Update(key(tea.KeyEnter))
	m.Update(textKey("draft"))
	_, cmd := m.Update(key(tea.KeyEscape))
	if !backend.cancelled || cmd != nil || m.Draft() != "draft" {
		t.Fatalf("escape cancel: cancelled=%v cmd=%v draft=%q", backend.cancelled, cmd, m.Draft())
	}
	m.Update(tea.KeyPressMsg(tea.Key{Code: 'c', Mod: tea.ModCtrl}))
	if m.Draft() != "" {
		t.Fatalf("ctrl+c draft = %q", m.Draft())
	}
	// Active Ctrl+C never quits. Settle, then two idle presses do.
	_, cmd = m.Update(tea.KeyPressMsg(tea.Key{Code: 'c', Mod: tea.ModCtrl}))
	if cmd != nil {
		t.Fatal("active ctrl+c quit")
	}
	m.applyEvent(Event{Kind: EventDone})
	m.lastCtrlC = time.Time{}
	_, cmd = m.Update(tea.KeyPressMsg(tea.Key{Code: 'c', Mod: tea.ModCtrl}))
	if cmd != nil {
		t.Fatal("first idle ctrl+c quit")
	}
	_, cmd = m.Update(tea.KeyPressMsg(tea.Key{Code: 'c', Mod: tea.ModCtrl}))
	if cmd == nil {
		t.Fatal("second idle ctrl+c did not quit")
	}

	nonempty := New(Config{InitialDraft: "keep"})
	_, cmd = nonempty.Update(tea.KeyPressMsg(tea.Key{Code: 'd', Mod: tea.ModCtrl}))
	if cmd != nil {
		t.Fatal("ctrl+d quit with nonempty editor")
	}
	empty := New(Config{})
	_, cmd = empty.Update(tea.KeyPressMsg(tea.Key{Code: 'd', Mod: tea.ModCtrl}))
	if cmd == nil {
		t.Fatal("ctrl+d did not quit with empty editor")
	}
}

func TestErrorCompletesTurnAndAppearsInTranscript(t *testing.T) {
	m := New(Config{Backend: &backendStub{err: errors.New("boom")}, InitialDraft: "go"})
	_, cmd := m.Update(key(tea.KeyEnter))
	m.Update(cmd())
	if m.Active() {
		t.Fatal("error did not complete turn")
	}
	messages := m.Messages()
	if messages[len(messages)-1].Role != RoleSystem || messages[len(messages)-1].Text != "boom" {
		t.Fatalf("messages = %#v", messages)
	}
}

func TestResponsiveViewAndJobMonitor(t *testing.T) {
	m := New(Config{Title: "godie", Version: "test", Footer: FooterState{Project: "godie"}, Messages: []Message{{Role: RoleAssistant, Text: strings.Repeat("answer ", 30)}}})
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	m.applyEvent(Event{Kind: EventJobUpsert, Job: Job{ID: "2", Title: "tests", Status: "running", Started: time.Now()}})
	m.applyEvent(Event{Kind: EventJobUpsert, Job: Job{ID: "1", Title: "build", Status: "done"}})
	wide := m.View().Content
	for _, want := range []string{"godie", "mode: orchestrator", "$0.000", "ctx ?", "jobs (2)", "build", "tests"} {
		if !strings.Contains(wide, want) {
			t.Errorf("wide view missing %q:\n%s", want, wide)
		}
	}
	m.Update(tea.WindowSizeMsg{Width: 32, Height: 10})
	narrow := m.View().Content
	if !strings.Contains(narrow, "jobs 2 running") {
		t.Fatalf("narrow monitor missing:\n%s", narrow)
	}
	if strings.Contains(narrow, "enter send") {
		t.Fatalf("generic key-hint footer returned:\n%s", narrow)
	}
	if m.viewport.Width() != 32 || m.viewport.Height() < 1 {
		t.Fatalf("viewport dimensions = %dx%d", m.viewport.Width(), m.viewport.Height())
	}
}

func TestExternalEventQueueHonorsCancelledContext(t *testing.T) {
	m := New(Config{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	// Fill the queue so selection cannot choose a ready send branch.
	for i := 0; i < cap(m.events); i++ {
		m.events <- Event{}
	}
	if m.SendEvent(ctx, Event{Kind: EventStatus}) {
		t.Fatal("event unexpectedly queued")
	}
}

func TestImmediateDuplicateHistoryIsSuppressed(t *testing.T) {
	m := New(Config{Backend: &backendStub{}, History: []string{"same"}, InitialDraft: "same"})
	m.Update(key(tea.KeyEnter))
	if got := m.History(); len(got) != 1 {
		t.Fatalf("history = %#v", got)
	}
}
