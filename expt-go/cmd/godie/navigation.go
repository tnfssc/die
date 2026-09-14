package main

import (
	"context"
	"sync"
	"sync/atomic"

	"godie/internal/app"
	"godie/internal/core"
	"godie/internal/herdr"
	"godie/internal/resources"
	"godie/internal/tui"
)

// interactiveRestart is returned only after the old TUI and background event
// pump have stopped. mainRun then closes the old runtime/session before opening
// the replacement application.
type interactiveRestart struct{ Options app.Options }

type navigationController struct {
	mu      sync.Mutex
	request *app.NavigationRequest
	exit    func()
}

func (n *navigationController) navigate(r app.NavigationRequest) {
	n.mu.Lock()
	if n.request == nil {
		copy := r
		n.request = &copy
	}
	exit := n.exit
	n.mu.Unlock()
	exit()
}
func (n *navigationController) result() *interactiveRestart {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.request == nil {
		return nil
	}
	return &interactiveRestart{Options: n.request.Options}
}

func runInteractive(parent context.Context, a *app.Application, draft string) (*interactiveRestart, error) {
	ctx, cancel := context.WithCancel(parent)
	nav := &navigationController{}
	defer cancel()

	a.Interactive = true
	reporter, _ := herdr.FromEnvironment(a.Options.Depth == 0, true)
	if reporter != nil {
		defer reporter.Close()
		reporter.Session(a.Session.File(), a.Session.ID())
		reporter.State(herdr.Idle)
		var working atomic.Bool
		a.Observer = func(e core.StreamEvent) {
			switch e.Type {
			case "turn_start":
				working.Store(true)
			case "turn_end":
				working.Store(false)
			case "job":
			default:
				return
			}
			if working.Load() || a.Runtime.Running() > 0 {
				reporter.State(herdr.Working)
			} else {
				reporter.State(herdr.Idle)
			}
		}
	}

	external := make(chan tui.Event, 128)
	// Navigation must quit gracefully: cancelling Bubble Tea skips its input-loop
	// join, allowing an old reader to consume keys in the replacement TUI.
	nav.exit = func() {
		select {
		case external <- tui.Event{Kind: tui.EventQuit}:
		case <-ctx.Done():
		}
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = a.Background(ctx, uiEmit(func(e tui.Event) {
			select {
			case external <- e:
			case <-ctx.Done():
			}
		}, a))
	}()

	backend := uiBackend{a: a, navigation: nav}
	messages, _ := a.Session.Messages()
	cfg := tui.Config{Events: external, Backend: backend, JobBackend: backend, SettingsBackend: backend, Title: "die · " + a.Options.Provider + "/" + a.Options.Model, Version: app.Version, InitialPrompt: draft, Footer: uiFooter(a)}
	cfg.SlashCommands = resourceSlashCommands(a.Resources)
	for _, m := range messages {
		role := tui.RoleAssistant
		if m.Role == "user" {
			role = tui.RoleUser
			cfg.History = append(cfg.History, m.Content)
		} else if m.Role != "assistant" {
			continue
		}
		cfg.Messages = append(cfg.Messages, tui.Message{Role: role, Text: m.Content})
	}
	_, err := tui.Run(ctx, cfg)
	cancel()
	<-done
	if restart := nav.result(); restart != nil {
		return restart, nil
	}
	return nil, err
}

func resourceSlashCommands(set resources.Set) []tui.SlashCommand {
	commands := make([]tui.SlashCommand, 0, len(set.Templates)+len(set.Skills))
	for _, template := range set.Templates {
		description := template.Description
		if template.ArgumentHint != "" {
			if description != "" {
				description = template.ArgumentHint + " — " + description
			} else {
				description = template.ArgumentHint
			}
		}
		commands = append(commands, tui.SlashCommand{Name: template.Name, Description: description})
	}
	for _, skill := range set.Skills {
		commands = append(commands, tui.SlashCommand{Name: "skill:" + skill.Name, Description: skill.Description})
	}
	return commands
}
