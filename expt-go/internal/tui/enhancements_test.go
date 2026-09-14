package tui

import (
	"errors"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
)

type jobBackendStub struct {
	backendStub
	jobs                []Job
	output              string
	inspectID           string
	inspectLimit        int
	stopped             []string
	inspectErr, stopErr error
}

func (b *jobBackendStub) ListJobs() []Job { return append([]Job(nil), b.jobs...) }
func (b *jobBackendStub) InspectJob(id string, limit int) (string, error) {
	b.inspectID = id
	b.inspectLimit = limit
	return b.output, b.inspectErr
}
func (b *jobBackendStub) StopJob(id string) error {
	b.stopped = append(b.stopped, id)
	return b.stopErr
}

func ctrl(r rune) tea.KeyPressMsg { return tea.KeyPressMsg(tea.Key{Code: r, Mod: tea.ModCtrl}) }

func TestRealTerminalBoundsIncludingTinySizes(t *testing.T) {
	m := New(Config{Title: strings.Repeat("wide", 20), Messages: []Message{{Role: RoleAssistant, Text: strings.Repeat("\u754C", 100)}}})
	for _, size := range [][2]int{{20, 4}, {9, 3}, {2, 1}, {1, 1}, {0, 0}} {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		view := m.View().Content
		lines := strings.Split(view, "\n")
		if view == "" {
			lines = nil
		}
		if len(lines) > size[1] {
			t.Errorf("%dx%d: %d rows", size[0], size[1], len(lines))
		}
		for _, line := range lines {
			if w := ansi.StringWidth(line); w > size[0] {
				t.Errorf("%dx%d: line width %d: %q", size[0], size[1], w, line)
			}
		}
		if m.width != size[0] || m.height != size[1] {
			t.Errorf("size was clamped: %dx%d", m.width, m.height)
		}
	}
}

func TestPSOverlayPreservesDraftSelectsInspectsAndConfirmsStop(t *testing.T) {
	jb := &jobBackendStub{jobs: []Job{{ID: "b", Title: "build", Status: "running"}, {ID: "a", Title: "agent", Status: "running"}}, output: "first\n\x1b[31mlast\x1b[0m"}
	m := New(Config{Backend: jb, InitialDraft: "/ps"})
	m.Update(tea.WindowSizeMsg{Width: 40, Height: 8})
	m.Update(key(tea.KeyEnter))
	if !m.overlay {
		t.Fatal("/ps did not open overlay")
	}
	if got := m.Draft(); got != "/ps" {
		t.Fatalf("draft = %q", got)
	}
	m.Update(key(tea.KeyDown)) // sorted a,b => b
	m.Update(key(tea.KeyEnter))
	if jb.inspectID != "b" || jb.inspectLimit != inspectLimit {
		t.Fatalf("inspect = %q, %d", jb.inspectID, jb.inspectLimit)
	}
	if strings.Contains(m.overlayOutput, "\x1b") || !strings.Contains(m.overlayOutput, "last") {
		t.Fatalf("unsafe inspection: %q", m.overlayOutput)
	}
	m.Update(key(tea.KeyEscape))
	m.Update(key('s'))
	m.Update(key('q'))
	if len(jb.stopped) != 0 {
		t.Fatal("job stopped without confirmation")
	}
	m.Update(key(tea.KeyEnter))
	if len(jb.stopped) != 1 || jb.stopped[0] != "b" {
		t.Fatalf("stopped = %#v", jb.stopped)
	}
	m.Update(key(tea.KeyEscape))
	if m.overlay {
		t.Fatal("overlay did not close")
	}
	if got := m.Draft(); got != "/ps" {
		t.Fatalf("restored draft = %q", got)
	}
}

func TestStopErrorAndCancelConfirmation(t *testing.T) {
	jb := &jobBackendStub{jobs: []Job{{ID: "1", Status: "running"}}, stopErr: errors.New("nope\x1b[2J")}
	m := New(Config{Backend: jb, InitialDraft: "/ps"})
	m.Update(key(tea.KeyEnter)) // /ps remains the job command; Ctrl+P cycles models.
	m.Update(key('s'))
	m.Update(key('n'))
	if len(jb.stopped) != 0 {
		t.Fatal("n did not cancel")
	}
	m.Update(key('s'))
	m.Update(key('y'))
	if len(jb.stopped) != 1 || strings.Contains(m.overlayErr, "\x1b") {
		t.Fatalf("stop/error = %#v %q", jb.stopped, m.overlayErr)
	}
	m.Update(key(tea.KeyEscape))
	if got := m.Draft(); got != "/ps" {
		t.Fatalf("draft = %q", got)
	}
}

func TestSanitizesUntrustedEventsJobsAndInitialMessages(t *testing.T) {
	bad := "ok\x1b[2J\x1b]0;owned\x07\r\x00end\u202e"
	m := New(Config{Messages: []Message{{Role: RoleSystem, Text: bad}}})
	m.applyEvent(Event{Kind: EventAssistantDelta, Text: bad})
	m.applyEvent(Event{Kind: EventStatus, Text: bad, Detail: bad})
	m.applyEvent(Event{Kind: EventJobUpsert, Job: Job{ID: "id\x1b[H", Title: bad, Status: bad}})
	for _, msg := range m.Messages() {
		if strings.ContainsAny(msg.Text+msg.Detail, "\x1b\r\x00") || strings.Contains(msg.Text+msg.Detail, "\u202e") {
			t.Fatalf("unsafe message: %#v", msg)
		}
	}
	for _, j := range m.jobs {
		if strings.Contains(j.ID+j.Title+j.Status, "\x1b") {
			t.Fatalf("unsafe job: %#v", j)
		}
	}
}

func TestNoticesDetailsAndMessageBoundary(t *testing.T) {
	m := New(Config{})
	m.applyEvent(Event{Kind: EventAssistantDelta, Text: "provider"})
	m.applyEvent(Event{Kind: EventMessageBoundary})
	m.applyEvent(Event{Kind: EventAssistantDelta, Text: "tool"})
	m.applyEvent(Event{Kind: EventNotice, Text: "notice", Detail: "detail text"})
	m.applyEvent(Event{Kind: EventStatus, Text: "working"})
	msgs := m.Messages()
	if len(msgs) != 3 || msgs[0].Text != "provider" || msgs[1].Text != "tool" || msgs[2].Role != RoleSystem || m.status != "working" {
		t.Fatalf("messages = %#v", msgs)
	}
	m.Update(tea.WindowSizeMsg{Width: 80, Height: 60})
	if strings.Contains(m.View().Content, "detail text") {
		t.Fatal("detail initially open")
	}
	m.Update(ctrl('o'))
	if !strings.Contains(m.View().Content, "detail text") {
		t.Fatal("ctrl+o did not expand detail")
	}
}

func TestOversizedInspectionIsBoundedAtUTF8Boundary(t *testing.T) {
	jb := &jobBackendStub{jobs: []Job{{ID: "1"}}, output: strings.Repeat("\u754C", inspectLimit)}
	m := New(Config{Backend: jb, InitialDraft: "/ps"})
	m.Update(key(tea.KeyEnter))
	m.Update(key(tea.KeyEnter))
	if len(m.overlayOutput) > inspectLimit {
		t.Fatalf("output bytes = %d", len(m.overlayOutput))
	}
	if strings.ContainsRune(m.overlayOutput, '\uFFFD') {
		t.Fatal("inspection split UTF-8")
	}
}
