package app

import (
	"errors"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"godie/internal/session"
)

var sessionIDPattern = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`)

// ValidateSessionID applies the same filesystem-safe ID grammar as the original CLI.
func ValidateSessionID(id string) error {
	if !sessionIDPattern.MatchString(id) {
		return errors.New("session id must be non-empty, contain only alphanumeric characters, '-', '_', and '.', and start and end with an alphanumeric character")
	}
	return nil
}

type SessionMatch struct{ Path, CWD, Scope string }

// ResolveSessionArgument resolves explicit paths first, then exact IDs, then ID prefixes.
// Project-local matches win over matches from another working directory.
func ResolveSessionArgument(arg, cwd, sessionDir string) (SessionMatch, error) {
	if arg == "" {
		return SessionMatch{}, errors.New("session argument is required")
	}
	if strings.ContainsAny(arg, `/\`) || strings.HasSuffix(arg, ".jsonl") {
		p := arg
		if !filepath.IsAbs(p) {
			p = filepath.Join(cwd, p)
		}
		p, err := filepath.Abs(p)
		if err != nil {
			return SessionMatch{}, err
		}
		if st, e := os.Stat(p); e != nil || st.IsDir() {
			if e == nil {
				e = errors.New("session path is a directory")
			}
			return SessionMatch{}, fmt.Errorf("no session found matching %q: %w", arg, e)
		}
		return SessionMatch{Path: p, Scope: "path"}, nil
	}
	all, err := ListSessions(sessionDir, "")
	if err != nil {
		return SessionMatch{}, err
	}
	find := func(local, exact bool) *SessionInfo {
		for i := range all {
			if local && all[i].CWD != cwd {
				continue
			}
			if (exact && all[i].ID == arg) || (!exact && strings.HasPrefix(all[i].ID, arg)) {
				return &all[i]
			}
		}
		return nil
	}
	for _, local := range []bool{true, false} {
		for _, exact := range []bool{true, false} {
			if m := find(local, exact); m != nil {
				scope := "global"
				if m.CWD == cwd {
					scope = "local"
				}
				return SessionMatch{Path: m.Path, CWD: m.CWD, Scope: scope}, nil
			}
		}
	}
	return SessionMatch{}, fmt.Errorf("no session found matching %q", arg)
}

// PrepareCLIOptions resolves selection flags, materializes forks, and expands @files.
func PrepareCLIOptions(o Options) (Options, error) {
	var err error
	if o.CWD == "" {
		o.CWD, err = os.Getwd()
		if err != nil {
			return o, err
		}
	}
	o.CWD, err = filepath.Abs(o.CWD)
	if err != nil {
		return o, err
	}
	if o.SessionDir == "" {
		o.SessionDir = filepath.Join(o.StateDir, "sessions")
	}
	if o.Session != "" {
		m, e := ResolveSessionArgument(o.Session, o.CWD, o.SessionDir)
		if e != nil {
			return o, e
		}
		o.Session = m.Path
	}
	if o.SessionID != "" && o.Fork == "" && !o.NoSession {
		list, e := ListSessions(o.SessionDir, o.CWD)
		if e != nil {
			return o, e
		}
		for _, item := range list {
			if item.ID == o.SessionID {
				o.Session = item.Path
				return prepareFileArgs(o)
			}
		}
		o.Session = filepath.Join(o.SessionDir, o.SessionID+".jsonl")
	}
	if o.Fork != "" {
		m, e := ResolveSessionArgument(o.Fork, o.CWD, o.SessionDir)
		if e != nil {
			return o, e
		}
		target, e := forkSession(m.Path, o.CWD, o.SessionDir, o.SessionID)
		if e != nil {
			return o, e
		}
		o.Session = target
	}
	return prepareFileArgs(o)
}

func forkSession(source, cwd, dir, id string) (string, error) {
	r, err := session.OpenReadOnly(source)
	if err != nil {
		return "", err
	}
	if id == "" {
		id = newID("session")
	}
	if err = ValidateSessionID(id); err != nil {
		return "", err
	}
	target := filepath.Join(dir, id+".jsonl")
	s, err := session.New(session.Config{SessionFile: target, CWD: cwd, ID: id, Metadata: session.Metadata{ParentSessionFile: r.File()}})
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
	entries, err := r.Branch()
	if err != nil {
		return "", err
	}
	for _, e := range entries {
		if e.Message != nil {
			if _, err = s.AppendMessageWithUsage(*e.Message, e.Usage); err != nil {
				return "", err
			}
			continue
		}
		if e.CustomType != "" {
			if _, err = s.AppendCustom(e.CustomType, e.Data); err != nil {
				return "", err
			}
		}
	}
	if err = s.Close(); err != nil {
		return "", err
	}
	closed = true
	ok = true
	return target, nil
}

func prepareFileArgs(o Options) (Options, error) {
	if len(o.FileArgs) == 0 {
		return o, nil
	}
	var b strings.Builder
	imageBytes := 0
	for _, name := range o.FileArgs {
		p, err := expandReadPath(name, o.CWD)
		if err != nil {
			return o, err
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return o, fmt.Errorf("could not read file %s: %w", p, err)
		}
		if len(data) == 0 {
			continue
		}
		image, isImage, err := cliImage(data, p)
		if err != nil {
			return o, err
		}
		if isImage {
			imageBytes += len(data)
			if imageBytes > maxCLIAttachmentBytes {
				return o, fmt.Errorf("CLI image attachments exceed %d bytes in total", maxCLIAttachmentBytes)
			}
			o.Images = append(o.Images, image)
			continue
		}
		if strings.IndexByte(string(data), 0) >= 0 {
			return o, fmt.Errorf("binary @file attachment is not supported: %s", p)
		}
		text := strings.TrimPrefix(string(data), "\ufeff")
		fmt.Fprintf(&b, "<file name=%q>\n%s\n</file>\n", p, text)
	}
	if b.Len() > 0 {
		if len(o.Messages) == 0 {
			o.Messages = []string{b.String()}
		} else {
			o.Messages[0] = b.String() + o.Messages[0]
		}
	}
	return o, nil
}

func expandReadPath(name, cwd string) (string, error) {
	if name == "~" || strings.HasPrefix(name, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		name = filepath.Join(home, strings.TrimPrefix(name, "~/"))
	}
	if !filepath.IsAbs(name) {
		name = filepath.Join(cwd, name)
	}
	return filepath.Abs(name)
}

// ExportSessionHTML exports the selected active branch without taking its writer lock.
func ExportSessionHTML(source, destination string) (string, error) {
	r, err := session.OpenReadOnly(source)
	if err != nil {
		return "", err
	}
	if destination == "" {
		destination = "godie-session-" + r.ID() + ".html"
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return "", err
	}
	f, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	closed, ok := false, false
	defer func() {
		if !closed {
			_ = f.Close()
		}
		if !ok {
			_ = os.Remove(destination)
		}
	}()
	if _, err = fmt.Fprintln(f, `<!doctype html><meta charset="utf-8"><title>Godie session</title><style>body{font:16px system-ui;max-width:70ch;margin:auto;padding:2rem}article{white-space:pre-wrap;border-top:1px solid #ccc;padding:1rem 0}</style>`); err != nil {
		return "", err
	}
	entries, err := r.Branch()
	if err != nil {
		return "", err
	}
	for _, e := range entries {
		if e.Message != nil {
			if _, err = fmt.Fprintf(f, "<article><strong>%s</strong>\n%s</article>\n", html.EscapeString(e.Message.Role), html.EscapeString(e.Message.Content)); err != nil {
				return "", err
			}
		}
	}
	if err = f.Sync(); err != nil {
		return "", err
	}
	if err = f.Close(); err != nil {
		return "", err
	}
	closed = true
	ok = true
	return destination, nil
}
