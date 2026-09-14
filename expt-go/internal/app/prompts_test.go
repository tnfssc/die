package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPromptContextPrecedenceAndTrust(t *testing.T) {
	root := t.TempDir()
	cwd := filepath.Join(root, "project", "sub")
	state := filepath.Join(root, "state")
	os.MkdirAll(cwd, 0700)
	os.MkdirAll(state, 0700)
	for path, text := range map[string]string{filepath.Join(root, "AGENTS.md"): "ANCESTOR_MARKER", filepath.Join(cwd, "CLAUDE.md"): "CLAUDE_MARKER", filepath.Join(cwd, "AGENTS.override.md"): "OVERRIDE_MARKER", filepath.Join(state, "AGENTS.md"): "GLOBAL_MARKER"} {
		if err := os.WriteFile(path, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	p, err := SystemPrompt(cwd, state, "custom", "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(p, "CLAUDE_MARKER") || !strings.Contains(p, "OVERRIDE_MARKER") || !strings.Contains(p, "ANCESTOR_MARKER") || !strings.Contains(p, "GLOBAL_MARKER") {
		t.Fatal(p)
	}
	p, err = SystemPrompt(cwd, state, "custom", "", "", 0, PromptOptions{IgnoreProject: true})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(p, "OVERRIDE_MARKER") || strings.Contains(p, "ANCESTOR_MARKER") || !strings.Contains(p, "GLOBAL_MARKER") {
		t.Fatal(p)
	}
	p, err = SystemPrompt(cwd, state, "custom", "", "", 0, PromptOptions{NoContextFiles: true})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(p, "MARKER") {
		t.Fatal(p)
	}
}
func TestPromptFlags(t *testing.T) {
	o, e := ParseOptions([]string{"--no-approve", "--approve", "--no-context-files"})
	if e != nil || o.IgnoreProject || !o.NoContextFiles {
		t.Fatalf("%+v %v", o, e)
	}
}
