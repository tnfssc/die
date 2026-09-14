package provider

import "testing"

func TestAnthropicThinkingOff(t *testing.T) {
	b := map[string]any{}
	max := 8192
	if err := configureAnthropicThinking(b, "fixture", "off", &max, true); err != nil {
		t.Fatal(err)
	}
	if b["thinking"].(map[string]any)["type"] != "disabled" {
		t.Fatal(b)
	}
}
