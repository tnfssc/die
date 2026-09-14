// Package tui implements godie's interactive terminal user interface.
package tui

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"charm.land/bubbles/v2/textarea"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

// Backend connects the terminal to the application without coupling either
// package's data model. Submit may block until the turn ends. It should call
// emit whenever displayable state changes.
type Backend interface {
	Submit(ctx context.Context, prompt string, emit EmitFunc) error
	Cancel()
}

// JobBackend is an optional capability implemented by Backend (or supplied in Config).
// InspectJob must return at most maxBytes of the job's most recent output.
type JobBackend interface {
	ListJobs() []Job
	InspectJob(id string, maxBytes int) (string, error)
	StopJob(id string) error
}

// QueueBackend is an optional capability implemented by Backend. Queue returns
// false when the active turn has already settled, in which case the TUI falls
// back to a normal submission. followUp distinguishes Alt+Enter from steering.
type QueueBackend interface {
	Queue(prompt string, followUp bool) bool
}

// ModelBackend is an optional capability implemented by Backend. Model names use
// the same provider/model values returned by SettingsBackend.ListModels.
type ModelBackend interface {
	CurrentModel() string
	SelectModel(model string) error
}

type EmitFunc func(Event)

type EventKind uint8

const (
	EventAssistantDelta EventKind = iota + 1
	EventStatus
	EventJobUpsert
	EventJobRemove
	EventDone
	EventError
	EventNotice
	EventMessageBoundary
	EventExecutePreview
	EventBusy
	EventFooter
	EventQuit
)

type Event struct {
	Kind EventKind
	Text string
	Job  Job
	// Detail is optional foldable status/execute detail.
	Detail string
	Footer FooterState
}

type Job struct {
	ID      string
	Title   string
	Status  string
	Started time.Time
	Detail  string
}

type Role uint8

const (
	RoleUser Role = iota + 1
	RoleAssistant
	RoleSystem
)

type Message struct {
	Role     Role
	Text     string
	Detail   string
	Foldable bool
}

// FooterState is the compact, always-visible session summary. Empty fields get
// conservative display defaults; integration can update it with EventFooter.
type FooterState struct {
	Project  string
	Mode     string
	Cost     string
	Context  string
	Cache    string
	Provider string
}

type Config struct {
	// SlashCommands augments the built-in command catalog (templates and skills).
	SlashCommands   []SlashCommand
	Events          <-chan Event
	Backend         Backend
	JobBackend      JobBackend
	QueueBackend    QueueBackend
	ModelBackend    ModelBackend
	SettingsBackend SettingsBackend
	Title           string
	Version         string
	Placeholder     string
	InitialDraft    string
	InitialPrompt   string
	History         []string
	Messages        []Message
	Footer          FooterState
}

type initialPromptMsg string

type submitResult struct {
	err    error
	serial uint64
}
type eventMsg Event
type tickMsg time.Time

// Model is a Bubble Tea v2 model. It is intentionally pointer-backed so the
// value returned by New also contains the final draft/history after Run.
type Model struct {
	initialPrompt   string
	backend         Backend
	jobBackend      JobBackend
	queueBackend    QueueBackend
	modelBackend    ModelBackend
	settingsBackend SettingsBackend
	ctx             context.Context
	events          chan Event
	external        <-chan Event

	editor         textarea.Model
	viewport       viewport.Model
	width, height  int
	title, version string

	messages     []Message
	history      []string
	historyIndex int
	historyDraft string
	jobs         map[string]Job
	status       string
	active       bool
	following    bool
	ticking      bool
	detailsOpen  bool
	runSerial    uint64
	boundary     bool
	lastCtrlC    time.Time
	footer       FooterState
	transcript   string

	modelPicker modelPickerState

	overlay        bool
	overlayDraft   string
	overlayJobs    []Job
	overlaySel     int
	overlayInspect bool
	overlayConfirm bool
	overlayOutput  string
	overlayErr     string

	settings settingsState

	completion slashCompletionState
}

