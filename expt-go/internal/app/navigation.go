package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"godie/internal/session"
)

// NavigationRequest describes an interactive session replacement. Options is a
// complete copy of the current application identity with only session-selection
// and one-shot CLI fields reset.
type NavigationRequest struct {
	Command      string
	PreviousPath string
	Options      Options
}

// PrepareNavigation validates and materializes an interactive session command.
// The caller must close the current Application before opening request.Options.
// handled is false for ordinary prompts and slash commands.
func PrepareNavigation(a *Application, text string) (request NavigationRequest, handled bool, err error) {
	trimmed := strings.TrimSpace(text)
	name, argument, _ := strings.Cut(trimmed, " ")
	argument = strings.TrimSpace(argument)
	switch name {
	case "/new", "/resume", "/fork", "/clone":
		handled = true
	default:
		return NavigationRequest{}, false, nil
	}
	if !a.Interactive {
		return NavigationRequest{}, true, errors.New("session navigation is available only in an interactive session")
	}
	if !a.Engine.mu.TryLock() {
		return NavigationRequest{}, true, errors.New("wait until the current request finishes before navigating sessions")
	}
	defer a.Engine.mu.Unlock()
	if a.Runtime.Running() != 0 {
		return NavigationRequest{}, true, errors.New("cannot navigate sessions while jobs are running")
	}
	if a.Options.Depth > 0 || a.Options.InternalAgent {
		return NavigationRequest{}, true, errors.New("child sessions cannot navigate to another session")
	}
	if a.Options.NoSession {
		return NavigationRequest{}, true, errors.New("session navigation is unavailable with --no-session")
	}

	next := navigationOptions(a.Options)
	switch name {
	case "/new":
		if argument != "" {
			return NavigationRequest{}, true, errors.New("usage: /new")
		}
		next.Session = ""
	case "/resume":
		if argument == "" {
			// Preserve the catalog-only /resume surface when no target is supplied.
			return NavigationRequest{}, false, nil
		}
		match, e := ResolveSessionArgument(argument, next.CWD, next.SessionDir)
		if e != nil {
			return NavigationRequest{}, true, e
		}
		next.Session = match.Path
	case "/clone":
		if argument != "" {
			return NavigationRequest{}, true, errors.New("usage: /clone")
		}
		target, e := copyNavigationBranch(a.Session.File(), "", next.CWD, next.SessionDir)
		if e != nil {
			return NavigationRequest{}, true, e
		}
		next.Session = target
	case "/fork":
		if strings.ContainsAny(argument, " \t\r\n") {
			return NavigationRequest{}, true, errors.New("usage: /fork [entry-id]")
		}
		leaf := a.Session.LeafID()
		if argument != "" {
			leaf = argument
		}
		target, e := copyNavigationBranch(a.Session.File(), leaf, next.CWD, next.SessionDir)
		if e != nil {
			return NavigationRequest{}, true, e
		}
		next.Session = target
	}
	return NavigationRequest{Command: name, PreviousPath: a.Session.File(), Options: next}, true, nil
}

func navigationOptions(current Options) Options {
	next := current
	next.Session = ""
	next.SessionID = ""
	next.Fork = ""
	next.Export = ""
	next.Name = ""
	next.Command = ""
	next.Execute = ""
	next.Messages = nil
	next.FileArgs = nil
	next.Continue = false
	next.Resume = false
	next.Help = false
	next.ShowVersion = false
	next.ListModels = false
	next.Licenses = false
	return next
}

func copyNavigationBranch(source, leaf, cwd, dir string) (target string, err error) {
	r, err := session.OpenReadOnly(source)
	if err != nil {
		return "", err
	}
	var entries []session.Entry
	if leaf == "" {
		entries, err = r.Branch()
	} else {
		entries, err = r.Branch(leaf)
	}
	if err != nil {
		return "", fmt.Errorf("cannot fork at %q: %w", leaf, err)
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	id := newID("session")
	target = filepath.Join(dir, id+".jsonl")
	s, err := session.New(session.Config{SessionFile: target, ID: id, CWD: cwd, Metadata: session.Metadata{ParentSessionFile: r.File()}})
	if err != nil {
		return "", err
	}
	closed, ok := false, false
	defer func() {
		if !closed {
			_ = s.Close()
		}
		if !ok {
			_ = os.Remove(target)
		}
	}()
	for _, entry := range entries {
		if entry.Message != nil {
			_, err = s.AppendMessageWithUsage(*entry.Message, entry.Usage)
		} else if entry.CustomType != "" {
			_, err = s.AppendCustom(entry.CustomType, entry.Data)
		}
		if err != nil {
			return "", err
		}
	}
	if err = s.Close(); err != nil {
		return "", err
	}
	closed, ok = true, true
	return target, nil
}
