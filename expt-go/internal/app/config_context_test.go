package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfiguredContextWindowAndFooter(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "models.json"), []byte(`{"providers":{"fixture":{"api":"openai-completions","baseUrl":"http://127.0.0.1:1","apiKey":"dummy","models":[{"id":"context-model","contextWindow":64000,"reasoning":false}]}}}`), 0600); err != nil {
		t.Fatal(err)
	}
	a, err := NewApplication(Options{StateDir: dir, CWD: dir, Offline: true, Provider: "fixture", Model: "context-model", Thinking: "off"})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if _, err = a.Session.AppendCustom("provider_attempt", map[string]any{"provider": "fixture", "model": "context-model", "usage": map[string]int{"input": 32000}}); err != nil {
		t.Fatal(err)
	}
	window, err := configuredContextWindow(dir, "fixture", "context-model")
	if err != nil || window != 64000 {
		t.Fatalf("window=%d err=%v", window, err)
	}
	if got := a.FooterStatus().Context; got != "ctx 50%" {
		t.Fatalf("footer: %s", got)
	}
	if err = os.WriteFile(filepath.Join(dir, "models.json"), []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = configuredContextWindow(dir, "fixture", "context-model"); err == nil {
		t.Fatal("malformed config silently ignored")
	}
	if got := a.FooterStatus().Context; !strings.Contains(got, "?") {
		t.Fatalf("malformed footer: %s", got)
	}
}
