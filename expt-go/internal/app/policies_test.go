package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func policyApp(t *testing.T, mutate func(*Options)) *Application {
	t.Helper()
	root := t.TempDir()
	o := Options{CWD: root, StateDir: filepath.Join(root, "state"), SessionDir: filepath.Join(root, "sessions"), Offline: true, Provider: "openai-codex", Model: "gpt-5.4", Thinking: "medium", Mode: "text", MaxTurns: 10, MaxTokens: 100}
	if mutate != nil {
		mutate(&o)
	}
	a, err := NewApplication(o)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Close() })
	return a
}

func TestFastCommandIsModelBoundBranchState(t *testing.T) {
	a := policyApp(t, nil)
	if a.Engine.Request.Fast {
		t.Fatal("standard must be the default")
	}
	if _, err := a.fastCommand("on"); err != nil {
		t.Fatal(err)
	}
	if !a.Engine.Request.Fast {
		t.Fatal("enabled policy was not projected")
	}
	on := a.Session.LeafID()
	if _, err := a.fastCommand("off"); err != nil {
		t.Fatal(err)
	}
	if a.Engine.Request.Fast {
		t.Fatal("off must restore standard")
	}
	if err := a.Session.Resume(on); err != nil {
		t.Fatal(err)
	}
	if err := a.restorePolicyState(); err != nil {
		t.Fatal(err)
	}
	if !a.Engine.Request.Fast {
		t.Fatal("active branch opt-in was not restored")
	}
	status, err := a.fastCommand("status")
	if err != nil || !strings.Contains(status, "requested") {
		t.Fatalf("status=%q err=%v", status, err)
	}
}

func TestFastCommandRequiresExplicitNonTTYCostAndAllowlist(t *testing.T) {
	a := policyApp(t, func(o *Options) { o.Print = true })
	if _, err := a.fastCommand("on"); err == nil || !strings.Contains(err.Error(), "--accept-cost") {
		t.Fatalf("expected cost refusal, got %v", err)
	}
	if a.Engine.Request.Fast {
		t.Fatal("refusal changed request policy")
	}
	if _, err := a.fastCommand("on --accept-cost"); err != nil {
		t.Fatal(err)
	}
	b := policyApp(t, func(o *Options) { o.Model = "gpt-5.4-mini" })
	if _, err := b.fastCommand("on --accept-cost"); err == nil {
		t.Fatal("family-prefix model must not inherit allowlist")
	}
	c := policyApp(t, func(o *Options) { o.BaseURL = "https://example.invalid" })
	if _, err := c.fastCommand("off"); err == nil {
		t.Fatal("custom endpoint must be rejected")
	}
}

func TestCacheCommandUsesBoundedDedicatedSettingsAndObservations(t *testing.T) {
	a := policyApp(t, nil)
	got, err := a.cacheCommand("")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "1h") || !strings.Contains(got, "cache est ?") || !strings.Contains(got, "no cache") {
		t.Fatalf("unexpected status: %s", got)
	}
	if _, err = a.cacheCommand("90m"); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(a.Options.StateDir, cacheSettingsFile))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "provider") || !strings.Contains(string(b), "5400000") {
		t.Fatalf("unexpected settings: %s", b)
	}
	when := time.Now().Add(-10 * time.Minute)
	if err = a.observeProviderAttempt(a.Options.Provider, a.Options.Model, when); err != nil {
		t.Fatal(err)
	}
	got, err = a.cacheCommand("")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got, "cache est ?") || strings.Contains(strings.ToLower(got), "hit confirmed") {
		t.Fatalf("unexpected estimate: %s", got)
	}
	before := string(b)
	if err = os.WriteFile(a.cacheSettingsPath(), []byte("{broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = a.cacheCommand(""); err == nil || !strings.Contains(err.Error(), "left unchanged") {
		t.Fatalf("expected bounded parse error, got %v", err)
	}
	corrupt, _ := os.ReadFile(a.cacheSettingsPath())
	if string(corrupt) == before {
		t.Fatal("test did not install corrupt fixture")
	}
	if string(corrupt) != "{broken" {
		t.Fatal("corrupt settings were rewritten")
	}
}

func TestRestorePolicyStateReadsOnlyActiveBranch(t *testing.T) {
	a := policyApp(t, nil)
	model, err := a.Session.AppendCustom("model_change", map[string]string{"provider": "openai", "model": "gpt-6-astra"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.Session.AppendCustom("thinking_level_change", map[string]string{"thinkingLevel": "high"}); err != nil {
		t.Fatal(err)
	}
	if _, err = a.Session.AppendCustom("die-main-agent-mode", map[string]string{"mode": "orchestrator"}); err != nil {
		t.Fatal(err)
	}
	if err = a.Session.Resume(model.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = a.Session.AppendCustom("thinking_level_change", map[string]string{"thinkingLevel": "low"}); err != nil {
		t.Fatal(err)
	}
	if _, err = a.Session.AppendCustom("die-main-agent-mode", map[string]string{"mode": "normal"}); err != nil {
		t.Fatal(err)
	}
	if err = a.restorePolicyState(); err != nil {
		t.Fatal(err)
	}
	if a.Options.Provider != "openai" || a.Options.Model != "gpt-6-astra" || a.Options.Thinking != "low" {
		t.Fatalf("restored %#v", a.Options)
	}
	if strings.Contains(a.Engine.Request.System, prompt("main-orchestrator")) {
		t.Fatal("abandoned root mode leaked into prompt")
	}
	if err = a.Session.Resume(""); err != nil {
		t.Fatal(err)
	}
	if err = a.restorePolicyState(); err != nil {
		t.Fatal(err)
	}
	if a.Options.Provider != "openai-codex" || a.Options.Model != "gpt-5.4" || a.Options.Thinking != "medium" {
		t.Fatalf("empty branch did not restore startup baseline: %#v", a.Options)
	}
}

func TestMalformedNewestFastRecordFailsClosed(t *testing.T) {
	a := policyApp(t, nil)
	if _, err := a.fastCommand("on"); err != nil {
		t.Fatal(err)
	}
	_, err := a.Session.AppendCustom(nativeFastEntry, map[string]any{"version": 1, "sessionId": a.Session.ID(), "provider": a.Options.Provider, "model": a.Options.Model, "enabled": true, "costAcknowledged": false, "timestamp": time.Now().UnixMilli()})
	if err != nil {
		t.Fatal(err)
	}
	a.Engine.Request.Fast = false
	if err = a.restorePolicyState(); err == nil {
		t.Fatal("malformed newest authorization must fail closed")
	}
	if a.Engine.Request.Fast {
		t.Fatal("malformed authorization enabled fast")
	}
}
