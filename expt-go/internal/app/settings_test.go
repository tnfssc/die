package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStartupSettingsDefaultsAndExplicitThinking(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"defaultProvider":"anthropic","defaultModel":"fixture","defaultThinkingLevel":"low"}`), 0600)
	o, e := ParseOptions([]string{})
	if e != nil {
		t.Fatal(e)
	}
	o.StateDir = dir
	o.CWD = dir
	if e = loadStartupSettings(&o); e != nil {
		t.Fatal(e)
	}
	if o.Provider != "anthropic" || o.Model != "fixture" || o.Thinking != "low" {
		t.Fatalf("%+v", o)
	}
	o, e = ParseOptions([]string{"--thinking", "medium"})
	if e != nil {
		t.Fatal(e)
	}
	o.StateDir = dir
	o.CWD = dir
	if e = loadStartupSettings(&o); e != nil {
		t.Fatal(e)
	}
	if o.Thinking != "medium" {
		t.Fatal(o.Thinking)
	}
}