func New(cfg Config) *Model {
	ed := textarea.New()
	ed.SetVirtualCursor(false)
	ed.Placeholder = sanitize(cfg.Placeholder)
	ed.Prompt = " "
	ed.ShowLineNumbers = false
	ed.DynamicHeight = true
	ed.MinHeight = 1
	ed.MaxHeight = 6
	ed.MaxContentHeight = 80
	ed.SetValue(sanitize(cfg.InitialDraft))
	ed.Focus()

	vp := viewport.New(viewport.WithWidth(80), viewport.WithHeight(16))
	vp.SoftWrap = true
	vp.FillHeight = false

	title := sanitize(cfg.Title)
	if title == "" {
		title = "die"
	}
	footer := sanitizeFooter(cfg.Footer)
	if footer.Project == "" {
		if cwd, err := os.Getwd(); err == nil {
			footer.Project = filepath.Base(cwd)
		}
	}
	if footer.Project == "" {
		footer.Project = "/"
	}
	if footer.Mode == "" {
		footer.Mode = "orchestrator"
	}
	if footer.Cost == "" {
		footer.Cost = "$0.000"
	}
	if footer.Context == "" {
		footer.Context = "ctx ?"
	}
	if footer.Cache == "" {
		footer.Cache = "cache est ?"
	}
	if footer.Provider == "" {
		footer.Provider = "unknown"
		if parts := strings.SplitN(title, " · ", 2); len(parts) == 2 && parts[1] != "" {
			footer.Provider = parts[1]
		}
	}
	jb := cfg.JobBackend
	if jb == nil {
		jb, _ = cfg.Backend.(JobBackend)
	}
	qb := cfg.QueueBackend
	if qb == nil {
		qb, _ = cfg.Backend.(QueueBackend)
	}
	mb := cfg.ModelBackend
	if mb == nil {
		mb, _ = cfg.Backend.(ModelBackend)
	}
	if mb == nil {
		mb, _ = cfg.SettingsBackend.(ModelBackend)
	}
	m := &Model{initialPrompt: cfg.InitialPrompt,
		external: cfg.Events, backend: cfg.Backend, jobBackend: jb, queueBackend: qb, modelBackend: mb, settingsBackend: cfg.SettingsBackend, ctx: context.Background(), events: make(chan Event, 128),
		editor: ed, viewport: vp, width: 80, height: 24,
		title: title, version: sanitize(cfg.Version),
		history:  sanitizeStrings(cfg.History),
		messages: sanitizeMessages(cfg.Messages), jobs: make(map[string]Job),
		following: true, footer: footer,
	}
	m.historyIndex = len(m.history)
	m.layout()
	m.completion.commands = mergeSlashCommands(cfg.SlashCommands)
	m.updateSlashCompletion()
	m.refreshTranscript()
	return m
}

func (m *Model) Init() tea.Cmd {
	cmds := []tea.Cmd{m.editor.Focus(), m.waitEvent()}
	if m.initialPrompt != "" {
		text := m.initialPrompt
		m.initialPrompt = ""
		cmds = append(cmds, func() tea.Msg { return initialPromptMsg(text) })
	}
	return tea.Batch(cmds...)
}

// SendEvent allows integration code outside Submit to update status and jobs.
// It returns false if ctx is cancelled before the event can be queued.
func (m *Model) SendEvent(ctx context.Context, event Event) bool {
	select {
	case m.events <- event:
		return true
	case <-ctx.Done():
		return false
	}
}

func (m *Model) Draft() string       { return m.editor.Value() }
func (m *Model) History() []string   { return append([]string(nil), m.history...) }
func (m *Model) Messages() []Message { return append([]Message(nil), m.messages...) }
func (m *Model) Active() bool        { return m.active }

func tick() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m *Model) waitEvent() tea.Cmd {
	return func() tea.Msg {
		select {
		case e := <-m.events:
			return eventMsg(e)
		case e := <-m.external:
			return eventMsg(e)
		case <-m.ctx.Done():
			return tea.Quit()
		}
	}
}

