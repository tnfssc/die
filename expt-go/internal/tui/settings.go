package tui

import (
	"fmt"
	"sort"
	"strings"
	"unicode"

	tea "charm.land/bubbletea/v2"
)

// SubagentType identifies one of the configurable task profiles.
type SubagentType string

const (
	SubagentFast         SubagentType = "fast"
	SubagentNormal       SubagentType = "normal"
	SubagentOrchestrator SubagentType = "orchestrator"
)

var subagentTypes = []SubagentType{SubagentFast, SubagentNormal, SubagentOrchestrator}
var thinkingLevels = []string{"off", "minimal", "low", "medium", "high", "xhigh", "max"}

// SubagentProfile uses empty fields to mean inherit from the calling agent.
type SubagentProfile struct{ Model, Thinking string }
type SubagentProfiles map[SubagentType]SubagentProfile

// ProfileModel is a model available for selection in a task profile.
type ProfileModel struct{ Provider, ID, Name string }

// SettingsBackend owns loading and atomically persisting settings. The TUI does
// no settings file I/O.
type SettingsBackend interface {
	GetSubagentProfiles() (SubagentProfiles, error)
	SaveSubagentProfiles(SubagentProfiles) error
	ListModels() ([]ProfileModel, error)
}

type settingsScreen uint8

const (
	settingsProfiles settingsScreen = iota
	settingsModel
	settingsThinking
)

type settingsItem struct{ value, label, description string }
type settingsState struct {
	open          bool
	screen        settingsScreen
	row, selected int
	profileType   SubagentType
	draft         SubagentProfiles
	models        []ProfileModel
	query, err    string
}

func cloneProfiles(in SubagentProfiles) SubagentProfiles {
	out := make(SubagentProfiles, len(subagentTypes))
	for _, typ := range subagentTypes {
		out[typ] = in[typ]
	}
	return out
}

func containsString(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}

func validateProfiles(in SubagentProfiles) error {
	for typ := range in {
		if typ != SubagentFast && typ != SubagentNormal && typ != SubagentOrchestrator {
			return fmt.Errorf("invalid sub-agent profile %q", typ)
		}
	}
	for _, typ := range subagentTypes {
		p := in[typ]
		if p.Model != "" && (!strings.Contains(p.Model, "/") || strings.TrimSpace(p.Model) != p.Model || strings.ContainsAny(p.Model, " \t\r\n") || strings.HasPrefix(p.Model, "/") || strings.HasSuffix(p.Model, "/")) {
			return fmt.Errorf("invalid model for %s: use provider/model", typ)
		}
		if p.Thinking != "" && !containsString(thinkingLevels, p.Thinking) {
			return fmt.Errorf("invalid thinking level for %s: %q", typ, p.Thinking)
		}
	}
	return nil
}

func (m *Model) openSettings() {
	m.settings = settingsState{open: true, profileType: SubagentFast, draft: make(SubagentProfiles)}
	if m.settingsBackend == nil {
		m.settings.err = "settings backend unavailable"
		return
	}
	profiles, err := m.settingsBackend.GetSubagentProfiles()
	if err != nil {
		m.settings.err = sanitize(err.Error())
	} else if err = validateProfiles(profiles); err != nil {
		m.settings.err = sanitize(err.Error())
	} else {
		m.settings.draft = cloneProfiles(profiles)
	}
	models, modelErr := m.settingsBackend.ListModels()
	if modelErr != nil {
		if m.settings.err != "" {
			m.settings.err += "; "
		}
		m.settings.err += sanitize(modelErr.Error())
	} else {
		seen := map[string]bool{}
		for _, model := range models {
			model.Provider, model.ID, model.Name = sanitize(model.Provider), sanitize(model.ID), sanitize(model.Name)
			value := model.Provider + "/" + model.ID
			if model.Provider == "" || model.ID == "" || seen[value] {
				continue
			}
			seen[value] = true
			m.settings.models = append(m.settings.models, model)
		}
		sort.Slice(m.settings.models, func(i, j int) bool { return modelValue(m.settings.models[i]) < modelValue(m.settings.models[j]) })
	}
}

func modelValue(m ProfileModel) string { return m.Provider + "/" + m.ID }

func (m *Model) settingsItems() []settingsItem {
	s := &m.settings
	if s.screen == settingsProfiles {
		items := make([]settingsItem, 0, 8)
		for _, typ := range subagentTypes {
			p := s.draft[typ]
			model, thinking := p.Model, p.Thinking
			if model == "" {
				model = "Inherit from parent"
			}
			if thinking == "" {
				thinking = "Inherit from parent"
			}
			items = append(items,
				settingsItem{string(typ) + ":model", string(typ) + " model", model},
				settingsItem{string(typ) + ":thinking", string(typ) + " thinking", thinking})
		}
		return append(items, settingsItem{"save", "Save", "Apply to future sub-agents"}, settingsItem{"cancel", "Cancel", "Discard changes"})
	}
	if s.screen == settingsThinking {
		items := []settingsItem{{"", "Inherit from parent", "Calling agent's thinking level"}}
		for _, level := range thinkingLevels {
			items = append(items, settingsItem{level, level, ""})
		}
		return items
	}
	p := s.draft[s.profileType]
	all := []settingsItem{{"", "Inherit from parent", "Calling agent's model"}}
	foundCurrent := p.Model == ""
	for _, model := range s.models {
		value := modelValue(model)
		description := model.Provider
		if model.Name != "" && model.Name != model.ID {
			description += " · " + model.Name
		}
		if value == p.Model {
			description += " · Current setting"
			foundCurrent = true
		}
		all = append(all, settingsItem{value, model.ID, description})
	}
	if !foundCurrent {
		all = append([]settingsItem{all[0], {p.Model, p.Model, "Current setting · unavailable in this catalog"}}, all[1:]...)
	}
	query := strings.TrimSpace(strings.ToLower(s.query))
	if query == "" {
		return all
	}
	filtered := make([]settingsItem, 0, len(all))
	for _, item := range all {
		hay := strings.ToLower(item.value + " " + item.description + " " + item.label)
		if fuzzyMatch(hay, query) {
			filtered = append(filtered, item)
		}
	}
	exact := strings.ReplaceAll(query, " ", "/")
	sort.SliceStable(filtered, func(i, j int) bool {
		ie := strings.ToLower(filtered[i].value) == exact || strings.ToLower(filtered[i].label) == exact
		je := strings.ToLower(filtered[j].value) == exact || strings.ToLower(filtered[j].label) == exact
		return ie && !je
	})
	return filtered
}

