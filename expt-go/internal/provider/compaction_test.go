package provider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"godie/internal/core"
)

func testCodexJWT() string {
	payload, _ := json.Marshal(map[string]any{"https://api.openai.com/auth": map[string]any{"chatgpt_account_id": "acct_test"}})
	return "x." + base64.RawURLEncoding.EncodeToString(payload) + ".x"
}

func TestCodexNativeCompactPinsIdentityTierAndOpaqueItem(t *testing.T) {
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/codex/responses" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if r.Header.Get("chatgpt-account-id") != "acct_test" {
			t.Errorf("missing account header")
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"compaction\",\"id\":\"cmp_1\",\"encrypted_content\":\"opaque\"}}\n\n"))
		_, _ = w.Write([]byte("data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\",\"status\":\"completed\",\"output\":[{\"type\":\"compaction\",\"id\":\"cmp_1\",\"encrypted_content\":\"opaque\"}],\"usage\":{\"input_tokens\":100,\"output_tokens\":10,\"input_tokens_details\":{\"cached_tokens\":20}}}}\n\n"))
	}))
	defer server.Close()
	p := &codexProvider{cfg: Config{Model: "gpt-5.4", BaseURL: server.URL, HTTPClient: server.Client()}, cred: oauthCredential{Type: "oauth", Access: testCodexJWT(), Refresh: "r", Expires: time.Now().Add(time.Hour).UnixMilli()}}
	res, err := p.Compact(context.Background(), core.Request{Fast: true, Messages: []core.Message{{Role: "user", Content: "hello"}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got["service_tier"] != "default" {
		t.Fatalf("tier = %#v", got["service_tier"])
	}
	input := got["input"].([]any)
	last := input[len(input)-1].(map[string]any)
	if last["type"] != "compaction_trigger" {
		t.Fatalf("last input = %#v", last)
	}
	if res.Message.Provider != "openai-codex" || res.Message.Model != "gpt-5.4" || !containsCompactionCheckpoint(res.Message.Native) {
		t.Fatalf("opaque identity lost: %#v", res.Message)
	}
	if res.Usage.Input != 80 || res.Usage.CacheRead != 20 {
		t.Fatalf("usage = %#v", res.Usage)
	}
	if res.Usage.Cost != .000355 {
		t.Fatalf("cost = %.9f", res.Usage.Cost)
	}
}

func TestOpaqueCheckpointRequiresExactReplayIdentity(t *testing.T) {
	native := json.RawMessage(`[{"type":"compaction","id":"cmp_1","encrypted_content":"opaque"}]`)
	body, err := responsesBody(core.Request{Messages: []core.Message{{Role: "assistant", Native: native, Provider: "openai-codex", Model: "gpt-5.4"}}}, "gpt-5.4-mini", "openai-codex")
	if err == nil || body != nil {
		t.Fatal("cross-model opaque checkpoint was not rejected")
	}
}

func TestBeginAndCompleteCodexBrowserLoginFixture(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth/token" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		_ = r.ParseForm()
		if r.Form.Get("code_verifier") == "" || r.Form.Get("redirect_uri") != codexRedirectURI {
			t.Fatalf("bad exchange form: %#v", r.Form)
		}
		_, _ = w.Write([]byte(`{"access_token":"a","refresh_token":"r","expires_in":3600}`))
	}))
	defer server.Close()
	flow, err := BeginCodexBrowserLogin(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	authURL, _ := url.Parse(flow.AuthorizationURL)
	if authURL.Query().Get("code_challenge_method") != "S256" || authURL.Query().Get("originator") != "pi" {
		t.Fatalf("authorization URL = %s", flow.AuthorizationURL)
	}
	dir := t.TempDir()
	callback := codexRedirectURI + "?code=code&state=" + url.QueryEscape(flow.State)
	if err := flow.Complete(context.Background(), callback, dir, server.Client()); err != nil {
		t.Fatal(err)
	}
}
