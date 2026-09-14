package tui

import (
	"sort"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

// SlashCommand is a completion entry. Name excludes the leading slash.
type SlashCommand struct {
	Name        string
	Description string
}

// BuiltinSlashCommands is the TUI catalog for commands handled by app.Application.
// Keeping this explicit means the menu never advertises unrelated Pi commands.
var BuiltinSlashCommands = []SlashCommand{
	{"help", "Show available commands"}, {"status", "Show session and runtime status"},
	{"ps", "Open background jobs"}, {"goal", "Manage the product goal"},
	{"history", "Search product history"}, {"session", "Show session information"},
	{"sessions", "List sessions"}, {"tree", "Show the session tree"},
	{"resume", "Resume a session or branch"}, {"export", "Export the session"},
	{"branch", "Show or resume a branch"}, {"model", "Select model"},
	{"thinking", "Set thinking level"}, {"mode", "Set agent mode"},
	{"subagents", "Open subagent settings"}, {"shake", "Run context shake"},
	{"compact", "Compact session context"}, {"fast", "Configure fast mode"},
	{"cache-ttl", "Configure prompt cache TTL"}, {"memory", "Manage memory"},
	{"diagnostics", "Show diagnostics"},
	{"new", "Start a new session"}, {"fork", "Fork the current session"}, {"clone", "Clone the current session"}, {"quit", "Quit godie"}, {"exit", "Quit godie"},
}

type slashCompletionState struct {
	commands []SlashCommand
	items    []SlashCommand
	selected int
	open     bool
}

func mergeSlashCommands(extra []SlashCommand) []SlashCommand {
	out := make([]SlashCommand, 0, len(BuiltinSlashCommands)+len(extra))
	seen := make(map[string]bool)
	for _, group := range [][]SlashCommand{BuiltinSlashCommands, extra} {
		for _, command := range group {
			if sanitize(command.Name) != command.Name {
				continue
			}
			command.Name = strings.TrimPrefix(strings.TrimSpace(command.Name), "/")
			command.Description = strings.Join(strings.Fields(sanitize(command.Description)), " ")
			if command.Name == "" || strings.ContainsAny(command.Name, " \t\r\n/") || seen[command.Name] {
				continue
			}
			seen[command.Name] = true
			out = append(out, command)
		}
	}
	return out
}

func fuzzySlash(commands []SlashCommand, prefix string) []SlashCommand {
	prefix = strings.ToLower(prefix)
	prefixRunes := []rune(prefix)
	starts, fuzzy := []SlashCommand{}, []SlashCommand{}
	for _, command := range commands {
		name := strings.ToLower(command.Name)
		if strings.HasPrefix(name, prefix) {
			starts = append(starts, command)
			continue
		}
		pos := 0
		for _, r := range name {
			if pos < len(prefixRunes) && r == prefixRunes[pos] {
				pos++
			}
		}
		if pos == len(prefixRunes) {
			fuzzy = append(fuzzy, command)
		}
	}
	// Extra resources are discovery ordered; deterministic tie ordering makes the
	// menu stable even when callers build catalogs from maps.
	sort.SliceStable(fuzzy, func(i, j int) bool { return fuzzy[i].Name < fuzzy[j].Name })
	return append(starts, fuzzy...)
}

func (m *Model) updateSlashCompletion() {
	value := m.editor.Value()
	// Match Pi's command context: slash must be column zero on a single line,
	// and completion stops after the command-name separator.
	if !strings.HasPrefix(value, "/") || strings.ContainsAny(value, " \t\r\n") {
		m.completion.close()
		return
	}
	items := fuzzySlash(m.completion.commands, strings.TrimPrefix(value, "/"))
	if len(items) == 0 {
		m.completion.close()
		return
	}
	m.completion.items, m.completion.open = items, true
	m.completion.selected = 0
	prefix := strings.TrimPrefix(value, "/")
	for i, item := range items {
		if item.Name == prefix {
			m.completion.selected = i
			break
		}
	}
}

func (s *slashCompletionState) close() { s.open = false; s.items = nil; s.selected = 0 }
func (s *slashCompletionState) move(delta int) {
	if len(s.items) == 0 {
		return
	}
	s.selected = (s.selected + delta + len(s.items)) % len(s.items)
}
func (m *Model) applySlashCompletion() {
	if !m.completion.open || len(m.completion.items) == 0 {
		return
	}
	m.editor.SetValue("/" + m.completion.items[m.completion.selected].Name + " ")
	m.editor.CursorEnd()
	m.completion.close()
	m.layout()
}
func (m *Model) slashCompletionView() string {
	if !m.completion.open {
		return ""
	}
	limit := m.completionHeight()
	if limit == 0 {
		return ""
	}
	start := 0
	if m.completion.selected >= limit {
		start = m.completion.selected - limit + 1
	}
	lines := make([]string, 0, limit)
	for i := start; i < min(start+limit, len(m.completion.items)); i++ {
		item := m.completion.items[i]
		marker := "  "
		style := muted
		if i == m.completion.selected {
			marker = "› "
			style = accent
		}
		label := "/" + item.Name
		line := marker + label
		if item.Description != "" {
			gap := 24 - ansi.StringWidth(line)
			if gap < 2 {
				gap = 2
			}
			line += strings.Repeat(" ", gap) + item.Description
		}
		lines = append(lines, style.Render(ansi.Truncate(line, max(1, m.width), "")))
	}
	return lipgloss.NewStyle().PaddingLeft(2).Render(strings.Join(lines, "\n"))
}
func (m *Model) completionHeight() int {
	if !m.completion.open {
		return 0
	}
	return min(7, len(m.completion.items), max(0, m.height-m.editor.Height()-m.jobHeight()-1))
}
