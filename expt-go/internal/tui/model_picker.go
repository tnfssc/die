package tui

import (
	"sort"
	"strings"
	"unicode"

	tea "charm.land/bubbletea/v2"
)

type modelPickerState struct {
	open     bool
	models   []ProfileModel
	selected int
	query    string
	err      string
}

func (m *Model) availableModels() ([]ProfileModel, error) {
	if m.settingsBackend == nil {
		return nil, nil
	}
	models, err := m.settingsBackend.ListModels()
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool)
	out := make([]ProfileModel, 0, len(models))
	for _, model := range models {
		model.Provider = sanitize(model.Provider)
		model.ID = sanitize(model.ID)
		model.Name = sanitize(model.Name)
		value := modelValue(model)
		if model.Provider == "" || model.ID == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, model)
	}
	return out, nil
}

func (m *Model) cycleModel(direction int) {
	if m.modelBackend == nil || m.settingsBackend == nil {
		return
	}
	models, err := m.availableModels()
	if err != nil {
		m.status = sanitize(err.Error())
		return
	}
	if len(models) == 0 {
		m.status = "no configured models"
		return
	}
	current := m.modelBackend.CurrentModel()
	at := -1
	for i, model := range models {
		if modelValue(model) == current || model.ID == current {
			at = i
			break
		}
	}
	if direction < 0 {
		if at < 0 {
			at = 0
		}
		at = (at + len(models) - 1) % len(models)
	} else {
		at = (at + 1) % len(models)
	}
	m.selectModel(models[at])
}

func (m *Model) selectModel(model ProfileModel) {
	value := modelValue(model)
	if err := m.modelBackend.SelectModel(value); err != nil {
		m.status = sanitize(err.Error())
		m.modelPicker.err = m.status
		return
	}
	m.status = "model · " + value
	m.modelPicker.open = false
}

func (m *Model) openModelPicker() {
	if m.modelBackend == nil || m.settingsBackend == nil {
		return
	}
	models, err := m.availableModels()
	m.modelPicker = modelPickerState{open: true, models: models}
	if err != nil {
		m.modelPicker.err = sanitize(err.Error())
		return
	}
	current := m.modelBackend.CurrentModel()
	for i, model := range models {
		if modelValue(model) == current || model.ID == current {
			m.modelPicker.selected = i
			break
		}
	}
}

func (m *Model) filteredModels() []ProfileModel {
	models := append([]ProfileModel(nil), m.modelPicker.models...)
	query := strings.TrimSpace(strings.ToLower(m.modelPicker.query))
	if query == "" {
		return models
	}
	models = models[:0]
	for _, model := range m.modelPicker.models {
		haystack := strings.ToLower(model.Provider + " " + model.ID + " " + model.Name)
		if fuzzyMatch(haystack, query) {
			models = append(models, model)
		}
	}
	// Stable lexical ranking makes filtering deterministic without changing the
	// Settings catalog order when no query is present.
	sort.SliceStable(models, func(i, j int) bool { return modelValue(models[i]) < modelValue(models[j]) })
	return models
}

func (m *Model) handleModelPickerKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	models := m.filteredModels()
	s := &m.modelPicker
	switch msg.Keystroke() {
	case "esc":
		s.open = false
	case "up", "ctrl+p":
		if len(models) > 0 {
			s.selected = (s.selected + len(models) - 1) % len(models)
		}
	case "down", "ctrl+n":
		if len(models) > 0 {
			s.selected = (s.selected + 1) % len(models)
		}
	case "enter":
		if len(models) > 0 && s.selected < len(models) {
			m.selectModel(models[s.selected])
		}
	case "backspace":
		if s.query != "" {
			runes := []rune(s.query)
			s.query = string(runes[:len(runes)-1])
			s.selected = 0
		}
	default:
		if msg.Text != "" {
			for _, r := range msg.Text {
				if !unicode.IsControl(r) {
					s.query += string(r)
				}
			}
			s.selected = 0
		}
	}
	models = m.filteredModels()
	if s.selected >= len(models) {
		s.selected = max(0, len(models)-1)
	}
	return m, nil
}

func (m *Model) modelPickerView() string {
	models := m.filteredModels()
	lines := []string{accent.Render("Select model"), "Search models or providers… " + m.modelPicker.query, ""}
	if len(models) == 0 {
		lines = append(lines, muted.Render("No matching configured models."))
	}
	room := max(1, m.height-len(lines)-2)
	start := max(0, min(m.modelPicker.selected-room/2, len(models)-room))
	for i := start; i < len(models) && i < start+room; i++ {
		mark := "  "
		if i == m.modelPicker.selected {
			mark = "> "
		}
		description := models[i].Provider
		if models[i].Name != "" && models[i].Name != models[i].ID {
			description += " · " + models[i].Name
		}
		if modelValue(models[i]) == m.modelBackend.CurrentModel() || models[i].ID == m.modelBackend.CurrentModel() {
			description += " · Current"
		}
		lines = append(lines, mark+models[i].ID+" · "+description)
	}
	lines = append(lines, muted.Render("↑↓ navigate · Enter select · Esc close"))
	if m.modelPicker.err != "" {
		lines = append(lines, errorStyle.Render(m.modelPicker.err))
	}
	return strings.Join(lines, "\n")
}
