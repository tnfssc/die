package tui

import (
	"fmt"
	"sort"
	"strings"

	tea "charm.land/bubbletea/v2"
)

const inspectLimit = 16 * 1024

func (m *Model) openJobs() {
	m.overlay, m.overlayInspect, m.overlayConfirm = true, false, false
	m.overlayDraft = m.editor.Value()
	m.overlayErr = ""
	m.refreshOverlay()
	m.editor.Blur()
}

func (m *Model) closeJobs() tea.Cmd {
	m.overlay = false
	m.overlayInspect, m.overlayConfirm = false, false
	m.editor.SetValue(m.overlayDraft)
	return m.editor.Focus()
}

func (m *Model) refreshOverlay() {
	if m.jobBackend == nil {
		m.overlayJobs = nil
		m.overlayErr = "job backend unavailable"
		return
	}
	old := ""
	if m.overlaySel >= 0 && m.overlaySel < len(m.overlayJobs) {
		old = m.overlayJobs[m.overlaySel].ID
	}
	jobs := m.jobBackend.ListJobs()
	m.overlayJobs = make([]Job, 0, len(jobs))
	for _, j := range jobs {
		if j.ID != "" {
			m.overlayJobs = append(m.overlayJobs, j)
		}
	}
	sort.SliceStable(m.overlayJobs, func(i, j int) bool { return m.overlayJobs[i].ID < m.overlayJobs[j].ID })
	m.overlaySel = 0
	for i, j := range m.overlayJobs {
		if j.ID == old {
			m.overlaySel = i
			break
		}
	}
	if m.overlaySel >= len(m.overlayJobs) {
		m.overlaySel = max(0, len(m.overlayJobs)-1)
	}
}

func (m *Model) handleOverlayKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	key := msg.Keystroke()
	if m.overlayConfirm {
		switch key {
		case "esc", "n":
			m.overlayConfirm = false
		case "enter", "y":
			if m.jobBackend != nil && m.overlaySel < len(m.overlayJobs) {
				id := m.overlayJobs[m.overlaySel].ID
				if err := m.jobBackend.StopJob(id); err != nil {
					m.overlayErr = sanitize(err.Error())
				} else {
					m.overlayErr = "stop requested for " + sanitize(id)
				}
				m.overlayConfirm = false
				m.refreshOverlay()
			}
		}
		return m, nil
	}
	switch key {
	case "esc":
		if m.overlayInspect {
			m.overlayInspect = false
			m.overlayOutput = ""
			return m, nil
		}
		return m, m.closeJobs()
	case "up", "k":
		if len(m.overlayJobs) > 0 {
			m.overlaySel = (m.overlaySel + len(m.overlayJobs) - 1) % len(m.overlayJobs)
			m.overlayInspect = false
		}
	case "down", "j":
		if len(m.overlayJobs) > 0 {
			m.overlaySel = (m.overlaySel + 1) % len(m.overlayJobs)
			m.overlayInspect = false
		}
	case "enter", "i":
		if len(m.overlayJobs) > 0 && m.jobBackend != nil {
			m.overlayInspect = !m.overlayInspect
			m.overlayErr = ""
			if m.overlayInspect {
				out, err := m.jobBackend.InspectJob(m.overlayJobs[m.overlaySel].ID, inspectLimit)
				m.overlayOutput = sanitize(out)
				if len(m.overlayOutput) > inspectLimit {
					start := len(m.overlayOutput) - inspectLimit
					for start < len(m.overlayOutput) && (m.overlayOutput[start]&0xc0) == 0x80 {
						start++
					}
					m.overlayOutput = m.overlayOutput[start:]
				}
				if err != nil {
					m.overlayErr = sanitize(err.Error())
				}
			}
		}
	case "s", "x":
		if len(m.overlayJobs) > 0 {
			m.overlayConfirm = true
		}
	case "r":
		m.refreshOverlay()
	case "ctrl+c":
		return m, m.closeJobs()
	}
	return m, nil
}

func (m *Model) overlayView() string {
	lines := []string{accent.Render("Running jobs")}
	if m.overlayInspect && len(m.overlayJobs) > 0 {
		j := m.overlayJobs[m.overlaySel]
		lines = append(lines, fmt.Sprintf("%s · %s", sanitize(j.ID), sanitize(j.Status)))
		if j.Detail != "" {
			lines = append(lines, sanitize(j.Detail))
		}
		out := strings.Split(m.overlayOutput, "\n")
		room := max(0, m.height-len(lines)-2)
		if len(out) > room {
			out = out[len(out)-room:]
		}
		lines = append(lines, out...)
		lines = append(lines, "esc back · i close")
	} else {
		if len(m.overlayJobs) == 0 {
			lines = append(lines, muted.Render("No running jobs."))
		} else {
			room := max(1, m.height-3)
			start := max(0, min(m.overlaySel-room/2, len(m.overlayJobs)-room))
			for i := start; i < len(m.overlayJobs) && i < start+room; i++ {
				j := m.overlayJobs[i]
				mark := "  "
				if i == m.overlaySel {
					mark = "> "
				}
				title := sanitize(j.Title)
				if title == "" {
					title = sanitize(j.ID)
				}
				lines = append(lines, mark+title+" · "+sanitize(j.Status))
			}
		}
		lines = append(lines, "↑↓ select · enter inspect · s stop · esc close")
	}
	if m.overlayConfirm && len(m.overlayJobs) > 0 {
		lines[len(lines)-1] = errorStyle.Render("Stop " + sanitize(m.overlayJobs[m.overlaySel].ID) + "? y/enter confirm · n/esc cancel")
	}
	if m.overlayErr != "" {
		lines = append(lines, errorStyle.Render(m.overlayErr))
	}
	return strings.Join(lines, "\n")
}
