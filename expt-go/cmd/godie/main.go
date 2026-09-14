package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"godie/internal/app"
	"godie/internal/core"
	"godie/internal/notices"
	"godie/internal/provider"
	run "godie/internal/runtime"
	"godie/internal/tui"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() {
	if err := mainRun(); err != nil {
		if errors.Is(err, app.ErrQuit) {
			return
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func mainRun() error {
	_ = os.Setenv("AI_AGENT", "die")
	_ = os.Setenv("PI_CODING_AGENT", "true")
	o, err := app.ParseOptions(os.Args[1:])
	if err != nil {
		return err
	}
	if o.Help {
		fmt.Print(app.HelpText)
		return nil
	}
	if o.ShowVersion {
		fmt.Println(app.Version)
		return nil
	}
	if o.StateDir == "" {
		o.StateDir = os.Getenv("GODIE_STATE_DIR")
		if o.StateDir == "" {
			h, e := os.UserHomeDir()
			if e != nil {
				return e
			}
			o.StateDir = filepath.Join(h, ".godie")
		}
	}
	if o.LoginCodex {
		return app.LoginCodex(context.Background(), o.StateDir, func(s string) { fmt.Println(s) })
	}
	if o.Licenses {
		fmt.Print(notices.Text)
		return nil
	}
	if o.AuthImport != "" {
		if err = provider.ImportCodexAuth(o.AuthImport, o.StateDir); err != nil {
			return err
		}
		fmt.Println("Imported Codex credentials into isolated Godie state; source unchanged.")
		return nil
	}
	if o.ListModels {
		filter := strings.Join(o.Messages, " ")
		models, err := app.ModelsForState(o.StateDir)
		if err != nil {
			return err
		}
		for _, m := range models {
			name := m.Provider + "/" + m.ID
			if filter == "" || strings.Contains(strings.ToLower(name), strings.ToLower(filter)) {
				fmt.Printf("%-48s %8d context  %s\n", name, m.ContextWindow, m.Name)
			}
		}
		return nil
	}
	handled, err := applyCLIParity(&o)
	if err != nil {
		return err
	}
	if handled {
		return nil
	}
	if o.Resume && o.Session == "" {
		dir := o.SessionDir
		if dir == "" {
			dir = filepath.Join(o.StateDir, "sessions")
		}
		v, e := app.ListSessions(dir, "")
		if e != nil {
			return e
		}
		for _, s := range v {
			fmt.Printf("%s  %s  %s\n", s.ID, s.CWD, s.Path)
		}
		return nil
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	for {
		a, e := app.NewApplication(o)
		if e != nil {
			return e
		}
		for _, warning := range a.Resources.Warnings {
			fmt.Fprintln(os.Stderr, "warning:", warning)
		}
		restart, runErr := runApplication(ctx, a, o)
		closeErr := a.Close()
		if restart != nil {
			if closeErr != nil {
				return fmt.Errorf("close previous session before navigation: %w", closeErr)
			}
			o = restart.Options
			continue
		}
		if runErr != nil {
			return runErr
		}
		return closeErr
	}
}

func runApplication(ctx context.Context, a *app.Application, o app.Options) (*interactiveRestart, error) {
	if o.Command != "" {
		out, e := a.Slash(ctx, o.Command)
		if out != "" {
			fmt.Println(out)
		}
		return nil, e
	}
	if o.Execute != "" {
		r, e := a.Runtime.Execute(ctx, o.Execute, 0)
		b, _ := json.Marshal(r)
		fmt.Println(string(b))
		if e != nil {
			return nil, e
		}
		if r.ExitCode != 0 {
			return nil, fmt.Errorf("execute exited %d", r.ExitCode)
		}
		return nil, nil
	}
	if o.Mode == "rpc" {
		return nil, app.RunRPC(ctx, a, os.Stdin, os.Stdout)
	}
	info, _ := os.Stdin.Stat()
	tty := info != nil && (info.Mode()&os.ModeCharDevice) != 0
	if a.Options.Depth > 0 && !o.InternalAgent && !o.ConfirmChild {
		if !tty || o.Print {
			return nil, errors.New("child session resume requires --confirm-child; its persisted delegation limits remain enforced")
		}
		fmt.Fprintf(os.Stderr, "Resume %s child session (depth %d), retaining delegation restrictions? [y/N] ", a.Options.Role, a.Options.Depth)
		answer, e := bufio.NewReader(io.LimitReader(os.Stdin, 128)).ReadString('\n')
		if e != nil || strings.ToLower(strings.TrimSpace(answer)) != "y" {
			return nil, app.ErrQuit
		}
	}
	text := strings.Join(o.Messages, " ")
	if !o.Print && tty {
		return runInteractive(ctx, a, text)
	}
	if text == "" && !tty {
		b, e := io.ReadAll(io.LimitReader(os.Stdin, 16<<20))
		if e != nil {
			return nil, e
		}
		text = string(b)
	}
	if strings.TrimSpace(text) == "" {
		return nil, errors.New("a prompt is required in print mode")
	}
	if o.Mode == "json" {
		emitter := app.NewJSONEmitter(os.Stdout, a)
		emitter.Start(text)
		err := a.Submit(ctx, text, emitter.Emit)
		emitter.End(err)
		return nil, emitter.Err()
	}
	// Plain print mode presents the last assistant only. Streaming belongs to
	// JSON events and the TUI; printing intermediate/background turns duplicates
	// final answers relative to the source CLI.
	finalText := ""
	err := a.Submit(ctx, text, func(e core.StreamEvent) {
		if e.Type == "message" {
			if m, ok := e.Data.(core.Message); ok && m.Role == "assistant" {
				finalText = m.Content
			}
		}
	})
	if err == nil && finalText != "" {
		fmt.Println(finalText)
	}
	return nil, err

}

type uiBackend struct {
	a          *app.Application
	navigation *navigationController
}

func (b uiBackend) Cancel() { b.a.Cancel() }
func (b uiBackend) Submit(ctx context.Context, text string, emit tui.EmitFunc) error {
	if b.navigation != nil {
		request, handled, err := app.PrepareNavigation(b.a, text)
		if handled {
			if err != nil {
				return err
			}
			b.navigation.navigate(request)
			return context.Canceled
		}
	}
	return b.a.Submit(ctx, text, uiEmit(emit, b.a))
}
func uiEmit(emit tui.EmitFunc, applications ...*app.Application) func(core.StreamEvent) {
	return func(e core.StreamEvent) {
		switch e.Type {
		case "text_delta", "text":
			emit(tui.Event{Kind: tui.EventAssistantDelta, Text: e.Text})
		case "error":
			emit(tui.Event{Kind: tui.EventError, Text: e.Text})
		case "notice", "handoff":
			emit(tui.Event{Kind: tui.EventNotice, Text: e.Text})
			if len(applications) > 0 {
				emit(tui.Event{Kind: tui.EventFooter, Footer: uiFooter(applications[0])})
			}
		case "message":
			emit(tui.Event{Kind: tui.EventMessageBoundary})
		case "tool_end":
			data, _ := e.Data.(map[string]any)
			result, _ := data["result"].(core.ExecuteResult)
			detail := result.Output
			if result.Error != "" {
				detail += "\n" + result.Error
			}
			if len(result.Images) > 0 {
				detail += fmt.Sprintf("\n[%d image(s)]", len(result.Images))
			}
			emit(tui.Event{Kind: tui.EventExecutePreview, Text: fmt.Sprintf("execute · exit %d", result.ExitCode), Detail: detail})
		case "turn_start":
			emit(tui.Event{Kind: tui.EventBusy})
			emit(tui.Event{Kind: tui.EventStatus, Text: "working"})
		case "tool_start":
			emit(tui.Event{Kind: tui.EventStatus, Text: "execute"})
		case "turn_end":
			status := "idle"
			if len(applications) > 0 {
				status = applications[0].StatusSummary()
			}
			emit(tui.Event{Kind: tui.EventDone, Text: status})
			if len(applications) > 0 {
				emit(tui.Event{Kind: tui.EventFooter, Footer: uiFooter(applications[0])})
			}
		case "job":
			if v, ok := e.Data.(run.Event); ok {
				started, _ := time.Parse(time.RFC3339Nano, v.Job.StartedAt)
				emit(tui.Event{Kind: tui.EventJobUpsert, Job: tui.Job{ID: v.Job.ID, Title: v.Job.Command, Status: v.Job.Status, Started: started}})
			}
		}
	}
}

func (b uiBackend) ListJobs() []tui.Job {
	v, e := b.a.Runtime.Call(context.Background(), "jobs.list", json.RawMessage(`{"count":100}`))
	if e != nil {
		return nil
	}
	raw, _ := json.Marshal(v)
	var list struct {
		Jobs []run.Job `json:"jobs"`
	}
	if json.Unmarshal(raw, &list) != nil {
		return nil
	}
	out := []tui.Job{}
	for _, j := range list.Jobs {
		t, _ := time.Parse(time.RFC3339Nano, j.StartedAt)
		out = append(out, tui.Job{ID: j.ID, Title: j.Command, Status: j.Status, Started: t})
	}
	return out
}
func (b uiBackend) InspectJob(id string, maxBytes int) (string, error) {
	raw, _ := json.Marshal(map[string]any{"id": id, "limit": maxBytes})
	v, e := b.a.Runtime.Call(context.Background(), "jobs.inspect", raw)
	if e != nil {
		return "", e
	}
	if i, ok := v.(run.Inspection); ok {
		return i.Output, nil
	}
	out, _ := json.Marshal(v)
	return string(out), nil
}
func (b uiBackend) StopJob(id string) error {
	raw, _ := json.Marshal(map[string]string{"id": id})
	_, e := b.a.Runtime.Call(context.Background(), "jobs.stop", raw)
	return e
}

func (b uiBackend) GetSubagentProfiles() (tui.SubagentProfiles, error) {
	profiles, err := app.LoadProfiles(b.a.Options.StateDir)
	if err != nil {
		return nil, err
	}
	out := tui.SubagentProfiles{}
	for k, v := range profiles {
		out[tui.SubagentType(k)] = tui.SubagentProfile{Model: v.Model, Thinking: v.Thinking}
	}
	return out, nil
}
func (b uiBackend) SaveSubagentProfiles(profiles tui.SubagentProfiles) error {
	p := app.Profiles{}
	for k, v := range profiles {
		p[string(k)] = app.Profile{Model: v.Model, Thinking: v.Thinking}
	}
	return app.SaveProfiles(b.a.Options.StateDir, p)
}
func (b uiBackend) ListModels() ([]tui.ProfileModel, error) {
	out := []tui.ProfileModel{}
	models, err := app.ModelsForState(b.a.Options.StateDir)
	if err != nil {
		return nil, err
	}
	for _, m := range models {
		out = append(out, tui.ProfileModel{Provider: m.Provider, ID: m.ID, Name: m.Name})
	}
	return out, nil
}

func (b uiBackend) Queue(prompt string, followUp bool) bool {
	if expanded, ok, err := b.a.Resources.Expand(prompt); err != nil {
		return false
	} else if ok {
		prompt = expanded
	}
	return b.a.Queue(prompt, followUp)
}

func (b uiBackend) CurrentModel() string { return b.a.CurrentModel() }
func (b uiBackend) SelectModel(model string) error {
	_, err := b.a.TrySlash(context.Background(), "/model "+model)
	return err
}

func uiFooter(a *app.Application) tui.FooterState {
	f := a.FooterStatus()
	return tui.FooterState{Project: f.Project, Mode: f.Mode, Cost: f.Cost, Context: f.Context, Cache: f.Cache, Provider: f.Provider}
}
