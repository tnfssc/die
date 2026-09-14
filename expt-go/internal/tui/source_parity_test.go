package tui

import (
	"errors"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

type queueBackendStub struct {
	backendStub
	accepted bool
	queued   []struct {
		prompt   string
		followUp bool
	}
}

func (b *queueBackendStub) Queue(prompt string, followUp bool) bool {
	b.queued = append(b.queued, struct {
		prompt   string
		followUp bool
	}{prompt, followUp})
	return b.accepted
}

// Source contract: src/ui/editor.ts submits Enter as steering while streaming,
// and core keybindings sends Alt+Enter as a follow-up. Successful queueing clears
// the queued draft into history/pending transcript exactly once.
func TestSourceSteeringAndFollowUpQueueBindings(t *testing.T) {
	for _, tc := range []struct {
		name     string
		key      tea.KeyPressMsg
		followUp bool
	}{
		{"enter steering", key(tea.KeyEnter), false},
		{"alt-enter follow-up", tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter, Mod: tea.ModAlt}), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			backend := &queueBackendStub{accepted: true}
			m := New(Config{Backend: backend, InitialDraft: "first"})
			m.Update(key(tea.KeyEnter))
			m.Update(textKey("queued"))
			_, cmd := m.Update(tc.key)
			if cmd != nil || len(backend.queued) != 1 {
				t.Fatalf("cmd=%v queued=%#v", cmd, backend.queued)
			}
			got := backend.queued[0]
			if got.prompt != "queued" || got.followUp != tc.followUp {
				t.Fatalf("queue call = %#v", got)
			}
			if m.Draft() != "" || len(m.History()) != 2 || m.History()[1] != "queued" {
				t.Fatalf("draft/history = %q %#v", m.Draft(), m.History())
			}
			count := 0
			for _, message := range m.Messages() {
				if message.Role == RoleUser && message.Text == "queued" {
					count++
				}
			}
			if count != 1 {
				t.Fatalf("queued transcript count = %d: %#v", count, m.Messages())
			}
		})
	}
}

func TestQueueSettledFallsBackToNormalSubmit(t *testing.T) {
	backend := &queueBackendStub{accepted: false}
	m := New(Config{Backend: backend, InitialDraft: "first"})
	m.Update(key(tea.KeyEnter))
	m.editor.SetValue("next")
	_, cmd := m.Update(key(tea.KeyEnter))
	if cmd == nil || len(backend.queued) != 1 {
		t.Fatalf("fallback cmd=%v queue=%#v", cmd, backend.queued)
	}
	cmd()
	if len(backend.prompts) != 1 || backend.prompts[0] != "next" {
		t.Fatalf("fallback prompts = %#v", backend.prompts)
	}
}

type modelBackendStub struct {
	backendStub
	current   string
	selected  []string
	selectErr error
}

func (b *modelBackendStub) CurrentModel() string { return b.current }
func (b *modelBackendStub) SelectModel(model string) error {
	b.selected = append(b.selected, model)
	if b.selectErr == nil {
		b.current = model
	}
	return b.selectErr
}

// Source contract: core keybindings maps Ctrl+P to model cycling and Ctrl+L to
// model selection. /ps, not Ctrl+P, owns the local job overlay.
func TestSourceModelBindingsUseSettingsCatalog(t *testing.T) {
	backend := &modelBackendStub{current: "p/a"}
	settings := &settingsBackendStub{models: []ProfileModel{{Provider: "p", ID: "a"}, {Provider: "p", ID: "b", Name: "Bee"}}}
	m := New(Config{Backend: backend, SettingsBackend: settings, InitialDraft: "draft"})
	m.Update(tea.KeyPressMsg(tea.Key{Code: 'p', Mod: tea.ModCtrl}))
	if len(backend.selected) != 1 || backend.selected[0] != "p/b" || m.overlay {
		t.Fatalf("cycle selected=%#v jobs=%v", backend.selected, m.overlay)
	}
	m.Update(tea.KeyPressMsg(tea.Key{Code: 'l', Mod: tea.ModCtrl}))
	if !m.modelPicker.open || m.Draft() != "draft" {
		t.Fatalf("picker=%v draft=%q", m.modelPicker.open, m.Draft())
	}
	m.Update(key(tea.KeyUp))
	m.Update(key(tea.KeyEnter))
	if backend.current != "p/a" || m.modelPicker.open {
		t.Fatalf("selected=%q open=%v", backend.current, m.modelPicker.open)
	}

	backend.selectErr = errors.New("bad\x1b[2J")
	m.Update(tea.KeyPressMsg(tea.Key{Code: 'p', Mod: tea.ModCtrl}))
	if strings.Contains(m.status, "\x1b") {
		t.Fatalf("unsafe model error %q", m.status)
	}
}

// Visual contract: the source uses an inline chevron editor and product-state
// footer, not an alternate-screen chat header or key-hint bar.
func TestCompactInlineVisualContract(t *testing.T) {
	m := New(Config{Title: "die · openai/gpt-4o", Footer: FooterState{Project: "workspace", Mode: "orchestrator", Cost: "$0.123", Context: "ctx 7%", Cache: "cache 4m", Provider: "openai/gpt-4o"}})
	m.Update(tea.WindowSizeMsg{Width: 100, Height: 30})
	v := m.View()
	if v.AltScreen {
		t.Fatal("compact UI unexpectedly uses alternate screen")
	}
	for _, want := range []string{" ", "workspace", "mode: orchestrator", "$0.123", "ctx 7%", "cache 4m", "openai/gpt-4o"} {
		if !strings.Contains(v.Content, want) {
			t.Errorf("view missing %q:\n%s", want, v.Content)
		}
	}
	for _, unwanted := range []string{"Ask anything", "enter send", "ctrl+c quit", "die · openai"} {
		if strings.Contains(v.Content, unwanted) {
			t.Errorf("generic layout leaked %q:\n%s", unwanted, v.Content)
		}
	}
}

func TestFooterEventUpdatesWithoutDisturbingDraftOrStream(t *testing.T) {
	m := New(Config{InitialDraft: "keep", Footer: FooterState{Project: "a", Mode: "normal", Cost: "$0.000", Context: "ctx ?", Cache: "cache ?", Provider: "p/a"}})
	m.Update(eventMsg(Event{Kind: EventBusy}))
	m.Update(eventMsg(Event{Kind: EventAssistantDelta, Text: "streamed"}))
	m.Update(eventMsg(Event{Kind: EventFooter, Footer: FooterState{Cost: "$1.250", Context: "ctx 90%", Cache: "cache 2m", Provider: "p/b"}}))
	v := m.View().Content
	for _, want := range []string{"streamed", "$1.250", "ctx 90%", "cache 2m", "p/b", "keep"} {
		if !strings.Contains(v, want) {
			t.Errorf("view missing %q:\n%s", want, v)
		}
	}
	if m.Draft() != "keep" || !m.Active() {
		t.Fatalf("draft=%q active=%v", m.Draft(), m.Active())
	}
}