func fuzzyMatch(haystack, needle string) bool {
	if strings.Contains(haystack, needle) {
		return true
	}
	n := []rune(needle)
	at := 0
	for _, r := range []rune(haystack) {
		if at < len(n) && r == n[at] {
			at++
		}
	}
	return at == len(n)
}

func (m *Model) handleSettingsKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	s := &m.settings
	items := m.settingsItems()
	key := msg.Keystroke()
	switch key {
	case "esc":
		if s.screen == settingsProfiles {
			s.open = false
		} else {
			s.screen = settingsProfiles
			s.query = ""
			s.selected = s.row
		}
	case "up", "ctrl+p":
		if len(items) > 0 {
			s.selected = (s.selected + len(items) - 1) % len(items)
			if s.screen == settingsProfiles {
				s.row = s.selected
			}
		}
	case "down", "ctrl+n":
		if len(items) > 0 {
			s.selected = (s.selected + 1) % len(items)
			if s.screen == settingsProfiles {
				s.row = s.selected
			}
		}
	case "pgup":
		s.selected = max(0, s.selected-10)
	case "pgdown":
		s.selected = min(max(0, len(items)-1), s.selected+10)
	case "enter":
		if len(items) == 0 || s.selected >= len(items) {
			return m, nil
		}
		item := items[s.selected]
		if s.screen == settingsProfiles {
			if item.value == "cancel" {
				s.open = false
				return m, nil
			}
			if item.value == "save" {
				if m.settingsBackend == nil {
					s.err = "settings backend unavailable"
					return m, nil
				}
				if err := validateProfiles(s.draft); err != nil {
					s.err = sanitize(err.Error())
					return m, nil
				}
				if err := m.settingsBackend.SaveSubagentProfiles(cloneProfiles(s.draft)); err != nil {
					s.err = sanitize(err.Error())
					return m, nil
				}
				s.open = false
				return m, nil
			}
			parts := strings.SplitN(item.value, ":", 2)
			s.profileType = SubagentType(parts[0])
			s.row = s.selected
			s.selected = 0
			if parts[1] == "model" {
				s.screen = settingsModel
			} else {
				s.screen = settingsThinking
			}
			child := m.settingsItems()
			current := s.draft[s.profileType]
			wanted := current.Model
			if s.screen == settingsThinking {
				wanted = current.Thinking
			}
			for i, it := range child {
				if it.value == wanted {
					s.selected = i
					break
				}
			}
		} else {
			p := s.draft[s.profileType]
			if s.screen == settingsModel {
				p.Model = item.value
			} else {
				p.Thinking = item.value
			}
			s.draft[s.profileType] = p
			s.screen = settingsProfiles
			s.query = ""
			s.selected = s.row
			s.err = ""
		}
	case "backspace":
		if s.screen == settingsModel && s.query != "" {
			r := []rune(s.query)
			s.query = string(r[:len(r)-1])
			s.selected = 0
		}
	default:
		if s.screen == settingsModel && msg.Text != "" {
			for _, r := range msg.Text {
				if !unicode.IsControl(r) {
					s.query += string(r)
				}
			}
			s.selected = 0
		}
	}
	items = m.settingsItems()
	if s.selected >= len(items) {
		s.selected = max(0, len(items)-1)
	}
	return m, nil
}

func (m *Model) settingsView() string {
	s := &m.settings
	title := "Sub-agent profiles"
	if s.screen == settingsModel {
		title = string(s.profileType) + " · model"
	}
	if s.screen == settingsThinking {
		title = string(s.profileType) + " · thinking"
	}
	lines := []string{accent.Render(title), ""}
	if s.screen == settingsModel {
		lines = append(lines, "Search models or providers… "+s.query, "")
	}
	items := m.settingsItems()
	if len(items) == 0 {
		lines = append(lines, muted.Render("No matching models."))
	}
	room := max(1, m.height-len(lines)-3)
	start := max(0, min(s.selected-room/2, len(items)-room))
	for i := start; i < len(items) && i < start+room; i++ {
		mark := "  "
		if i == s.selected {
			mark = "> "
		}
		line := mark + items[i].label
		if items[i].description != "" {
			line += " · " + items[i].description
		}
		lines = append(lines, line)
	}
	if s.screen == settingsModel && len(s.models) == 0 {
		lines = append(lines, muted.Render("No configured models. Configure a provider first."))
	}
	help := "↑↓ navigate · Enter edit/select · Esc discard"
	if s.screen != settingsProfiles {
		help = "↑↓ navigate · Enter select · Esc back"
	}
	lines = append(lines, muted.Render(help))
	if s.err != "" {
		lines = append(lines, errorStyle.Render(s.err))
	}
	return strings.Join(lines, "\n")
}
