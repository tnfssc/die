package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"godie/internal/core"
	"path/filepath"
	"strings"
)

func (a *Application) Slash(ctx context.Context, text string) (string, error) {
	a.Engine.mu.Lock()
	defer a.Engine.mu.Unlock()
	return a.slashLocked(ctx, text)
}
func (a *Application) TrySlash(ctx context.Context, text string) (string, error) {
	if !a.Engine.mu.TryLock() {
		return "", errors.New("wait until the current request finishes before changing models")
	}
	defer a.Engine.mu.Unlock()
	return a.slashLocked(ctx, text)
}
func (a *Application) slashLocked(ctx context.Context, text string) (string, error) {
	name, args, _ := strings.Cut(strings.TrimSpace(text), " ")
	args = strings.TrimSpace(args)
	switch name {
	case "/help":
		return "/status /ps /goal /history /session /sessions /tree /resume /export /branch /model /thinking /mode /subagents /shake /compact /fast /cache-ttl /memory /diagnostics /quit", nil
	case "/status":
		usage, _ := a.Session.CombinedUsage()
		cache, _ := a.cacheCommand("")
		_ = usage
		_ = cache
		b, _ := json.MarshalIndent(map[string]any{"session": a.Session.File(), "id": a.Session.ID(), "cwd": a.Options.CWD, "provider": a.Options.Provider, "model": a.Options.Model, "thinking": a.Options.Thinking, "role": a.Options.Role, "depth": a.Options.Depth, "runningJobs": a.Runtime.Running(), "usage": usage, "cache": cache, "offline": a.Options.Offline, "fast": a.Engine.Request.Fast}, "", "  ")
		return string(b), nil
	case "/ps":
		v, e := a.Runtime.Call(ctx, "jobs.list", mustJSON(map[string]any{"count": 100}))
		b, _ := json.MarshalIndent(v, "", "  ")
		return string(b), e
	case "/goal":
		return a.Goals.Slash(args)
	case "/history":
		return a.ProductHistoryCommand(ctx, args)
	case "/session", "/tree", "/resume", "/export":
		return a.ProductSessionCommand(name, args)
	case "/sessions":
		v, e := ListSessions(a.Options.SessionDir, a.Options.CWD)
		b, _ := json.MarshalIndent(v, "", "  ")
		return string(b), e
	case "/branch":
		if a.Runtime.Running() > 0 {
			return "", errors.New("cannot branch while jobs are running")
		}
		if args == "" {
			entries, e := a.Session.Branch()
			if e != nil {
				return "", e
			}
			var b strings.Builder
			for _, v := range entries {
				fmt.Fprintf(&b, "%s %s\n", v.ID, v.Type)
			}
			return b.String(), nil
		}
		if e := a.Session.Resume(args); e != nil {
			return "", e
		}
		if e := a.restorePolicyState(); e != nil {
			return "", e
		}
		return "Resumed branch at " + args, nil
	case "/thinking":
		if args == "" {
			return a.Options.Thinking, nil
		}
		if !strings.Contains("|off|minimal|low|medium|high|xhigh|max|", "|"+args+"|") {
			return "", errors.New("invalid thinking level")
		}
		next := a.Options
		next.Thinking = args
		next.ThinkingSet = true
		if err := configureProviderOptions(&next); err != nil {
			return "", err
		}
		a.Options.Thinking = next.Thinking
		a.Options.ThinkingSet = true
		a.Engine.Request.Thinking = next.Thinking
		_, err := a.Session.AppendCustom("thinking_level_change", map[string]string{"thinkingLevel": args})
		return "Thinking: " + args, err
	case "/model":
		if args == "" {
			return a.Options.Provider + "/" + a.Options.Model, nil
		}
		kind, model, ok := strings.Cut(args, "/")
		if !ok {
			kind = a.Options.Provider
			model = args
		}
		if a.Runtime.Running() > 0 {
			return "", errors.New("cannot switch model with running jobs")
		}
		var p core.Provider = offlineProvider{}
		var err error
		next := a.Options
		next.Provider, next.Model = kind, model
		if err = configureProviderOptions(&next); err != nil {
			return "", err
		}
		model = next.Model
		if !a.Options.Offline {
			p, err = newApplicationProvider(next)
			if err != nil {
				return "", err
			}
		}
		a.Options.Provider = kind
		a.Options.Model = model
		a.Options.Thinking = next.Thinking
		a.Engine.Request.Thinking = next.Thinking
		a.Engine.Provider = p
		a.Engine.Request.Model = model
		a.Engine.Request.Provider = kind
		_, err = a.Session.AppendCustom("model_change", map[string]string{"provider": kind, "model": model})
		return "Model: " + kind + "/" + model, err
	case "/mode":
		if args != "fast" && args != "normal" && args != "orchestrator" {
			return "", errors.New("usage: /mode fast|normal|orchestrator")
		}
		if a.Options.Depth > 0 {
			return "", errors.New("child role is fixed by its persisted identity")
		}
		base, e := SystemPrompt(a.Options.CWD, a.Options.StateDir, a.Options.System, a.Options.AppendSystem, "", 0, PromptOptions{NoContextFiles: a.Options.NoContextFiles, IgnoreProject: a.Options.IgnoreProject})
		if e != nil {
			return "", e
		}
		if args == "orchestrator" {
			base += "\n\n" + prompt("main-orchestrator")
		}
		base += a.Resources.FormatSkills()
		a.Engine.Request.System = base
		_, e = a.Session.AppendCustom("die-main-agent-mode", map[string]string{"mode": args})
		return "Mode: " + args, e
	case "/subagents":
		p, e := LoadProfiles(a.Options.StateDir)
		if e != nil {
			return "", e
		}
		b, _ := json.MarshalIndent(p, "", "  ")
		return string(b) + "\nProfiles file: " + filepath.Join(a.Options.StateDir, "subagents.json"), nil
	case "/fast":
		return a.fastCommand(args)
	case "/cache-ttl":
		return a.cacheCommand(args)
	case "/compact":
		return a.compact(ctx)
	case "/shake":
		return a.shake()
	case "/memory":
		return a.memoryCommand(ctx, args)
	case "/diagnostics":
		return a.diagnosticsCommand(args)
	case "/quit", "/exit":
		return "", ErrQuit
	default:
		return "", fmt.Errorf("unknown command %s", name)
	}
}

var ErrQuit = errors.New("quit")

func isBuiltinSlash(text string) bool {
	name, _, _ := strings.Cut(strings.TrimSpace(text), " ")
	switch name {
	case "/help", "/status", "/ps", "/goal", "/history", "/session", "/tree", "/resume", "/export", "/sessions", "/branch", "/thinking", "/model", "/mode", "/subagents", "/fast", "/cache-ttl", "/compact", "/shake", "/memory", "/diagnostics", "/quit", "/exit":
		return true
	}
	return false
}