func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case initialPromptMsg:
		m.editor.SetValue(string(msg))
		return m.submit()
	case tea.WindowSizeMsg:
		m.width, m.height = max(0, msg.Width), max(0, msg.Height)
		m.layout()
		m.refreshTranscript()
		return m, nil
	case eventMsg:
		if Event(msg).Kind == EventQuit {
			return m, tea.Quit
		}
		m.applyEvent(Event(msg))
		m.layout()
		m.refreshTranscript()
		cmds := []tea.Cmd{m.waitEvent()}
		if len(m.jobs) > 0 && !m.ticking {
			m.ticking = true
			cmds = append(cmds, tick())
		}
		return m, tea.Batch(cmds...)
	case tickMsg:
		m.refreshTranscript()
		if m.overlay {
			m.refreshOverlay()
		}
		if len(m.jobs) == 0 && !m.overlay {
			m.ticking = false
			return m, nil
		}
		return m, tick()
	case submitResult:
		if msg.serial != m.runSerial {
			return m, nil
		}
		if msg.err != nil {
			m.applyEvent(Event{Kind: EventError, Text: msg.err.Error()})
		} else if m.active {
			m.applyEvent(Event{Kind: EventDone})
		}
		m.layout()
		m.refreshTranscript()
		return m, nil
	case tea.KeyPressMsg:
		if m.settings.open {
			return m.handleSettingsKey(msg)
		}
		if m.modelPicker.open {
			return m.handleModelPickerKey(msg)
		}
		if m.overlay {
			return m.handleOverlayKey(msg)
		}
		key := msg.Keystroke()
		switch key {
		case "up":
			if m.completion.open {
				m.completion.move(-1)
				return m, nil
			}
			if !strings.Contains(m.editor.Value(), "\n") && len(m.history) > 0 {
				m.olderHistory()
				return m, nil
			}
		case "down":
			if m.completion.open {
				m.completion.move(1)
				return m, nil
			}
			if !strings.Contains(m.editor.Value(), "\n") && m.historyIndex < len(m.history) {
				m.newerHistory()
				return m, nil
			}
		case "tab":
			if m.completion.open {
				m.applySlashCompletion()
				return m, nil
			}
		case "ctrl+p":
			m.cycleModel(1)
			return m, nil
		case "ctrl+shift+p":
			m.cycleModel(-1)
			return m, nil
		case "ctrl+l":
			m.openModelPicker()
			return m, nil
		case "ctrl+o":
			m.detailsOpen = !m.detailsOpen
			m.refreshTranscript()
			return m, nil
		case "ctrl+c":
			m.completion.close()
			now := time.Now()
			if !m.active && m.editor.Value() == "" && !m.lastCtrlC.IsZero() && now.Sub(m.lastCtrlC) < 500*time.Millisecond {
				return m, tea.Quit
			}
			m.editor.SetValue("")
			m.completion.close()
			m.historyIndex = len(m.history)
			m.historyDraft = ""
			m.lastCtrlC = now
			m.layout()
			return m, nil
		case "ctrl+d":
			if m.editor.Value() == "" {
				return m, tea.Quit
			}
		case "enter":
			if m.completion.open && m.editor.Value() != "/"+m.completion.items[m.completion.selected].Name {
				m.applySlashCompletion()
			}
			return m.submitOrQueue(false)
		case "alt+enter":
			return m.submitOrQueue(true)
		case "shift+enter", "ctrl+j":
			return m.insertNewline()
		case "esc":
			if m.completion.open {
				m.completion.close()
				m.layout()
				return m, nil
			}
			if m.active {
				if m.backend != nil {
					m.backend.Cancel()
				}
				m.status = "cancelling…"
				return m, nil
			}
			if m.historyIndex != len(m.history) {
				m.historyIndex = len(m.history)
				m.editor.SetValue(m.historyDraft)
				return m, nil
			}
		case "pgup", "pgdown", "home", "end":
			var cmd tea.Cmd
			m.viewport, cmd = m.viewport.Update(msg)
			m.following = m.viewport.AtBottom()
			return m, cmd
		}
	}

	var cmd tea.Cmd
	m.editor, cmd = m.editor.Update(msg)
	m.updateSlashCompletion()
	m.layout()
	return m, cmd
}

