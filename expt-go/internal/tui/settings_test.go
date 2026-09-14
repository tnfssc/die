package tui

import (
	"errors"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

type settingsBackendStub struct {
	profiles                   SubagentProfiles
	models                     []ProfileModel
	getErr, modelsErr, saveErr error
	saves                      []SubagentProfiles
}

func (b *settingsBackendStub) GetSubagentProfiles() (SubagentProfiles, error) {
	return cloneProfiles(b.profiles), b.getErr
}
func (b *settingsBackendStub) ListModels() ([]ProfileModel, error) {
	return append([]ProfileModel(nil), b.models...), b.modelsErr
}
func (b *settingsBackendStub) SaveSubagentProfiles(p SubagentProfiles) error {
	b.saves = append(b.saves, cloneProfiles(p))
	return b.saveErr
}

func openSubagents(t *testing.T, m *Model) {
	t.Helper()
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	m.Update(key(tea.KeyEnter))
	if !m.settings.open {
		t.Fatal("/subagents did not open settings")
	}
}

func TestSubagentsSelectsProfilesAndSavesThroughBackend(t *testing.T) {
	backend := &settingsBackendStub{
		profiles: SubagentProfiles{},
		models:   []ProfileModel{{Provider: "zeta", ID: "large"}, {Provider: "alpha", ID: "small", Name: "Small model"}},
	}
	m := New(Config{SettingsBackend: backend, InitialDraft: "/subagents"})
	openSubagents(t, m)
	profileItems := m.settingsItems()
	if len(profileItems) != 8 || profileItems[0].label != "fast model" || profileItems[2].label != "normal model" || profileItems[4].label != "orchestrator model" {
		t.Fatalf("profile rows = %#v", profileItems)
	}
	m.Update(key(tea.KeyEnter)) // fast model
	items := m.settingsItems()
	if len(items) != 3 || items[0].label != "Inherit from parent" || items[1].value != "alpha/small" {
		t.Fatalf("model items = %#v", items)
	}
	m.Update(key(tea.KeyDown))
	m.Update(key(tea.KeyEnter)) // alpha/small
	m.Update(key(tea.KeyDown))  // fast thinking
	m.Update(key(tea.KeyEnter))
	for range 5 {
		m.Update(key(tea.KeyDown))
	} // high
	m.Update(key(tea.KeyEnter))
	for range 5 {
		m.Update(key(tea.KeyDown))
	} // save row
	m.Update(key(tea.KeyEnter))
	if m.settings.open {
		t.Fatal("successful save did not close settings")
	}
	if len(backend.saves) != 1 {
		t.Fatalf("save calls = %d", len(backend.saves))
	}
	got := backend.saves[0][SubagentFast]
	if got.Model != "alpha/small" || got.Thinking != "high" {
		t.Fatalf("saved fast profile = %#v", got)
	}
	if m.Draft() != "/subagents" {
		t.Fatalf("command draft changed: %q", m.Draft())
	}
}

func TestSubagentsEscapeDiscardsSettingsAndPreservesEditorDraft(t *testing.T) {
	backend := &settingsBackendStub{profiles: SubagentProfiles{SubagentFast: {Model: "old/model"}}, models: []ProfileModel{{Provider: "new", ID: "model"}}}
	m := New(Config{SettingsBackend: backend, InitialDraft: "/subagents"})
	openSubagents(t, m)
	m.Update(key(tea.KeyEnter))
	m.Update(key(tea.KeyDown)) // unavailable current is selected initially; choose available next
	m.Update(key(tea.KeyEnter))
	if m.settings.draft[SubagentFast].Model == "old/model" {
		t.Fatal("test did not change settings draft")
	}
	m.Update(key(tea.KeyEscape))
	if m.settings.open {
		t.Fatal("escape did not cancel panel")
	}
	if len(backend.saves) != 0 {
		t.Fatal("cancel saved settings")
	}
	if m.Draft() != "/subagents" {
		t.Fatalf("editor draft = %q", m.Draft())
	}
}

func TestSubagentsFuzzyModelFilterIncludesCurrentAndInherited(t *testing.T) {
	backend := &settingsBackendStub{profiles: SubagentProfiles{SubagentNormal: {Model: "gone/model"}}, models: []ProfileModel{{Provider: "beta", ID: "two"}, {Provider: "alpha", ID: "one"}}}
	m := New(Config{SettingsBackend: backend, InitialDraft: "/subagents"})
	openSubagents(t, m)
	m.Update(key(tea.KeyDown))
	m.Update(key(tea.KeyDown)) // normal model row
	m.Update(key(tea.KeyEnter))
	items := m.settingsItems()
	if items[0].value != "" || items[1].value != "gone/model" || !strings.Contains(items[1].description, "Current setting") {
		t.Fatalf("initial items = %#v", items)
	}
	for _, r := range "btwo" {
		m.Update(textKey(string(r)))
	}
	items = m.settingsItems()
	if len(items) != 1 || items[0].value != "beta/two" {
		t.Fatalf("filtered items = %#v", items)
	}
	if !strings.Contains(m.settingsView(), "btwo") {
		t.Fatal("query not rendered")
	}
}

func TestSubagentsMalformedLoadAndSaveErrorsAreVisibleAndSanitized(t *testing.T) {
	backend := &settingsBackendStub{
		profiles:  SubagentProfiles{SubagentFast: {Thinking: "wild"}},
		modelsErr: errors.New("catalog bad\x1b[2J"), saveErr: errors.New("write bad\x1b]0;title\x07"),
	}
	m := New(Config{SettingsBackend: backend, InitialDraft: "/subagents"})
	openSubagents(t, m)
	view := m.settingsView()
	if !strings.Contains(view, "invalid thinking level") || !strings.Contains(view, "catalog bad") || strings.Contains(m.settings.err, "\x1b") {
		t.Fatalf("load error view = %q", view)
	}
	// Replace malformed draft, then exercise backend save failure.
	m.settings.draft = SubagentProfiles{}
	m.settings.selected = 6
	m.Update(key(tea.KeyEnter))
	if !m.settings.open || len(backend.saves) != 1 || !strings.Contains(m.settingsView(), "write bad") || strings.Contains(m.settings.err, "\x1b") {
		t.Fatalf("save failure state: open=%v saves=%d view=%q", m.settings.open, len(backend.saves), m.settingsView())
	}
}

func TestSubagentsUnavailableBackendIsVisible(t *testing.T) {
	m := New(Config{InitialDraft: "/subagents"})
	openSubagents(t, m)
	if !strings.Contains(m.settingsView(), "settings backend unavailable") {
		t.Fatalf("view = %q", m.settingsView())
	}
}
