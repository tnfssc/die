package provider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"godie/internal/core"
)

func sse(w http.ResponseWriter, events ...string) {
	w.Header().Set("Content-Type", "text/event-stream")
	for _, e := range events {
		fmt.Fprintf(w, "data: %s\n\n", e)
	}
}
func TestOpenAIResponsesNativeReplayToolsUsage(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing auth")
		}
		json.NewDecoder(r.Body).Decode(&got)
		sse(w,
			`{"type":"response.output_text.delta","delta":"hi "}`,
			`{"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","id":"msg_1","role":"assistant","content":[{"type":"output_text","text":"hi there"}]},{"type":"function_call","id":"fc_1","call_id":"call_1","name":"execute","arguments":"{\"code\":\"1+1\"}"}],"usage":{"input_tokens":12,"output_tokens":4,"input_tokens_details":{"cached_tokens":7}}}}`)
	}))
	defer srv.Close()
	p, err := New(Config{Kind: "openai", Model: "gpt-test", APIKey: "test-key", BaseURL: srv.URL, HTTPClient: srv.Client()})
	if err != nil {
		t.Fatal(err)
	}
	native := json.RawMessage(`[{"type":"reasoning","id":"rs_keep","encrypted_content":"opaque"},{"type":"function_call","call_id":"old_call","name":"execute","arguments":"{\"code\":\"old\"}"}]`)
	var streamed string
	res, err := p.Complete(context.Background(), core.Request{System: "system", SessionID: "s", MaxTokens: 123, Messages: []core.Message{{Role: "assistant", Native: native}, {Role: "tool", ToolCallID: "old_call", Content: "old output"}}}, func(e core.StreamEvent) {
		if e.Type == "text" {
			streamed += e.Text
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if streamed != "hi " || res.Message.Content != "hi there" || res.StopReason != "tool" {
		t.Fatalf("bad response: %#v stream=%q", res, streamed)
	}
	if len(res.Message.ToolCalls) != 1 || res.Message.ToolCalls[0].ID != "call_1" || string(res.Message.ToolCalls[0].Arguments) != `{"code":"1+1"}` {
		t.Fatalf("bad call: %#v", res.Message.ToolCalls)
	}
	if res.Usage.Input != 5 || res.Usage.CacheRead != 7 {
		t.Fatalf("bad usage: %#v", res.Usage)
	}
	in := got["input"].([]any)
	if in[0].(map[string]any)["id"] != "rs_keep" || in[2].(map[string]any)["call_id"] != "old_call" {
		t.Fatalf("native replay/correlation lost: %#v", in)
	}
	if got["store"] != false {
		t.Fatal("store must be false")
	}
	if got["max_output_tokens"] != float64(123) {
		t.Fatalf("public Responses max output missing: %#v", got)
	}
}

func TestCodexSniffsSSEAndUsesSupportedProfile(t *testing.T) {
	for _, contentType := range []string{"", "application/json"} {
		t.Run(contentType, func(t *testing.T) {
			var got map[string]any
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("originator") != "pi" || r.Header.Get("OpenAI-Beta") != "responses=experimental" || r.Header.Get("Accept") != "text/event-stream" {
					t.Errorf("bad Codex profile headers: %#v", r.Header)
				}
				if contentType != "" {
					w.Header().Set("Content-Type", contentType)
				}
				if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
					t.Error(err)
				}
				fmt.Fprint(w, "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n")
				fmt.Fprint(w, "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"r1\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"hello\"}]}],\"usage\":{}}}\n\n")
			}))
			defer srv.Close()
			p := &codexProvider{cfg: Config{Model: "gpt-5.6-luna", BaseURL: srv.URL, HTTPClient: srv.Client()}, cred: oauthCredential{Type: "oauth", Access: token("acct"), Refresh: "refresh", Expires: time.Now().Add(time.Hour).UnixMilli()}}
			res, err := p.Complete(context.Background(), core.Request{MaxTokens: 512, SessionID: "session"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if res.Message.Content != "hello" {
				t.Fatalf("response: %#v", res)
			}
			if _, ok := got["max_output_tokens"]; ok {
				t.Fatal("Codex must not receive max_output_tokens")
			}
			include, ok := got["include"].([]any)
			if !ok || len(include) != 1 || include[0] != "reasoning.encrypted_content" {
				t.Fatalf("missing encrypted reasoning include: %#v", got)
			}
			if got["store"] != false || got["stream"] != true || got["tool_choice"] != "auto" || got["parallel_tool_calls"] != true {
				t.Fatalf("bad Codex body profile: %#v", got)
			}
		})
	}
}