func (m *Model) insertNewline() (tea.Model, tea.Cmd) {
	m.completion.close()
	plain := tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter})
	var cmd tea.Cmd
	m.editor, cmd = m.editor.Update(plain)
	m.layout()
	return m, cmd
}

func (m *Model) submitOrQueue(followUp bool) (tea.Model, tea.Cmd) {
	m.completion.close()
	prompt := sanitize(strings.TrimSpace(m.editor.Value()))
	if !m.active || prompt == "" {
		return m.submit()
	}
	if m.queueBackend == nil {
		m.status = "turn running · draft kept"
		return m, nil
	}
	if !m.queueBackend.Queue(prompt, followUp) {
		// Queue's false result is authoritative: the engine settled between the
		// key press and enqueue, so start this as a regular turn.
		m.active = false
		return m.submit()
	}
	m.history = appendWithoutImmediateDuplicate(m.history, prompt)
	m.historyIndex = len(m.history)
	m.historyDraft = ""
	m.messages = append(m.messages, Message{Role: RoleUser, Text: prompt})
	m.editor.SetValue("")
	if followUp {
		m.status = "follow-up queued"
	} else {
		m.status = "steering queued"
	}
	m.following = true
	m.layout()
	m.refreshTranscript()
	return m, nil
}

func (m *Model) submit() (tea.Model, tea.Cmd) {
	if p := strings.TrimSpace(m.editor.Value()); p == "/quit" || p == "/exit" {
		if m.backend != nil {
			m.backend.Cancel()
		}
		return m, tea.Quit
	}
	if strings.TrimSpace(m.editor.Value()) == "/subagents" {
		m.openSettings()
		return m, nil
	}
	if strings.TrimSpace(m.editor.Value()) == "/ps" {
		m.openJobs()
		if !m.ticking {
			m.ticking = true
			return m, tick()
		}
		return m, nil
	}
	prompt := sanitize(strings.TrimSpace(m.editor.Value()))
	if prompt == "" {
		return m, nil
	}
	if m.active {
		m.status = "turn running · draft kept"
		return m, nil
	}

	m.history = appendWithoutImmediateDuplicate(m.history, prompt)
	m.historyIndex = len(m.history)
	m.historyDraft = ""
	m.messages = append(m.messages, Message{Role: RoleUser, Text: prompt}, Message{Role: RoleAssistant})
	m.editor.SetValue("")
	m.active, m.following, m.status = true, true, "thinking…"
	m.layout()
	m.refreshTranscript()

	m.runSerial++
	serial := m.runSerial
	backend, ctx := m.backend, m.ctx
	return m, func() tea.Msg {
		if backend == nil {
			return submitResult{err: errors.New("no backend configured"), serial: serial}
		}
		err := backend.Submit(ctx, prompt, func(e Event) {
			select {
			case m.events <- e:
			case <-ctx.Done():
			}
		})
		return submitResult{err: err, serial: serial}
	}
}

func (m *Model) olderHistory() {
	if m.historyIndex == len(m.history) {
		m.historyDraft = m.editor.Value()
	}
	if m.historyIndex > 0 {
		m.historyIndex--
		m.editor.SetValue(m.history[m.historyIndex])
	}
}
func (m *Model) newerHistory() {
	if m.historyIndex >= len(m.history) {
		return
	}
	m.historyIndex++
	if m.historyIndex == len(m.history) {
		m.editor.SetValue(m.historyDraft)
	} else {
		m.editor.SetValue(m.history[m.historyIndex])
	}
}

func appendWithoutImmediateDuplicate(history []string, prompt string) []string {
	if len(history) == 0 || history[len(history)-1] != prompt {
		return append(history, prompt)
	}
	return history
}

