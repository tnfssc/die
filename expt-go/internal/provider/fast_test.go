package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"godie/internal/core"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func completedFixture() *http.Response {
	body := `data: {"type":"response.completed","response":{"id":"resp_fixture","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":0,"input_tokens_details":{"cached_tokens":0}}}}

`
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body))}
}

func decodeRequestBody(t *testing.T, r *http.Request) map[string]any {
	t.Helper()
	data, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.NewDecoder(bytes.NewReader(data)).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body
}

func TestFastOfficialLanesSerializeExactTier(t *testing.T) {
	tests := []struct{ name, providerID, modelID, wantTier string }{
		{"api", "openai", "gpt-6-astra", "fast"},
		{"codex", "openai-codex", "gpt-5.4", "priority"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got map[string]any
			client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				got = decodeRequestBody(t, r)
				if tt.providerID == "openai" && r.URL.String() != officialOpenAIBase+"/responses" {
					t.Fatalf("url = %s", r.URL)
				}
				if tt.providerID == "openai-codex" && r.URL.String() != officialCodexBase+"/codex/responses" {
					t.Fatalf("url = %s", r.URL)
				}
				return completedFixture(), nil
			})}
			req := core.Request{Model: tt.modelID, Fast: true}
			var err error
			if tt.providerID == "openai" {
				p := &openAIProvider{cfg: Config{Model: tt.modelID, APIKey: "fixture", BaseURL: officialOpenAIBase, HTTPClient: client}}
				_, err = p.Complete(context.Background(), req, nil)
			} else {
				p := &codexProvider{cfg: Config{Model: tt.modelID, BaseURL: officialCodexBase, HTTPClient: client}, cred: oauthCredential{Type: "oauth", Access: testCodexJWT(), Refresh: "fixture", Expires: time.Now().Add(time.Hour).UnixMilli()}}
				_, err = p.Complete(context.Background(), req, nil)
			}
			if err != nil {
				t.Fatal(err)
			}
			if got["model"] != tt.modelID || got["service_tier"] != tt.wantTier {
				t.Fatalf("payload identity = %#v", got)
			}
			if _, ok := got["speed"]; ok {
				t.Fatalf("unexpected speed field: %#v", got["speed"])
			}
		})
	}
}

func TestFastRefusesCustomEndpointsAndUnsupportedAliasesBeforeDispatch(t *testing.T) {
	called := atomic.Int32{}
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) { called.Add(1); return completedFixture(), nil })}
	cases := []struct{ providerID, modelID, base string }{
		{"openai", "gpt-6-astra", "https://proxy.invalid/v1"},
		{"openai", "gpt-6-astra-mini", officialOpenAIBase},
		{"openai-codex", "gpt-5.4", "https://proxy.invalid/backend-api"},
		{"openai-codex", "gpt-5.4-mini", officialCodexBase},
	}
	for _, tc := range cases {
		cfg := Config{Model: tc.modelID, APIKey: "fixture", BaseURL: tc.base, HTTPClient: client}
		var err error
		if tc.providerID == "openai" {
			_, err = (&openAIProvider{cfg: cfg}).Complete(context.Background(), core.Request{Fast: true}, nil)
		} else {
			p := &codexProvider{cfg: cfg, cred: oauthCredential{Type: "oauth", Access: testCodexJWT(), Refresh: "fixture", Expires: time.Now().Add(time.Hour).UnixMilli()}}
			_, err = p.Complete(context.Background(), core.Request{Fast: true}, nil)
		}
		if err == nil {
			t.Fatalf("%s/%s on %s was accepted", tc.providerID, tc.modelID, tc.base)
		}
	}
	if called.Load() != 0 {
		t.Fatalf("dispatched %d refused requests", called.Load())
	}
}

func TestAnthropicFastRefusalNeverSerializesSpeed(t *testing.T) {
	called := atomic.Int32{}
	p := &anthropicProvider{cfg: Config{Model: "claude-fixture", APIKey: "fixture", BaseURL: "https://api.anthropic.com", HTTPClient: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		called.Add(1)
		return nil, errors.New("must not dispatch")
	})}}}
	if _, err := p.Complete(context.Background(), core.Request{Fast: true}, nil); err == nil {
		t.Fatal("Anthropic fast was accepted")
	}
	if called.Load() != 0 {
		t.Fatal("Anthropic fast reached transport")
	}
}

func TestOpenAICompactionExplicitlySerializesDefaultTier(t *testing.T) {
	var got map[string]any
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		got = decodeRequestBody(t, r)
		return completedFixture(), nil
	})}
	p := &openAIProvider{cfg: Config{Model: "gpt-6-astra", APIKey: "fixture", BaseURL: officialOpenAIBase, HTTPClient: client}}
	if _, err := p.Compact(context.Background(), core.Request{Fast: true}, nil); err != nil {
		t.Fatal(err)
	}
	if got["service_tier"] != "default" {
		t.Fatalf("tier = %#v", got["service_tier"])
	}
}

func TestFailedFastRequestIsSingleAttemptWithoutDowngrade(t *testing.T) {
	calls := atomic.Int32{}
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		body := decodeRequestBody(t, r)
		if body["service_tier"] != "fast" {
			t.Fatalf("tier = %#v", body["service_tier"])
		}
		return nil, errors.New("fixture transport failure")
	})}
	p := &openAIProvider{cfg: Config{Model: "gpt-6-astra", APIKey: "fixture", BaseURL: officialOpenAIBase, HTTPClient: client}}
	if _, err := p.Complete(context.Background(), core.Request{Fast: true}, nil); err == nil {
		t.Fatal("transport failure was hidden")
	}
	if calls.Load() != 1 {
		t.Fatalf("attempts = %d", calls.Load())
	}
}
