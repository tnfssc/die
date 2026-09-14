package app

import (
	"errors"
	"fmt"
	"godie/internal/core"
	"strconv"
	"strings"
)

const Version = "0.2.8-go-dev"

type Options struct {
	ThinkingSet                                                                                                                                  bool
	NoContextFiles, IgnoreProject, NoSkills, NoPromptTemplates                                                                                   bool
	Command                                                                                                                                      string
	LoginCodex                                                                                                                                   bool
	ConfirmChild                                                                                                                                 bool
	StateDir, Session, SessionID, Fork, Export, SessionDir, Name, Provider, Model, APIKey, BaseURL, Thinking, System, AppendSystem, BunPath, CWD string
	Mode, Execute, AuthImport, Role, ParentSession, JobID                                                                                        string
	Depth, MaxTurns, MaxTokens                                                                                                                   int
	Print, Offline, NoSession, Continue, Resume, Help, ShowVersion, ListModels, Licenses, InternalAgent                                          bool
	Messages, FileArgs, SkillPaths, PromptTemplatePaths                                                                                          []string
	Images                                                                                                                                       []core.Image
}

func ParseOptions(args []string) (Options, error) {
	o := Options{Thinking: "medium", Mode: "text", MaxTurns: 100}
	positional := false
	for i := 0; i < len(args); i++ {
		a := args[i]
		if positional {
			if strings.HasPrefix(a, "@") && len(a) > 1 {
				o.FileArgs = append(o.FileArgs, a[1:])
			} else {
				o.Messages = append(o.Messages, a)
			}
			continue
		}
		if a == "--" {
			positional = true
			continue
		}
		key, value, hasEq := strings.Cut(a, "=")
		next := func() (string, error) {
			if hasEq {
				return value, nil
			}
			if i+1 >= len(args) {
				return "", fmt.Errorf("%s requires a value", key)
			}
			i++
			return args[i], nil
		}
		var target *string
		if strings.HasPrefix(a, "@") && len(a) > 1 {
			o.FileArgs = append(o.FileArgs, a[1:])
			continue
		}
		switch key {
		case "--login-codex":
			o.LoginCodex = true
		case "--confirm-child":
			o.ConfirmChild = true
		case "--help", "-h":
			o.Help = true
		case "--version", "-v":
			o.ShowVersion = true
		case "--print", "-p":
			o.Print = true
		case "--offline":
			o.Offline = true
		case "--no-session":
			o.NoSession = true
		case "--continue", "-c":
			o.Continue = true
		case "--resume", "-r":
			o.Resume = true
		case "--list-models":
			o.ListModels = true
		case "--licenses":
			o.Licenses = true
		case "--internal-agent":
			o.InternalAgent = true
			o.Print = true
		case "--state-dir":
			target = &o.StateDir
		case "--session":
			target = &o.Session
		case "--session-id":
			target = &o.SessionID
		case "--fork":
			target = &o.Fork
		case "--export":
			target = &o.Export
		case "--session-dir":
			target = &o.SessionDir
		case "--name", "-n":
			target = &o.Name
		case "--provider":
			target = &o.Provider
		case "--model":
			target = &o.Model
		case "--api-key":
			target = &o.APIKey
		case "--base-url":
			target = &o.BaseURL
		case "--thinking":
			o.ThinkingSet = true
			target = &o.Thinking
		case "--system-prompt":
			target = &o.System
		case "--append-system-prompt":
			v, e := next()
			if e != nil {
				return o, e
			}
			v, e = promptArgument(v)
			if e != nil {
				return o, e
			}
			o.AppendSystem += "\n" + v
		case "--bun":
			target = &o.BunPath
		case "--cwd":
			target = &o.CWD
		case "--mode":
			target = &o.Mode
		case "--command":
			target = &o.Command
		case "--execute":
			target = &o.Execute
		case "--import-codex-auth":
			target = &o.AuthImport
		case "--agent-role":
			target = &o.Role
		case "--parent-session":
			target = &o.ParentSession
		case "--job-id":
			target = &o.JobID
		case "--agent-depth", "--max-turns", "--max-tokens":
			v, e := next()
			if e != nil {
				return o, e
			}
			n, e := strconv.Atoi(v)
			if e != nil || n < 0 {
				return o, fmt.Errorf("invalid %s", key)
			}
			switch key {
			case "--agent-depth":
				o.Depth = n
			case "--max-turns":
				o.MaxTurns = n
			case "--max-tokens":
				o.MaxTokens = n
			}
		case "--no-tools", "--no-builtin-tools", "--tools", "--exclude-tools", "-nt", "-nbt", "-t", "-xt":
			return o, fmt.Errorf("%s is not supported by die; its core tool set is fixed by the current product phase.", key)
		case "--skill":
			v, e := next()
			if e != nil {
				return o, e
			}
			o.SkillPaths = append(o.SkillPaths, v)
		case "--prompt-template":
			v, e := next()
			if e != nil {
				return o, e
			}
			o.PromptTemplatePaths = append(o.PromptTemplatePaths, v)
		case "--no-skills", "-ns":
			o.NoSkills = true
		case "--no-prompt-templates", "-np":
			o.NoPromptTemplates = true
		case "--no-context-files", "-nc":
			o.NoContextFiles = true
		case "--approve", "-a":
			o.IgnoreProject = false
		case "--no-approve", "-na":
			o.IgnoreProject = true
		default:
			if strings.HasPrefix(a, "-") {
				return o, fmt.Errorf("Error: Unknown option: %s", key)
			}
			if a == "update" {
				return o, errors.New("die updates are disabled until an update channel is available.")
			}
			o.Messages = append(o.Messages, a)
		}
		if target != nil {
			v, e := next()
			if e != nil {
				return o, e
			}
			*target = v
		}
	}
	if o.Fork != "" {
		var conflicts []string
		if o.Session != "" {
			conflicts = append(conflicts, "--session")
		}
		if o.Continue {
			conflicts = append(conflicts, "--continue")
		}
		if o.Resume {
			conflicts = append(conflicts, "--resume")
		}
		if o.NoSession {
			conflicts = append(conflicts, "--no-session")
		}
		if len(conflicts) > 0 {
			return o, fmt.Errorf("--fork cannot be combined with %s", strings.Join(conflicts, ", "))
		}
	}
	if o.SessionID != "" {
		if err := ValidateSessionID(o.SessionID); err != nil {
			return o, err
		}
		var conflicts []string
		if o.Session != "" {
			conflicts = append(conflicts, "--session")
		}
		if o.Continue {
			conflicts = append(conflicts, "--continue")
		}
		if o.Resume {
			conflicts = append(conflicts, "--resume")
		}
		if len(conflicts) > 0 {
			return o, fmt.Errorf("--session-id cannot be combined with %s", strings.Join(conflicts, ", "))
		}
	}
	if o.Mode == "rpc" && len(o.FileArgs) > 0 {
		return o, errors.New("@file arguments are not supported in RPC mode")
	}
	if o.Mode != "text" && o.Mode != "json" && o.Mode != "rpc" {
		return o, errors.New("--mode must be text, json, or rpc")
	}
	if o.Mode != "text" {
		o.Print = true
	}
	if !strings.Contains("|off|minimal|low|medium|high|xhigh|max|", "|"+o.Thinking+"|") {
		return o, errors.New("invalid thinking level")
	}
	if o.Depth > 0 && !o.InternalAgent {
		return o, errors.New("agent identity flags require internal child mode")
	}
	if o.Model != "" && strings.Contains(o.Model, "/") {
		p, m, _ := strings.Cut(o.Model, "/")
		if o.Provider == "" {
			o.Provider = p
		}
		o.Model = m
	}
	return o, nil
}

