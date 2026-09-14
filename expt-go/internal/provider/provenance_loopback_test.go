package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"godie/internal/core"
)

// This exercises a real adapter-to-adapter handoff over two loopback
// transports. Native OpenAI output must remain attached for same-provider
// replay, but an Anthropic request must project only the portable message.
func TestNativeProvenanceCrossProviderLoopback(t *testing.T) {
	openAI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"type\":\"reasoning\",\"id\":\"secret-native\"}}\n\n")
		fmt.Fprint(w, "data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"type\":\"reasoning\",\"id\":\"secret-native\"}}\n\n")
		fmt.Fprint(w, "data: {\"type\":\"response.output_item.added\",\"output_index\":1,\"item\":{\"type\":\"message\",\"id\":\"msg\",\"content\":[]}}\n\n")
		fmt.Fprint(w, "data: {\"type\":\"response.output_item.done\",\"output_index\":1,\"item\":{\"type\":\"message\",\"id\":\"msg\",\"content\":[{\"type\":\"output_text\",\"text\":\"portable answer\"}]}}\n\n")
		fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"r1\",\"status\":\"completed\",\"output\":[],\"usage\":{}}}\n\n")
	}))
	defer openAI.Close()
	op, err := New(Config{Kind: "openai", Model: "gpt-loopback", APIKey: "x", BaseURL: openAI.URL, HTTPClient: openAI.Client()})
	if err != nil {
		t.Fatal(err)
	}
	first, err := op.Complete(context.Background(), core.Request{Messages: []core.Message{{Role: "user", Content: "first"}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Message.Provider != "openai" || first.Message.Model != "gpt-loopback" || len(first.Message.Native) == 0 {
		t.Fatalf("first=%#v", first.Message)
	}

	var anthropicBody map[string]any
	anthropic := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&anthropicBody); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"message_start\",\"message\":{\"id\":\"a1\",\"usage\":{}}}\n\n")
		fmt.Fprint(w, "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n")
		fmt.Fprint(w, "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"anthropic answer\"}}\n\n")
		fmt.Fprint(w, "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n")
		fmt.Fprint(w, "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{}}\n\n")
		fmt.Fprint(w, "data: {\"type\":\"message_stop\"}\n\n")
	}))
	defer anthropic.Close()
	ap, err := New(Config{Kind: "anthropic", Model: "claude-loopback", APIKey: "x", BaseURL: anthropic.URL, HTTPClient: anthropic.Client()})
	if err != nil {
		t.Fatal(err)
	}
	second, err := ap.Complete(context.Background(), core.Request{Thinking: "medium", Messages: []core.Message{first.Message, {Role: "user", Content: "second"}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if second.Message.Provider != "anthropic" || second.Message.Model != "claude-loopback" {
		t.Fatalf("second=%#v", second.Message)
	}
	encoded, _ := json.Marshal(anthropicBody["messages"])
	if string(encoded) == "" || containsBytes(encoded, []byte("secret-native")) || !containsBytes(encoded, []byte("portable answer")) {
		t.Fatalf("cross-provider projection=%s", encoded)
	}
	thinking := anthropicBody["thinking"].(map[string]any)
	if thinking["type"] != "enabled" || anthropicBody["max_tokens"] != float64(9216) {
		t.Fatalf("default reasoning body=%#v", anthropicBody)
	}
}

func containsBytes(haystack, needle []byte) bool {
	if len(needle) == 0 {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		match := true
		for j := range needle {
			if haystack[i+j] != needle[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}
