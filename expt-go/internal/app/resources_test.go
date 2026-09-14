package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplicationResourcesRespectProjectTrust(t *testing.T) {
	root := t.TempDir()
	cwd := filepath.Join(root, "work")
	state := filepath.Join(root, "state")
	if err := os.MkdirAll(filepath.Join(cwd, ".pi", "skills", "hello"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cwd, ".pi", "skills", "hello", "SKILL.md"), []byte("---\nname: hello\ndescription: Say hello\n---\nHELLO BODY"), 0600); err != nil {
		t.Fatal(err)
	}
	a, err := NewApplication(Options{CWD: cwd, StateDir: state, NoSession: true, Offline: true, Provider: "openai", Model: "gpt-4.1-mini", Thinking: "medium", MaxTurns: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if len(a.Resources.Skills) != 1 || !strings.Contains(a.Engine.Request.System, "<name>hello</name>") {
		t.Fatalf("skills=%+v system=%q", a.Resources.Skills, a.Engine.Request.System)
	}
	b, err := NewApplication(Options{CWD: cwd, StateDir: filepath.Join(root, "state2"), NoSession: true, Offline: true, Provider: "openai", Model: "gpt-4.1-mini", Thinking: "medium", MaxTurns: 1, IgnoreProject: true})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if len(b.Resources.Skills) != 0 || strings.Contains(b.Engine.Request.System, "<name>hello</name>") {
		t.Fatal("project skill loaded under --no-approve")
	}
}
func TestResourceOptionsAndBuiltinConflicts(t *testing.T) {
	o, err := ParseOptions([]string{"--skill", "a", "--skill=b", "--no-skills", "--prompt-template", "p", "--no-prompt-templates"})
	if err != nil {
		t.Fatal(err)
	}
	if len(o.SkillPaths) != 2 || len(o.PromptTemplatePaths) != 1 || !o.NoSkills || !o.NoPromptTemplates {
		t.Fatalf("%+v", o)
	}
	if !isBuiltinSlash("/help args") || isBuiltinSlash("/skill:help") || isBuiltinSlash("/my-template") {
		t.Fatal("slash conflict classification")
	}
}
