package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"godie/internal/core"
	"godie/internal/session"
)

func makeCLISession(t *testing.T, dir, id, cwd string, messages ...string) string {
	t.Helper()
	path := filepath.Join(dir, id+".jsonl")
	s, err := session.New(session.Config{SessionFile: path, ID: id, CWD: cwd})
	if err != nil {
		t.Fatal(err)
	}
	for i, text := range messages {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		if _, err = s.AppendMessage(core.Message{Role: role, Content: text}); err != nil {
			t.Fatal(err)
		}
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestResolveSessionArgumentPrecedence(t *testing.T) {
	dir := t.TempDir()
	local := filepath.Join(dir, "project")
	other := filepath.Join(dir, "other")
	if err := os.MkdirAll(local, 0700); err != nil {
		t.Fatal(err)
	}
	localPath := makeCLISession(t, dir, "abcdef-local", local)
	_ = makeCLISession(t, dir, "abcdef-global", other)
	got, err := ResolveSessionArgument("abcdef", local, dir)
	if err != nil {
		t.Fatal(err)
	}
	if got.Path != localPath || got.Scope != "local" {
		t.Fatalf("unexpected match: %#v", got)
	}
	got, err = ResolveSessionArgument("abcdef-global", local, dir)
	if err != nil {
		t.Fatal(err)
	}
	if got.Scope != "global" || got.CWD != other {
		t.Fatalf("unexpected global match: %#v", got)
	}
	got, err = ResolveSessionArgument(localPath, local, dir)
	if err != nil || got.Scope != "path" {
		t.Fatalf("path: %#v %v", got, err)
	}
}

func TestPrepareCLIOptionsSessionIDForkAndAttachment(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "sessions")
	cwd := filepath.Join(root, "work")
	if err := os.MkdirAll(cwd, 0700); err != nil {
		t.Fatal(err)
	}
	source := makeCLISession(t, dir, "source-123", cwd, "hello", "world")
	note := filepath.Join(cwd, "note.txt")
	if err := os.WriteFile(note, []byte("\ufeffnotes"), 0600); err != nil {
		t.Fatal(err)
	}
	o, err := PrepareCLIOptions(Options{StateDir: root, SessionDir: dir, CWD: cwd, Fork: "source", SessionID: "fork-1", FileArgs: []string{"note.txt"}, Messages: []string{"question"}})
	if err != nil {
		t.Fatal(err)
	}
	if o.Session != filepath.Join(dir, "fork-1.jsonl") {
		t.Fatalf("session=%q source=%q", o.Session, source)
	}
	r, err := session.OpenReadOnly(o.Session)
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := r.Branch()
	if err != nil {
		t.Fatal(err)
	}
	var contents []string
	for _, e := range msgs {
		if e.Message != nil {
			contents = append(contents, e.Message.Content)
		}
	}
	if strings.Join(contents, "|") != "hello|world" {
		t.Fatalf("fork contents %#v", contents)
	}
	if len(o.Messages) != 1 || !strings.Contains(o.Messages[0], "<file name=") || !strings.Contains(o.Messages[0], "notes\n</file>\nquestion") {
		t.Fatalf("prompt=%q", o.Messages)
	}
	fresh, err := PrepareCLIOptions(Options{StateDir: root, SessionDir: dir, CWD: cwd, SessionID: "fresh.id"})
	if err != nil {
		t.Fatal(err)
	}
	if fresh.Session != filepath.Join(dir, "fresh.id.jsonl") {
		t.Fatalf("fresh path %q", fresh.Session)
	}
}

func TestExportSessionHTMLEscapesContent(t *testing.T) {
	dir := t.TempDir()
	source := makeCLISession(t, dir, "export-one", dir, "hello <script>")
	output := filepath.Join(dir, "out.html")
	got, err := ExportSessionHTML(source, output)
	if err != nil {
		t.Fatal(err)
	}
	if got != output {
		t.Fatalf("output %q", got)
	}
	b, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	text := string(b)
	if strings.Contains(text, "<script>") || !strings.Contains(text, "&lt;script&gt;") {
		t.Fatalf("unsafe export: %s", text)
	}
}

func TestValidateSessionID(t *testing.T) {
	for _, id := range []string{"abc", "a-b_c.1"} {
		if err := ValidateSessionID(id); err != nil {
			t.Errorf("%q: %v", id, err)
		}
	}
	for _, id := range []string{"", "-abc", "abc-", "a/b", "a b"} {
		if err := ValidateSessionID(id); err == nil {
			t.Errorf("accepted %q", id)
		}
	}
}
