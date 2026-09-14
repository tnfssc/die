package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCustomModelCapabilitiesDefaultAndExplicit(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "models.json"), []byte(`{"providers":{"fixture":{"api":"openai-completions","baseUrl":"http://127.0.0.1","models":[{"id":"basic","reasoning":false,"maxTokens":4096}]}}}`), 0600)
	o := Options{StateDir: dir, Provider: "fixture", Model: "basic", Thinking: "medium"}
	if e := configureProviderOptions(&o); e != nil {
		t.Fatal(e)
	}
	if o.Thinking != "off" || o.MaxTokens != 0 {
		t.Fatal(o)
	}
	o.Thinking = "high"
	o.ThinkingSet = true
	if e := configureProviderOptions(&o); e == nil {
		t.Fatal("explicit unsupported reasoning accepted")
	}
}

func TestCustomThinkingMapAndModelOverrideSemantics(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "models.json"), []byte(`{"providers":{"openai":{"baseUrl":"http://proxy.invalid/v1","headers":{"X-Provider":"yes"},"modelOverrides":{"gpt-4.1-mini":{"reasoning":true,"maxTokens":777,"thinkingLevelMap":{"medium":"high","xhigh":null},"headers":{"X-Model":"yes"}}}}}}`), 0600)
	o := Options{StateDir: dir, Provider: "openai", Model: "gpt-4.1-mini", Thinking: "medium"}
	if err := configureProviderOptions(&o); err != nil {
		t.Fatal(err)
	}
	if o.Thinking != "high" {
		t.Fatalf("thinking=%q", o.Thinking)
	}
	cfgs, err := LoadModelProviders(dir)
	if err != nil {
		t.Fatal(err)
	}
	m, ok := selectedConfiguredModel(cfgs["openai"], "gpt-4.1-mini")
	if !ok {
		t.Fatal("built-in model lost")
	}
	if m.MaxTokens != 777 || !m.Reasoning || m.BaseURL != "http://proxy.invalid/v1" || m.Headers["X-Model"] != "yes" {
		t.Fatalf("model=%#v", m)
	}
	o.Thinking = "xhigh"
	o.ThinkingSet = true
	if err := configureProviderOptions(&o); err == nil {
		t.Fatal("null thinking level accepted")
	}
}

func TestModelsJSONModelLevelAPIBaseAndDefinitionHeaderPrecedence(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "models.json"), []byte(`{"providers":{"fixture":{"baseUrl":"http://provider","api":"openai-responses","models":[{"id":"m","api":"anthropic-messages","baseUrl":"http://model","headers":{"X-Layer":"definition"}}],"modelOverrides":{"m":{"headers":{"X-Layer":"override"}}}}}}`), 0600)
	cfgs, err := LoadModelProviders(dir)
	if err != nil {
		t.Fatal(err)
	}
	m := cfgs["fixture"].Models[0]
	if m.API != "anthropic-messages" || m.BaseURL != "http://model" || m.Headers["X-Layer"] != "definition" {
		t.Fatalf("model=%#v", m)
	}
}

func TestModelsJSONCodexOverrideRefused(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "models.json"), []byte(`{"providers":{"openai-codex":{"baseUrl":"http://evil.invalid","headers":{"Authorization":"Bearer wrong"}}}}`), 0600)
	o := Options{StateDir: dir, Provider: "openai-codex", Model: "gpt-5.4"}
	if err := configureProviderOptions(&o); err == nil {
		t.Fatal("Codex override accepted")
	}
	if _, err := newApplicationProvider(o); err == nil {
		t.Fatal("Codex override constructed")
	}
}

func TestModelsJSONInvalidHeaderDoesNotEchoSecret(t *testing.T) {
	dir := t.TempDir()
	secret := "sk-do-not-echo"
	os.WriteFile(filepath.Join(dir, "models.json"), []byte(`{"providers":{"fixture":{"baseUrl":"http://x","api":"openai-responses","headers":{"X-Bad":"line\n`+secret+`"},"models":[{"id":"m"}]}}}`), 0600)
	_, err := LoadModelProviders(dir)
	if err == nil {
		t.Fatal("invalid header accepted")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("secret in error: %v", err)
	}
}
