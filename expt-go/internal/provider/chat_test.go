package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"godie/internal/core"
)

func TestChatCompletionsStreamingToolsUsageAndProjection(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Errorf("authorization missing")
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"id\":\"chat-1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello \"},\"finish_reason\":null}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"id\":\"chat-1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"world\",\"tool_calls\":[{\"index\":0,\"id\":\"call_server\",\"type\":\"function\",\"function\":{\"name\":\"execute\",\"arguments\":\"{\\\"code\\\":\"}}]},\"finish_reason\":null}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"id\":\"chat-1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"ok\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"id\":\"chat-1\",\"choices\":[],\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":4,\"prompt_tokens_details\":{\"cached_tokens\":5,\"cache_write_tokens\":2}}}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	p, err := NewChatCompletions(Config{Kind: "fixture", Model: "fixture-model", APIKey: "fixture-key", BaseURL: srv.URL + "/v1", HTTPClient: srv.Client()})
	if err != nil {
		t.Fatal(err)
	}
	var textEvents strings.Builder
	res, err := p.Complete(context.Background(), core.Request{System: "system", Messages: []core.Message{
		{Role: "user", Content: "look", Images: []core.Image{{MIME: "image/png", Data: "AAAA"}}},
		{Role: "tool", ToolCallID: "old-call", Images: []core.Image{{MIME: "image/jpeg", Data: "BBBB"}}},
	}, MaxTokens: 42, Thinking: "low"}, func(e core.StreamEvent) {
		if e.Type == "text" {
			textEvents.WriteString(e.Text)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Message.Content != "hello world" || textEvents.String() != res.Message.Content {
		t.Fatalf("text = %q events=%q", res.Message.Content, textEvents.String())
	}
	if res.StopReason != "tool" || res.ResponseID != "chat-1" {
		t.Fatalf("stop/id = %q/%q", res.StopReason, res.ResponseID)
	}
	if len(res.Message.ToolCalls) != 1 || res.Message.ToolCalls[0].ID != "call_server" || string(res.Message.ToolCalls[0].Arguments) != "{\"code\":\"ok\"}" {
		t.Fatalf("calls = %#v", res.Message.ToolCalls)
	}
	if res.Usage.Input != 13 || res.Usage.CacheRead != 5 || res.Usage.CacheWrite != 2 || res.Usage.Output != 4 {
		t.Fatalf("usage = %#v", res.Usage)
	}
	if got["stream"] != true || got["max_completion_tokens"] != float64(42) || got["reasoning_effort"] != "low" {
		t.Fatalf("request options = %#v", got)
	}
	encoded, _ := json.Marshal(got["messages"])
	requestText := string(encoded)
	for _, want := range []string{"data:image/png;base64,AAAA", "(see attached image)", "Attached image(s) from tool result:", "data:image/jpeg;base64,BBBB"} {
		if !strings.Contains(requestText, want) {
			t.Errorf("request missing %q: %s", want, requestText)
		}
	}
}

func TestChatCompletionsStableGeneratedToolID(t *testing.T) {
	serve := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"id\":\"same-response\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"execute\",\"arguments\":\"{\\\"code\\\":\\\"x\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n"))
	}
	srv := httptest.NewServer(http.HandlerFunc(serve))
	defer srv.Close()
	p, err := NewChatCompletions(Config{Model: "m", APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()})
	if err != nil {
		t.Fatal(err)
	}
	a, err := p.Complete(context.Background(), core.Request{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := p.Complete(context.Background(), core.Request{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(a.Message.ToolCalls) != 1 || !strings.HasPrefix(a.Message.ToolCalls[0].ID, "call_") || a.Message.ToolCalls[0].ID != b.Message.ToolCalls[0].ID {
		t.Fatalf("unstable ids: %#v %#v", a.Message.ToolCalls, b.Message.ToolCalls)
	}
}

func TestChatCompletionsRejectsTruncatedOrUncorrelatedToolsAndFast(t *testing.T) {
	for name, stream := range map[string]string{
		"truncated":    "data: {\"id\":\"x\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"},\"finish_reason\":null}]}\n\n",
		"uncorrelated": "data: {\"id\":\"x\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"function\":{\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n",
	} {
		t.Run(name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = w.Write([]byte(stream))
			}))
			defer srv.Close()
			p, _ := NewChatCompletions(Config{Model: "m", APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()})
			if _, err := p.Complete(context.Background(), core.Request{}, nil); err == nil {
				t.Fatal("expected error")
			}
		})
	}
	p, _ := NewChatCompletions(Config{Model: "m", APIKey: "k"})
	if _, err := p.Complete(context.Background(), core.Request{Fast: true}, nil); err == nil || !strings.Contains(err.Error(), "fast/premium") {
		t.Fatalf("fast error = %v", err)
	}
}

func TestChatCompletionsNativeReplayIsScoped(t *testing.T) {
	native := json.RawMessage(`{"role":"assistant","content":"native","vendor_field":{"opaque":true}}`)
	body, err := chatCompletionsBody(core.Request{Messages: []core.Message{{Role: "assistant", Content: "portable", Native: native, Provider: "fixture", Model: "m"}}}, "m", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(body["messages"])
	if !strings.Contains(string(b), "vendor_field") {
		t.Fatalf("native not replayed: %s", b)
	}
	body, err = chatCompletionsBody(core.Request{Messages: []core.Message{{Role: "assistant", Content: "portable", Native: native, Provider: "other", Model: "m"}}}, "m", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	b, _ = json.Marshal(body["messages"])
	if strings.Contains(string(b), "vendor_field") || !strings.Contains(string(b), "portable") {
		t.Fatalf("mismatched native replayed: %s", b)
	}
}

func TestChatCompletionsCancellationReturnsNoPartialResponse(t *testing.T) {
	started := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		_, _ = w.Write([]byte("data: {\"id\":\"cancelled\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"},\"finish_reason\":null}]}\n\n"))
		flusher.Flush()
		close(started)
		<-r.Context().Done()
	}))
	defer srv.Close()
	p, _ := NewChatCompletions(Config{Model: "m", APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()})
	ctx, cancel := context.WithCancel(context.Background())
	go func() { <-started; cancel() }()
	res, err := p.Complete(ctx, core.Request{}, nil)
	if !errors.Is(err, context.Canceled) || res.Message.Content != "" || len(res.Message.ToolCalls) != 0 {
		t.Fatalf("response/error = %#v / %v", res, err)
	}
}
