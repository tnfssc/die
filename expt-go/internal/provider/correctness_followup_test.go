package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"godie/internal/core"
)

func fixtureProvider(t *testing.T, kind, model string, events ...string) (core.Provider, *map[string]any) {
	t.Helper()
	got := &map[string]any{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(got); err != nil {
			t.Error(err)
		}
		sse(w, events...)
	}))
	t.Cleanup(srv.Close)
	p, err := New(Config{Kind: kind, Model: model, APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()})
	if err != nil {
		t.Fatal(err)
	}
	return p, got
}

func TestAnthropicRequiresTerminalAndPreservesErrorUsage(t *testing.T) {
	p, _ := fixtureProvider(t, "anthropic", "claude-test",
		`{"type":"message_start","message":{"id":"m","usage":{"input_tokens":7,"cache_read_input_tokens":2}}}`,
		`{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}`,
		`{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}`)
	res, err := p.Complete(context.Background(), core.Request{}, nil)
	if err == nil || !strings.Contains(err.Error(), "message_stop") {
		t.Fatalf("wanted truncation error, got %#v %v", res, err)
	}
	if res.Message.Role != "" {
		t.Fatalf("partial message became successful: %#v", res.Message)
	}
	if res.Usage.Input != 7 || res.Usage.Output != 3 || res.Usage.CacheRead != 2 {
		t.Fatalf("usage lost: %#v", res.Usage)
	}
}