func TestSafeHTTPErrorAllowlistAndRedaction(t *testing.T) {
	err := safeHTTPError(400, []byte(`{"error":{"message":"unsupported; Bearer super-secret-token","type":"invalid_request_error","code":"bad","private":"must-not-leak"},"raw":"also-secret"}`)).Error()
	if !strings.Contains(err, "unsupported") || !strings.Contains(err, "[redacted]") || strings.Contains(err, "super-secret") || strings.Contains(err, "must-not-leak") || strings.Contains(err, "also-secret") {
		t.Fatalf("unsafe error: %s", err)
	}
	if got := safeHTTPError(500, []byte("not json")).Error(); got != "provider: HTTP status 500" {
		t.Fatalf("raw body leaked: %s", got)
	}
}

func TestResponsesRejectsTruncatedSSE(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
	}))
	defer srv.Close()
	p, _ := New(Config{Kind: "openai", Model: "m", APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()})
	_, err := p.Complete(context.Background(), core.Request{}, nil)
	if err == nil || !strings.Contains(err.Error(), "before response.completed") {
		t.Fatalf("expected truncated stream error, got %v", err)
	}
}

func TestOpenAICancellation(t *testing.T) {
	cancelSeen := make(chan struct{})
	started := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
		close(cancelSeen)
	}))
	defer srv.Close()
	p, _ := New(Config{Kind: "openai", Model: "m", APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()})
	ctx, cancel := context.WithCancel(context.Background())
	go func() { <-started; cancel() }()
	defer cancel()
	_, err := p.Complete(ctx, core.Request{}, nil)
	if err == nil {
		t.Fatal("expected cancellation")
	}
	select {
	case <-cancelSeen:
	case <-time.After(time.Second):
		t.Fatal("server did not observe cancellation")
	}
}
func token(account string) string {
	return "x." + base64.RawURLEncoding.EncodeToString([]byte(`{"https://api.openai.com/auth":{"chatgpt_account_id":"`+account+`"}}`)) + ".x"
}

