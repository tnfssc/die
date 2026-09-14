package resources

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, p, s string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(s), 0600); err != nil {
		t.Fatal(err)
	}
}
func TestDiscoverDefaultsTrustAndInventory(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(root, "state")
	cwd := filepath.Join(root, "repo", "sub")
	write(t, filepath.Join(root, "repo", ".git", "keep"), "")
	write(t, filepath.Join(state, "skills", "global", "SKILL.md"), "---\nname: global-skill\ndescription: global <thing>\n---\nGLOBAL BODY")
	write(t, filepath.Join(root, "repo", ".agents", "skills", "group", "project.md"), "---\nname: project-skill\ndescription: project skill\ndisable-model-invocation: true\n---\nPROJECT BODY")
	write(t, filepath.Join(cwd, ".pi", "skills", "local.md"), "---\nname: local-skill\ndescription: local skill\n---\nLOCAL BODY")
	got := Discover(Options{CWD: cwd, StateDir: state, IncludeProject: true, IncludeSkills: true})
	if len(got.Skills) != 3 {
		t.Fatalf("skills=%+v warnings=%v", got.Skills, got.Warnings)
	}
	inv := got.FormatSkills()
	if !strings.Contains(inv, "global &lt;thing&gt;") || !strings.Contains(inv, "local-skill") || strings.Contains(inv, "project-skill") {
		t.Fatalf("inventory %q", inv)
	}
	untrusted := Discover(Options{CWD: cwd, StateDir: state, IncludeProject: false, IncludeSkills: true})
	for _, s := range untrusted.Skills {
		if s.Name != "global-skill" {
			t.Fatalf("untrusted project skill loaded: %+v", s)
		}
	}
}
func TestSkillExpansionAndCollision(t *testing.T) {
	root := t.TempDir()
	a := filepath.Join(root, "a")
	b := filepath.Join(root, "b")
	write(t, filepath.Join(a, "one", "SKILL.md"), "---\nname: same\ndescription: first\n---\nDo first.")
	write(t, filepath.Join(b, "two", "SKILL.md"), "---\nname: same\ndescription: second\n---\nDo second.")
	got := Discover(Options{CWD: root, SkillPaths: []string{a, b}})
	if len(got.Skills) != 1 || len(got.Warnings) == 0 {
		t.Fatalf("got %+v", got)
	}
	v, ok, e := got.Expand("/skill:same extra words")
	if e != nil || !ok || !strings.Contains(v, "Do first.") || !strings.HasSuffix(v, "extra words") || !strings.Contains(v, "References are relative to ") {
		t.Fatalf("expansion=%q %v %v", v, ok, e)
	}
}
func TestTemplatesArgumentsOrderingAndNonRecursiveDiscovery(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(root, "state")
	cwd := filepath.Join(root, "work")
	write(t, filepath.Join(state, "prompts", "make.md"), "---\ndescription: Make it\nargument-hint: '<name> [rest]'\n---\nA=$1 ALL=$@ D=${2:-fallback} S=${@:2:2} L=$ARGUMENTS")
	write(t, filepath.Join(cwd, ".pi", "prompts", "make.md"), "project loses")
	write(t, filepath.Join(cwd, ".pi", "prompts", "nested", "hidden.md"), "hidden")
	got := Discover(Options{CWD: cwd, StateDir: state, IncludeProject: true, IncludeTemplates: true})
	if len(got.Templates) != 2 {
		t.Fatalf("templates=%+v", got.Templates)
	}
	v, ok, e := got.Expand("/make Button 'click handler' third")
	if e != nil || !ok || v != "A=Button ALL=Button click handler third D=click handler S=click handler third L=Button click handler third" {
		t.Fatalf("%q %v %v", v, ok, e)
	}
	if _, ok, _ := got.Expand("/hidden"); ok {
		t.Fatal("nested prompt discovered")
	}
	if v := Substitute("$1", []string{"$ARGUMENTS"}); v != "$ARGUMENTS" {
		t.Fatalf("recursive substitution: %q", v)
	}
}
func TestMalformedAndOversizeWarnings(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "bad", "SKILL.md"), "---\nname: bad\n---\nbody")
	write(t, filepath.Join(root, "huge", "SKILL.md"), strings.Repeat("x", maxFileSize+1))
	got := Discover(Options{CWD: root, SkillPaths: []string{root}})
	if len(got.Warnings) < 2 {
		t.Fatalf("warnings=%v", got.Warnings)
	}
}