func (m *Model) applyEvent(e Event) {
	e.Text = sanitize(e.Text)
	e.Detail = sanitize(e.Detail)
	e.Job.ID, e.Job.Title, e.Job.Status, e.Job.Detail = sanitize(e.Job.ID), sanitize(e.Job.Title), sanitize(e.Job.Status), sanitize(e.Job.Detail)
	switch e.Kind {
	case EventAssistantDelta:
		if m.boundary || len(m.messages) == 0 || m.messages[len(m.messages)-1].Role != RoleAssistant {
			m.messages = append(m.messages, Message{Role: RoleAssistant})
		}
		m.messages[len(m.messages)-1].Text += e.Text
		m.boundary = false
	case EventBusy:
		m.runSerial++
		m.active = true
	case EventStatus:
		m.status = e.Text
		if e.Detail != "" {
			if n := len(m.messages); n == 0 || m.messages[n-1].Role != RoleSystem || m.messages[n-1].Text != e.Text || m.messages[n-1].Detail != e.Detail {
				m.messages = append(m.messages, Message{Role: RoleSystem, Text: e.Text, Detail: e.Detail, Foldable: e.Detail != ""})
			}
			m.boundary = true
		}
	case EventJobUpsert:
		if e.Job.ID != "" {
			m.jobs[e.Job.ID] = e.Job
		}
	case EventJobRemove:
		id := e.Job.ID
		if id == "" {
			id = e.Text
		}
		delete(m.jobs, id)
	case EventDone:
		m.active = false
		m.boundary = true
		m.removeEmptyAssistant()
		if e.Text != "" {
			m.status = e.Text
		} else {
			m.status = "ready"
		}
	case EventNotice:
		if e.Text != "" {
			m.messages = append(m.messages, Message{Role: RoleSystem, Text: e.Text, Detail: e.Detail, Foldable: e.Detail != ""})
			m.boundary = true
		}
	case EventExecutePreview:
		if e.Text != "" || e.Detail != "" {
			m.messages = append(m.messages, Message{Role: RoleSystem, Text: e.Text, Detail: e.Detail, Foldable: true})
			m.boundary = true
		}
	case EventMessageBoundary:
		m.boundary = true
	case EventFooter:
		m.footer = mergeFooter(m.footer, sanitizeFooter(e.Footer))
	case EventError:
		m.active = false
		m.status = "error: " + e.Text
		m.removeEmptyAssistant()
		if e.Text != "" {
			m.messages = append(m.messages, Message{Role: RoleSystem, Text: e.Text})
		}
	}
}

func (m *Model) removeEmptyAssistant() {
	for i := len(m.messages) - 1; i >= 0; i-- {
		if m.messages[i].Role == RoleAssistant {
			if m.messages[i].Text == "" {
				m.messages = append(m.messages[:i], m.messages[i+1:]...)
			}
			return
		}
	}
}

func (m *Model) layout() {
	contentW := max(1, m.width)
	m.editor.SetWidth(contentW)
	maxEditor := min(6, max(1, m.height/3))
	m.editor.MaxHeight = maxEditor
	jobsH := m.jobHeight()
	// Inline rendering grows with the transcript instead of painting an empty
	// full-screen viewport. Once full, the viewport provides normal scrollback.
	room := max(1, m.height-jobsH-m.editor.Height()-m.completionHeight()-1)
	lines := transcriptHeight(m.transcript, contentW)
	if lines == 0 {
		lines = 1
	}
	m.viewport.SetWidth(contentW)
	m.viewport.SetHeight(min(room, lines))
}

func transcriptHeight(text string, width int) int {
	if text == "" {
		return 0
	}
	n := 0
	for _, line := range strings.Split(text, "\n") {
		w := max(1, ansi.StringWidth(line))
		n += max(1, (w+max(1, width)-1)/max(1, width))
	}
	return n
}

func (m *Model) jobHeight() int {
	if len(m.jobs) == 0 {
		return 0
	}
	if m.width < 52 {
		return 1
	}
	return min(3, len(m.jobs)+1)
}