func TestCodexRefreshLockSharedAcrossInstances(t *testing.T) {
	state := t.TempDir()
	expired := map[string]oauthCredential{"openai-codex": {Type: "oauth", Access: token("old"), Refresh: "refresh", Expires: 1}}
	b, _ := json.Marshal(expired)
	if err := os.WriteFile(filepath.Join(state, "auth.json"), b, 0600); err != nil {
		t.Fatal(err)
	}
	var refreshes atomic.Int32
	fresh := token("fresh")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth/token":
			refreshes.Add(1)
			time.Sleep(30 * time.Millisecond)
			json.NewEncoder(w).Encode(map[string]any{"access_token": fresh, "refresh_token": "rotated", "expires_in": 3600})
		case "/codex/responses":
			sse(w, `{"type":"response.completed","response":{"id":"r","status":"completed","output":[],"usage":{}}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	cfg := Config{Kind: "codex", Model: "m", AuthStateDir: state, BaseURL: srv.URL, OAuthBaseURL: srv.URL, HTTPClient: srv.Client()}
	p1, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	p2, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	errs := make(chan error, 2)
	for _, p := range []core.Provider{p1, p2} {
		go func(p core.Provider) {
			<-start
			_, err := p.Complete(context.Background(), core.Request{}, nil)
			errs <- err
		}(p)
	}
	close(start)
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	if refreshes.Load() != 1 {
		t.Fatalf("refresh count = %d, want 1", refreshes.Load())
	}
}

func TestCodexExplicitImportRefreshIsIsolated(t *testing.T) {
	sourceDir := t.TempDir()
	state := t.TempDir()
	source := filepath.Join(sourceDir, "auth.json")
	old := []byte(`{"openai-codex":{"type":"oauth","access":"old.secret","refresh":"refresh.secret","expires":1},"other":{"type":"api_key","key":"do-not-copy"}}`)
	if err := os.WriteFile(source, old, 0600); err != nil {
		t.Fatal(err)
	}
	if err := ImportCodexAuth(source, state); err != nil {
		t.Fatal(err)
	}
	var refreshes atomic.Int32
	fresh := token("acct_1")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth/token":
			refreshes.Add(1)
			if err := r.ParseForm(); err != nil || r.Form.Get("refresh_token") != "refresh.secret" {
				t.Error("bad refresh")
			}
			json.NewEncoder(w).Encode(map[string]any{"access_token": fresh, "refresh_token": "rotated.secret", "expires_in": 3600})
		case "/codex/responses":
			if r.Header.Get("chatgpt-account-id") != "acct_1" || r.Header.Get("Authorization") != "Bearer "+fresh {
				t.Error("bad codex headers")
			}
			sse(w, `{"type":"response.completed","response":{"id":"r","output":[],"usage":{}}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	p, err := New(Config{Kind: "codex", Model: "codex-test", AuthStateDir: state, BaseURL: srv.URL, OAuthBaseURL: srv.URL, HTTPClient: srv.Client()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.Complete(context.Background(), core.Request{}, nil); err != nil {
		t.Fatal(err)
	}
	if refreshes.Load() != 1 {
		t.Fatal("refresh not called")
	}
	after, _ := os.ReadFile(source)
	if string(after) != string(old) {
		t.Fatal("source auth mutated")
	}
	isolated, _ := os.ReadFile(filepath.Join(state, "auth.json"))
	if strings.Contains(string(isolated), "do-not-copy") || !strings.Contains(string(isolated), "rotated.secret") {
		t.Fatal("bad isolated auth state")
	}
	info, _ := os.Stat(filepath.Join(state, "auth.json"))
	if info.Mode().Perm() != 0600 {
		t.Fatalf("mode %o", info.Mode().Perm())
	}
}
func TestRejectFastTier(t *testing.T) {
	p, _ := New(Config{Kind: "openai", APIKey: "k", Model: "m"})
	if _, err := p.Complete(context.Background(), core.Request{Fast: true}, nil); err == nil {
		t.Fatal("fast tier should be rejected")
	}
}

func TestAnthropicFixtureNativeAndCorrelation(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "ak" {
			t.Error("missing key")
		}
		json.NewDecoder(r.Body).Decode(&got)
		sse(w,
			`{"type":"message_start","message":{"id":"msg_a","usage":{"input_tokens":9,"cache_read_input_tokens":3}}}`,
			`{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}`,
			`{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_a","name":"execute","input":{}}}`,
			`{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"code\":\"ok\"}"}}`,
			`{"type":"content_block_stop","index":1}`,
			`{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}`,
			`{"type":"message_stop"}`)
	}))
	defer srv.Close()
	p, err := New(Config{Kind: "anthropic", Model: "claude-test", APIKey: "ak", BaseURL: srv.URL, HTTPClient: srv.Client()})
	if err != nil {
		t.Fatal(err)
	}
	prior := json.RawMessage(`[{"type":"text","text":"prior","citations":[{"opaque":true}]}]`)
	res, err := p.Complete(context.Background(), core.Request{Messages: []core.Message{{Role: "assistant", Native: prior}, {Role: "tool", ToolCallID: "before", Content: "result"}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Message.Content != "hello" || res.StopReason != "tool" || len(res.Message.ToolCalls) != 1 || res.Message.ToolCalls[0].ID != "tool_a" || string(res.Message.ToolCalls[0].Arguments) != `{"code":"ok"}` {
		t.Fatalf("bad response %#v", res)
	}
	if res.Usage.Input != 9 || res.Usage.Output != 5 || res.Usage.CacheRead != 3 {
		t.Fatalf("bad usage %#v", res.Usage)
	}
	msgs := got["messages"].([]any)
	first := msgs[0].(map[string]any)["content"].([]any)[0].(map[string]any)
	if first["citations"] == nil {
		t.Fatal("native replay lost")
	}
}
func TestGeminiFixtureStreamingAndKeyHeader(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-goog-api-key") != "gk" || strings.Contains(r.URL.RawQuery, "gk") {
			t.Error("Gemini key must be header-only")
		}
		json.NewDecoder(r.Body).Decode(&got)
		sse(w,
			`{"candidates":[{"content":{"role":"model","parts":[{"text":"hey "}]}}],"usageMetadata":{"promptTokenCount":8,"cachedContentTokenCount":2}}`,
			`{"candidates":[{"content":{"role":"model","parts":[{"text":"there"},{"functionCall":{"id":"gcall","name":"execute","args":{"code":"2+2"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":6,"cachedContentTokenCount":2}}`)
	}))
	defer srv.Close()
	p, err := New(Config{Kind: "gemini", Model: "gemini-test", APIKey: "gk", BaseURL: srv.URL, HTTPClient: srv.Client()})
	if err != nil {
		t.Fatal(err)
	}
	native := json.RawMessage(`{"role":"model","parts":[{"text":"old","thoughtSignature":"opaque"}]}`)
	res, err := p.Complete(context.Background(), core.Request{Messages: []core.Message{{Role: "assistant", Native: native}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Message.Content != "hey there" || len(res.Message.ToolCalls) != 1 || res.Message.ToolCalls[0].ID != "gcall" || res.StopReason != "tool" {
		t.Fatalf("bad Gemini response %#v", res)
	}
	if res.Usage.Input != 6 || res.Usage.Output != 6 || res.Usage.CacheRead != 2 {
		t.Fatalf("bad usage %#v", res.Usage)
	}
	contents := got["contents"].([]any)
	parts := contents[0].(map[string]any)["parts"].([]any)
	if parts[0].(map[string]any)["thoughtSignature"] != "opaque" {
		t.Fatal("Gemini native replay lost")
	}
}

func TestResponsesCompletedItemsSurviveEmptyFinalOutput(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		emit := func(event map[string]any) {
			b, err := json.Marshal(event)
			if err != nil {
				t.Fatal(err)
			}
			sse(w, string(b))
		}
		// Stripped, synthetic shapes recorded from the live Codex stream. The
		// tool arrives before output index zero to exercise ordering as well.
		emit(map[string]any{"type": "response.output_item.added", "output_index": 1, "item": map[string]any{"id": "fc_live", "type": "function_call", "status": "in_progress", "arguments": "", "call_id": "call_live", "name": "execute"}})
		emit(map[string]any{"type": "response.function_call_arguments.delta", "output_index": 1, "item_id": "fc_live", "delta": "{\"code\":\"partial"})
		emit(map[string]any{"type": "response.output_item.done", "output_index": 1, "item": map[string]any{"id": "fc_live", "type": "function_call", "status": "completed", "arguments": "{\"code\":\"console.log(42)\"}", "call_id": "call_live", "name": "execute"}})
		emit(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"id": "msg_live", "type": "message", "status": "in_progress", "content": []any{}, "role": "assistant"}})
		emit(map[string]any{"type": "response.output_text.delta", "output_index": 0, "item_id": "msg_live", "content_index": 0, "delta": "hello"})
		emit(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": map[string]any{"id": "msg_live", "type": "message", "status": "completed", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "hello", "annotations": []any{}}}}})
		emit(map[string]any{"type": "response.output_item.done", "output_index": 2, "item": map[string]any{"id": "rs_live", "type": "reasoning", "encrypted_content": "synthetic-placeholder", "summary": []any{}}})
		emit(map[string]any{"type": "response.completed", "response": map[string]any{"id": "resp_live", "status": "completed", "output": []any{}, "usage": map[string]any{"input_tokens": 3, "output_tokens": 4}}})
	}))
	defer srv.Close()

	p, err := New(Config{Kind: "openai", Model: "gpt-test", APIKey: "test-key", BaseURL: srv.URL, HTTPClient: srv.Client()})
	if err != nil {
		t.Fatal(err)
	}
	var streamed string
	res, err := p.Complete(context.Background(), core.Request{}, func(event core.StreamEvent) {
		if event.Type == "text" {
			streamed += event.Text
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if streamed != "hello" || res.Message.Content != "hello" || res.StopReason != "tool" {
		t.Fatalf("message was not reduced from completed items: %#v stream=%q", res, streamed)
	}
	if len(res.Message.ToolCalls) != 1 || res.Message.ToolCalls[0].ID != "call_live" || res.Message.ToolCalls[0].Name != "execute" || string(res.Message.ToolCalls[0].Arguments) != "{\"code\":\"console.log(42)\"}" {
		t.Fatalf("complete tool call was not persisted: %#v", res.Message.ToolCalls)
	}
	var native []map[string]any
	if err := json.Unmarshal(res.Message.Native, &native); err != nil {
		t.Fatal(err)
	}
	if len(native) != 3 || native[0]["id"] != "msg_live" || native[1]["id"] != "fc_live" || native[2]["id"] != "rs_live" || native[2]["encrypted_content"] != "synthetic-placeholder" {
		t.Fatalf("completed item order/raw fields lost: %s", res.Message.Native)
	}
}
