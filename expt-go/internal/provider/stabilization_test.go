package provider

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"godie/internal/core"
)

var fixtureImage = core.Image{MIME: "image/png", Data: "iVBORw0KGgo="}

func TestOpenAIToolResultImageRefusalAndUncachedUsage(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		sse(w,
			`{"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_refusal","content":[]}}`,
			`{"type":"response.refusal.delta","output_index":0,"delta":"cannot comply"}`,
			`{"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_refusal","content":[{"type":"refusal","refusal":"cannot comply"}]}}`,
			`{"type":"response.completed","response":{"id":"resp_refusal","status":"completed","output":[],"usage":{"input_tokens":13,"output_tokens":2,"input_tokens_details":{"cached_tokens":5,"cache_write_tokens":1}}}}`)
	}))
	defer srv.Close()
	p, _ := New(Config{Kind: "openai", Model: "gpt-test", APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()})
	foreign := json.RawMessage(`[{"type":"reasoning","id":"must_not_replay"}]`)
	var streamed string
	res, err := p.Complete(context.Background(), core.Request{Messages: []core.Message{
		{Role: "assistant", Content: "portable", Native: foreign, Provider: "anthropic", Model: "other"},
		{Role: "tool", ToolCallID: "call_image", Content: "pixels", Images: []core.Image{fixtureImage}},
	}}, func(e core.StreamEvent) {
		if e.Type == "text" {
			streamed += e.Text
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Message.Content != "cannot comply" || streamed != "cannot comply" {
		t.Fatalf("refusal result=%q stream=%q", res.Message.Content, streamed)
	}
	if res.Usage.Input != 7 || res.Usage.CacheRead != 5 || res.Usage.CacheWrite != 1 {
		t.Fatalf("usage=%#v", res.Usage)
	}
	input := got["input"].([]any)
	if input[0].(map[string]any)["role"] != "assistant" {
		t.Fatalf("foreign native replayed: %#v", input[0])
	}
	out := input[1].(map[string]any)
	if out["call_id"] != "call_image" {
		t.Fatalf("correlation lost: %#v", out)
	}
	parts := out["output"].([]any)
	if parts[0].(map[string]any)["type"] != "input_text" || parts[1].(map[string]any)["type"] != "input_image" || parts[1].(map[string]any)["image_url"] != "data:image/png;base64,iVBORw0KGgo=" {
		t.Fatalf("binary image projection=%#v", parts)
	}
}

func TestAnthropicToolResultImageWireAndNativeSwitch(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		sse(w, `{"type":"message_start","message":{"id":"a","usage":{"input_tokens":4,"cache_read_input_tokens":3,"cache_creation_input_tokens":2}}}`, `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}`, `{"type":"message_stop"}`)
	}))
	defer srv.Close()
	p, _ := New(Config{Kind: "anthropic", Model: "claude-test", APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()})
	res, err := p.Complete(context.Background(), core.Request{Messages: []core.Message{
		{Role: "assistant", Content: "portable", Native: json.RawMessage(`[{"type":"text","text":"must not replay"}]`), Provider: "openai", Model: "other"},
		{Role: "tool", ToolCallID: "tool_image", Content: "pixels", Images: []core.Image{fixtureImage}},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Usage.Input != 4 || res.Usage.CacheRead != 3 || res.Usage.CacheWrite != 2 {
		t.Fatalf("usage=%#v", res.Usage)
	}
	messages := got["messages"].([]any)
	assistant := messages[0].(map[string]any)["content"].([]any)
	if assistant[0].(map[string]any)["text"] != "portable" {
		t.Fatalf("foreign native replayed: %#v", assistant)
	}
	result := messages[1].(map[string]any)["content"].([]any)[0].(map[string]any)
	if result["tool_use_id"] != "tool_image" {
		t.Fatalf("correlation lost: %#v", result)
	}
	parts := result["content"].([]any)
	source := parts[1].(map[string]any)["source"].(map[string]any)
	if parts[0].(map[string]any)["text"] != "pixels" || source["type"] != "base64" || source["media_type"] != "image/png" || source["data"] != fixtureImage.Data {
		t.Fatalf("binary image projection=%#v", parts)
	}
}

func TestGeminiToolResultImageWiresAndUncachedUsage(t *testing.T) {
	for _, tc := range []struct {
		name, model string
		nested      bool
	}{{"gemini3", "gemini-3-flash", true}, {"gemini2", "gemini-2.5-flash", false}} {
		t.Run(tc.name, func(t *testing.T) {
			var got map[string]any
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
					t.Fatal(err)
				}
				sse(w, `{"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":11,"cachedContentTokenCount":4,"candidatesTokenCount":2}}`)
			}))
			defer srv.Close()
			p, _ := New(Config{Kind: "gemini", Model: tc.model, APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()})
			res, err := p.Complete(context.Background(), core.Request{Messages: []core.Message{
				{Role: "assistant", Content: "portable", Native: json.RawMessage(`{"role":"model","parts":[{"text":"must not replay"}]}`), Provider: "openai", Model: "other"},
				{Role: "tool", ToolCallID: "g_image", Content: "pixels", Images: []core.Image{fixtureImage}},
			}}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if res.Usage.Input != 7 || res.Usage.CacheRead != 4 {
				t.Fatalf("usage=%#v", res.Usage)
			}
			contents := got["contents"].([]any)
			firstParts := contents[0].(map[string]any)["parts"].([]any)
			if firstParts[0].(map[string]any)["text"] != "portable" {
				t.Fatalf("foreign native replayed: %#v", firstParts)
			}
			fr := contents[1].(map[string]any)["parts"].([]any)[0].(map[string]any)["functionResponse"].(map[string]any)
			if fr["response"].(map[string]any)["output"] != "pixels" {
				t.Fatalf("result lost: %#v", fr)
			}
			if tc.nested && fr["id"] != "g_image" {
				t.Fatalf("Gemini 3 correlation lost: %#v", fr)
			}
			if !tc.nested {
				if _, ok := fr["id"]; ok {
					t.Fatalf("Gemini 2 wire must omit IDs: %#v", fr)
				}
			}
			if tc.nested {
				image := fr["parts"].([]any)[0].(map[string]any)["inlineData"].(map[string]any)
				if image["mimeType"] != "image/png" || image["data"] != fixtureImage.Data || len(contents) != 2 {
					t.Fatalf("nested image projection=%#v contents=%#v", image, contents)
				}
			} else {
				if _, ok := fr["parts"]; ok || len(contents) != 3 {
					t.Fatalf("legacy image must be separate: %#v", contents)
				}
				image := contents[2].(map[string]any)["parts"].([]any)[1].(map[string]any)["inlineData"].(map[string]any)
				if image["data"] != fixtureImage.Data {
					t.Fatalf("legacy image projection=%#v", image)
				}
			}
		})
	}
}

func TestUsageCostUsesUncachedInputComponents(t *testing.T) {
	tests := []struct {
		provider, model string
		want            float64
	}{
		{"openai", "gpt-4.1-mini", .000061},
		{"anthropic", "claude-sonnet-4-6", .000540},
		{"gemini", "gemini-2.5-flash", .0000565},
	}
	for _, tc := range tests {
		usage := core.Usage{Input: 100, Output: 10, CacheRead: 50, CacheWrite: 20}
		if tc.provider != "anthropic" {
			usage.CacheWrite = 0
		}
		applyUsageCost(tc.provider, tc.model, &usage)
		if math.Abs(usage.Cost-tc.want) > 1e-12 {
			t.Errorf("%s cost=%g want=%g", tc.provider, usage.Cost, tc.want)
		}
	}
}