var (
	accent         = lipgloss.NewStyle().Foreground(lipgloss.Color("#CBA6F7")).Bold(true)
	muted          = lipgloss.NewStyle().Foreground(lipgloss.Color("#7F849C"))
	userStyle      = lipgloss.NewStyle().Foreground(lipgloss.Color("#89B4FA")).Bold(true)
	assistantStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#A6E3A1")).Bold(true)
	errorStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("#F38BA8"))
)

func (m *Model) refreshTranscript() {
	var b strings.Builder
	for i, msg := range m.messages {
		if i > 0 {
			// User turns retain a leading breathing row; adjacent assistant/system
			// output remains dense, matching the source conversation renderer.
			if msg.Role == RoleUser {
				b.WriteString("\n\n")
			} else {
				b.WriteByte('\n')
			}
		}
		switch msg.Role {
		case RoleUser:
			b.WriteString(userStyle.Render(" "))
			b.WriteString(msg.Text)
		case RoleAssistant:
			if msg.Text == "" && m.active {
				b.WriteString(muted.Render("thinking…"))
			} else {
				b.WriteString(msg.Text)
			}
		default:
			b.WriteString(muted.Render(msg.Text))
		}
		if msg.Foldable {
			if m.detailsOpen && msg.Detail != "" {
				b.WriteString("\n" + muted.Render("▼ details") + "\n" + msg.Detail)
			} else {
				b.WriteString("\n" + muted.Render("▶ details · ctrl+o"))
			}
		}
	}
	wasBottom := m.following || m.viewport.AtBottom()
	m.transcript = b.String()
	m.viewport.SetContent(m.transcript)
	m.layout()
	if wasBottom {
		m.viewport.GotoBottom()
		m.following = true
	}
}

func (m *Model) jobsView() string {
	if len(m.jobs) == 0 {
		return ""
	}
	ids := make([]string, 0, len(m.jobs))
	for id := range m.jobs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	if m.width < 52 {
		return muted.Render(fmt.Sprintf("jobs %d running", len(ids)))
	}
	lines := []string{accent.Render(fmt.Sprintf("jobs (%d)", len(ids)))}
	limit := min(len(ids), 2)
	for _, id := range ids[:limit] {
		j := m.jobs[id]
		title := j.Title
		if title == "" {
			title = id
		}
		elapsed := ""
		if !j.Started.IsZero() {
			elapsed = " · " + shortDuration(time.Since(j.Started))
		}
		lines = append(lines, muted.Render("  "+title+" · "+j.Status+elapsed))
	}
	if len(ids) > limit {
		lines[len(lines)-1] += muted.Render(fmt.Sprintf(" · +%d", len(ids)-limit))
	}
	return strings.Join(lines, "\n")
}

func shortDuration(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	d = d.Round(time.Second)
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	return fmt.Sprintf("%dm%02ds", int(d.Minutes()), int(d.Seconds())%60)
}

func (m *Model) View() tea.View {
	if m.width <= 0 || m.height <= 0 {
		v := tea.NewView("")
		v.WindowTitle = m.title
		return v
	}
	if m.settings.open {
		v := tea.NewView(clampView(m.settingsView(), m.width, m.height))
		v.WindowTitle = m.title
		return v
	}
	if m.modelPicker.open {
		v := tea.NewView(clampView(m.modelPickerView(), m.width, m.height))
		v.WindowTitle = m.title
		return v
	}
	if m.overlay {
		v := tea.NewView(clampView(m.overlayView(), m.width, m.height))
		v.WindowTitle = m.title
		return v
	}
	if m.active {
		m.editor.Prompt = "◐ "
	} else {
		m.editor.Prompt = " "
	}
	parts := make([]string, 0, 5)
	if m.transcript != "" {
		parts = append(parts, m.viewport.View())
	}
	if jobs := m.jobsView(); jobs != "" {
		parts = append(parts, jobs)
	}
	editorY := 0
	for _, part := range parts {
		editorY += strings.Count(part, "\n") + 1
	}
	parts = append(parts, m.editor.View())
	if menu := m.slashCompletionView(); menu != "" {
		parts = append(parts, menu)
	}
	parts = append(parts, m.footerView())
	content := strings.Join(parts, "\n")
	v := tea.NewView(clampView(content, m.width, m.height))
	// Anchor the real terminal cursor to the input, not the last menu/footer
	// row. Inline renderer height changes must not strand its old cursor below
	// the new frame and leave stale completion rows in scrollback.
	v.Cursor = m.editor.Cursor()
	if v.Cursor != nil {
		v.Cursor.Y += editorY
		lines := strings.Count(content, "\n") + 1
		if lines > m.height && v.Cursor.Y > 0 {
			removed := lines - m.height
			if v.Cursor.Y <= removed {
				v.Cursor = nil
			} else {
				v.Cursor.Y -= removed
			}
		}
		if v.Cursor != nil {
			v.Cursor.X = min(max(0, v.Cursor.X), m.width-1)
		}
	}
	v.WindowTitle = m.title
	return v
}