func TestAnthropicSignedThinkingAndCompleteToolOnly(t *testing.T) {
	p, _ := fixtureProvider(t, "anthropic", "claude-test",
		`{"type":"message_start","message":{"id":"m","usage":{}}}`,
		`{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"a","signature":"s"}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"b"}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"ig"}}`,
		`{"type":"content_block_stop","index":0}`,
		`{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}`,
		`{"type":"message_stop"}`)
	res, err := p.Complete(context.Background(), core.Request{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Message.Content != "" {
		t.Fatalf("thinking leaked visibly: %q", res.Message.Content)
	}
	var blocks []map[string]any
	if json.Unmarshal(res.Message.Native, &blocks) != nil || blocks[0]["thinking"] != "ab" || blocks[0]["signature"] != "sig" {
		t.Fatalf("signed native thinking lost: %s", res.Message.Native)
	}

	bad, _ := fixtureProvider(t, "anthropic", "claude-test",
		`{"type":"message_start","message":{"usage":{}}}`,
		`{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"x","name":"execute","input":{}}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{bad"}}`,
		`{"type":"content_block_stop","index":0}`,
		`{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{}}`,
		`{"type":"message_stop"}`)
	badRes, err := bad.Complete(context.Background(), core.Request{}, nil)
	if err == nil || len(badRes.Message.ToolCalls) != 0 {
		t.Fatalf("invalid tool became executable: %#v %v", badRes, err)
	}
}

func TestAnthropicOutOfRangeBlockDoesNotPanic(t *testing.T) {
	p, _ := fixtureProvider(t, "anthropic", "claude-test", `{"type":"content_block_delta","index":-1,"delta":{"type":"text_delta","text":"x"}}`)
	if _, err := p.Complete(context.Background(), core.Request{}, nil); err == nil {
		t.Fatal("negative index accepted")
	}
}

func TestGeminiRequiresFinishAndPreservesErrorUsage(t *testing.T) {
	p, _ := fixtureProvider(t, "gemini", "gemini-2.5-flash",
		`{"candidates":[{"index":0,"content":{"role":"model","parts":[{"text":"partial"}]}}],"usageMetadata":{"promptTokenCount":9,"cachedContentTokenCount":2,"candidatesTokenCount":3,"thoughtsTokenCount":4}}`)
	res, err := p.Complete(context.Background(), core.Request{}, nil)
	if err == nil || !strings.Contains(err.Error(), "finish reason") {
		t.Fatalf("wanted truncation error: %#v %v", res, err)
	}
	if res.Message.Role != "" || res.Usage.Input != 7 || res.Usage.Output != 7 || res.Usage.CacheRead != 2 {
		t.Fatalf("partial success or usage loss: %#v", res)
	}
}

func TestGeminiThoughtsSignaturesAndCandidatePolicy(t *testing.T) {
	p, _ := fixtureProvider(t, "gemini", "gemini-3-flash",
		`{"candidates":[{"index":0,"content":{"role":"model","parts":[{"thought":true,"text":"secret","thoughtSignature":"c2ln"},{"text":"shown","thoughtSignature":"dHh0"},{"functionCall":{"name":"execute","args":{"code":"ok"}},"thoughtSignature":"Y2FsbA=="}]} ,"finishReason":"STOP"},{"index":1,"content":{"role":"model","parts":[{"text":"other"}]},"finishReason":"STOP"}]}`)
	res, err := p.Complete(context.Background(), core.Request{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Message.Content != "shown" || len(res.Message.ToolCalls) != 1 || res.Message.ToolCalls[0].ID != "execute_1" {
		t.Fatalf("bad chosen reduction: %#v", res.Message)
	}
	if strings.Contains(res.Message.Content, "secret") || strings.Contains(res.Message.Content, "other") {
		t.Fatal("thought/candidate leaked")
	}
	var native map[string]any
	if json.Unmarshal(res.Message.Native, &native) != nil {
		t.Fatal("bad native")
	}
	parts := native["parts"].([]any)
	call := parts[2].(map[string]any)["functionCall"].(map[string]any)
	if parts[0].(map[string]any)["thoughtSignature"] != "c2ln" || call["id"] != "execute_1" {
		t.Fatalf("signature/correlation lost: %s", res.Message.Native)
	}
}

func TestGeminiThinkingAndIDWireMapping(t *testing.T) {
	p3, got3 := fixtureProvider(t, "gemini", "gemini-3.1-pro-preview", `{"candidates":[{"finishReason":"STOP"}]}`)
	req3 := core.Request{Thinking: "medium", Messages: []core.Message{
		{Role: "assistant", ToolCalls: []core.ToolCall{{ID: "call_1", Name: "execute", Arguments: json.RawMessage(`{}`)}}},
		{Role: "tool", ToolCallID: "call_1"},
	}}
	if _, err := p3.Complete(context.Background(), req3, nil); err != nil {
		t.Fatal(err)
	}
	gc3 := (*got3)["generationConfig"].(map[string]any)["thinkingConfig"].(map[string]any)
	if gc3["thinkingLevel"] != "HIGH" || gc3["includeThoughts"] != true {
		t.Fatalf("Gemini 3 mapping: %#v", gc3)
	}
	contents3 := (*got3)["contents"].([]any)
	if contents3[0].(map[string]any)["parts"].([]any)[0].(map[string]any)["functionCall"].(map[string]any)["id"] != "call_1" {
		t.Fatal("Gemini 3 call ID omitted")
	}

	p2, got2 := fixtureProvider(t, "gemini", "gemini-2.5-flash", `{"candidates":[{"finishReason":"STOP"}]}`)
	req2 := core.Request{Thinking: "medium", Messages: []core.Message{
		{Role: "assistant", ToolCalls: []core.ToolCall{{ID: "internal", Name: "execute", Arguments: json.RawMessage(`{}`)}}},
		{Role: "tool", ToolCallID: "internal"},
	}}
	if _, err := p2.Complete(context.Background(), req2, nil); err != nil {
		t.Fatal(err)
	}
	gc2 := (*got2)["generationConfig"].(map[string]any)["thinkingConfig"].(map[string]any)
	if gc2["thinkingBudget"] != float64(8192) && gc2["thinkingBudget"] != 8192 {
		t.Fatalf("Gemini 2 mapping: %#v", gc2)
	}
	contents2 := (*got2)["contents"].([]any)
	if _, ok := contents2[0].(map[string]any)["parts"].([]any)[0].(map[string]any)["functionCall"].(map[string]any)["id"]; ok {
		t.Fatal("Gemini 2 call ID must stay internal")
	}
	if _, ok := contents2[1].(map[string]any)["parts"].([]any)[0].(map[string]any)["functionResponse"].(map[string]any)["id"]; ok {
		t.Fatal("Gemini 2 response ID must stay internal")
	}
}

func TestAnthropicThinkingMapping(t *testing.T) {
	p, got := fixtureProvider(t, "anthropic", "claude-sonnet-4-6", `{"type":"message_start","message":{"usage":{}}}`, `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{}}`, `{"type":"message_stop"}`)
	if _, err := p.Complete(context.Background(), core.Request{Thinking: "medium"}, nil); err != nil {
		t.Fatal(err)
	}
	if (*got)["thinking"].(map[string]any)["type"] != "adaptive" || (*got)["output_config"].(map[string]any)["effort"] != "medium" {
		t.Fatalf("mapping: %#v", *got)
	}
}