const HelpText = `godie - AI coding assistant (experimental Go rewrite)

Usage: godie [options] [--] [@files...] [message ...]

  -p, --print                  Print a response and exit after owned jobs settle
  --mode text|json|rpc          Output mode (RPC compatibility is partial)
  --provider NAME              openai-codex, openai, anthropic, google
  --model MODEL                Model ID or provider/model
  --thinking LEVEL             off|minimal|low|medium|high|xhigh|max
  --api-key KEY                Explicit API key (prefer environment)
  --login-codex                Browser OAuth with isolated Go credentials
  --import-codex-auth PATH      Explicit read-only import into isolated Go state
  --state-dir DIR              State directory (default ~/.godie)
  --session PATH|ID            Resume a session file or partial ID
  --session-id ID              Use an exact project session ID, creating if absent
  --fork PATH|ID               Fork a session file or partial ID
  --export PATH|ID [OUTPUT]    Export a session as self-contained HTML
  -c, --continue               Continue newest session in current directory
  -r, --resume                 List resumable sessions
  --session-dir DIR            Override session directory
  --no-session                 Use temporary session storage
  --name NAME                  Session display name
  --system-prompt TEXT          Override default system prompt
  --append-system-prompt TEXT   Append instructions
  --offline                    Disable all provider network requests
  --skill PATH                 Add a Markdown skill path (repeatable)
  --no-skills                  Disable default skill discovery
  --prompt-template PATH       Add a prompt template path (repeatable)
  --no-prompt-templates        Disable default prompt template discovery
  --command COMMAND           Explicit local slash command (development control)
  --execute CODE               Run execute directly without a provider
  --cwd DIR                    Working directory
  --list-models                Show configured provider/model guidance
  --licenses                   Runtime notices
  -h, --help                   Show help
  -v, --version                Show version

Only execute is exposed as a model tool. Bun is used only for execute.
Existing ~/.die state is never modified. See expt-go/PARITY.md for gaps.
`
