package tui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

func TestSlashCompletionAppearsFiltersAndCompletesWithTab(t *testing.T) {
	m := New(Config{InitialDraft: "/", SlashCommands: []SlashCommand{{Name: "deploy", Description: "project template"}, {Name: "skill:review", Description: "review skill"}}})
	if !m.completion.open || len(m.completion.items) < len(BuiltinSlashCommands)+2 {
		t.Fatalf("slash menu not populated: %#v", m.completion.items)
	}
	if view := m.View().Content; !strings.Contains(view, "Show available commands") {
		t.Fatalf("menu missing catalog entries: %q", view)
	}

	m = New(Config{InitialDraft: "/dep", SlashCommands: []SlashCommand{{Name: "deploy", Description: "project template"}}})
	if len(m.completion.items) != 1 || m.completion.items[0].Name != "deploy" {
		t.Fatalf("prefix matches = %#v", m.completion.items)
	}
	m.Update(key(tea.KeyTab))
	if got := m.Draft(); got != "/deploy " {
		t.Fatalf("tab completion = %q", got)
	}
	if m.completion.open {
		t.Fatal("menu remained open after completion")
	}
}

func TestSlashCompletionNavigationAndEnterSubmitSelected(t *testing.T) {
	backend := &backendStub{}
	m := New(Config{Backend: backend, InitialDraft: "/", SlashCommands: []SlashCommand{{Name: "z-last"}}})
	first := m.completion.items[0].Name
	m.Update(key(tea.KeyDown))
	selected := m.completion.items[m.completion.selected].Name
	if selected == first {
		t.Fatal("down did not navigate")
	}
	_, cmd := m.Update(key(tea.KeyEnter))
	if cmd == nil || !m.active || m.Draft() != "" || m.completion.open {
		t.Fatalf("Enter must complete and submit in one action; draft=%q active=%v", m.Draft(), m.active)
	}
	if len(m.history) != 1 || m.history[0] != "/"+selected {
		t.Fatalf("submitted history=%q", m.history)
	}
}

func TestSlashCompletionDoesNotStealTextMultilineOrArguments(t *testing.T) {
	for _, draft := range []string{"hello /", " /help", "first\n/hel", "/model openai"} {
		m := New(Config{InitialDraft: draft})
		if m.completion.open {
			t.Errorf("completion opened for %q", draft)
		}
		before := m.Draft()
		m.Update(key(tea.KeyTab))
		if strings.HasPrefix(draft, "hello") && m.Draft() != before {
			t.Errorf("tab stole arbitrary text %q -> %q", before, m.Draft())
		}
	}
}

func TestSlashCompletionFuzzyMatchesSkillName(t *testing.T) {
	m := New(Config{InitialDraft: "/skrv", SlashCommands: []SlashCommand{{Name: "skill:review", Description: "review"}}})
	if !m.completion.open || len(m.completion.items) != 1 || m.completion.items[0].Name != "skill:review" {
		t.Fatalf("fuzzy skill match = %#v", m.completion.items)
	}
}

func TestSlashCompletionClearedByCancelAndNewline(t *testing.T) {
	m := New(Config{InitialDraft: "/comp"})
	m.Update(tea.KeyPressMsg(tea.Key{Code: 'c', Mod: tea.ModCtrl}))
	if m.Draft() != "" || m.completion.open {
		t.Fatal("Ctrl+C left a stale completion")
	}
	m = New(Config{InitialDraft: "/comp"})
	m.Update(tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter, Mod: tea.ModShift}))
	if m.completion.open || !strings.Contains(m.Draft(), "\n") {
		t.Fatalf("newline retained menu/draft=%q", m.Draft())
	}
}
func TestSlashCompletionNavigationCommandsAndUnsafeNames(t *testing.T) {
	for _, name := range []string{"new", "fork", "clone"} {
		m := New(Config{InitialDraft: "/" + name})
		if !m.completion.open || m.completion.items[m.completion.selected].Name != name {
			t.Fatalf("missing /%s", name)
		}
	}
	for _, c := range mergeSlashCommands([]SlashCommand{{Name: "bad\x1b[2J"}}) {
		if strings.HasPrefix(c.Name, "bad") {
			t.Fatal("unsafe completion name accepted")
		}
	}
}

func TestSlashCompletionCursorAnchoredToEditor(t *testing.T) {
	m := New(Config{InitialDraft: "/comp"})
	before := m.View()
	if before.Cursor == nil || before.Cursor.Y != 0 {
		t.Fatalf("cursor not on input: %+v", before.Cursor)
	}
	m.Update(key(tea.KeyTab))
	after := m.View()
	if after.Cursor == nil || after.Cursor.Y != 0 || m.completion.open {
		t.Fatalf("closed menu moved cursor: %+v", after.Cursor)
	}
}
func TestSlashCompletionEscapePreservesDraftAndActiveTurn(t *testing.T) {
	b := &backendStub{}
	m := New(Config{Backend: b, InitialDraft: "/comp"})
	m.active = true
	m.Update(key(tea.KeyEscape))
	if m.Draft() != "/comp" || m.completion.open || b.cancelled || !m.active {
		t.Fatal("escape should only dismiss completion")
	}
}