func (m *Model) footerView() string {
	f := m.footer
	leftParts := []string{f.Project}
	if f.Mode != "" {
		leftParts = append(leftParts, "mode: "+f.Mode)
	}
	leftParts = append(leftParts, f.Cost, f.Context, f.Cache)
	left := strings.Join(nonempty(leftParts), " · ")
	right := f.Provider
	if m.width < 1 {
		return ""
	}
	if ansi.StringWidth(left)+2+ansi.StringWidth(right) <= m.width {
		return muted.Render(left + strings.Repeat(" ", m.width-ansi.StringWidth(left)-ansi.StringWidth(right)) + right)
	}
	// Preserve cost/context/provider first as the source footer progressively
	// contracts; never replace product state with generic key hints.
	for _, candidate := range []string{
		strings.Join(nonempty([]string{f.Project, f.Cost, f.Context, f.Cache}), " · ") + "  " + right,
		strings.Join(nonempty([]string{f.Cost, f.Context}), " ") + "  " + right,
		right,
	} {
		if ansi.StringWidth(candidate) <= m.width {
			return muted.Render(candidate)
		}
	}
	return muted.Render(ansi.Truncate(right, m.width, ""))
}

func nonempty(in []string) []string {
	out := make([]string, 0, len(in))
	for _, value := range in {
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func sanitizeFooter(f FooterState) FooterState {
	inline := func(value string) string { return strings.Join(strings.Fields(sanitize(value)), " ") }
	f.Project = inline(f.Project)
	f.Mode = inline(f.Mode)
	f.Cost = inline(f.Cost)
	f.Context = inline(f.Context)
	f.Cache = inline(f.Cache)
	f.Provider = inline(f.Provider)
	return f
}
func mergeFooter(old, next FooterState) FooterState {
	if next.Project != "" {
		old.Project = next.Project
	}
	if next.Mode != "" {
		old.Mode = next.Mode
	}
	if next.Cost != "" {
		old.Cost = next.Cost
	}
	if next.Context != "" {
		old.Context = next.Context
	}
	if next.Cache != "" {
		old.Cache = next.Cache
	}
	if next.Provider != "" {
		old.Provider = next.Provider
	}
	return old
}

func clampView(s string, width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	lines := strings.Split(s, "\n")
	if len(lines) > height {
		if height == 1 {
			lines = lines[:1]
		} else {
			tail := append([]string(nil), lines[len(lines)-(height-1):]...)
			lines = append(lines[:1], tail...)
		}
	}
	for i := range lines {
		lines[i] = ansi.Truncate(lines[i], width, "")
		for n := width - 1; ansi.StringWidth(lines[i]) > width && n >= 0; n-- {
			lines[i] = ansi.Truncate(lines[i], n, "")
		}
	}
	return strings.Join(lines, "\n")
}

// Run creates and runs the inline TUI and returns its final model.
func Run(ctx context.Context, cfg Config) (*Model, error) {
	m := New(cfg)
	if ctx != nil {
		m.ctx = ctx
	}
	result, err := tea.NewProgram(m, tea.WithContext(m.ctx)).Run()
	if final, ok := result.(*Model); ok {
		return final, err
	}
	return m, err
}
