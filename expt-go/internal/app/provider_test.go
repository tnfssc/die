package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"godie/internal/core"
)

func writeModelsConfig(t *testing.T, state string, cfg any) {
	t.Helper()
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(state, "models.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestCustomModelsJSONNativeAdapters(t *testing.T) {
	tests := []struct {
		name, api, path string
		response        func(http.ResponseWriter)
		checkBody       func(*testing.T, map[string]any)
	}{
		{"responses", "openai-responses", "/v1/responses", func(w http.ResponseWriter) {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"r\",\"status\":\"completed\",\"output\":[],\"usage\":{}}}\n\n")
		}, func(t *testing.T, b map[string]any) {
			if b["max_output_tokens"] != float64(321) {
				t.Fatalf("body=%#v", b)
			}
		}},
		{"anthropic", "anthropic-messages", "/v1/messages", func(w http.ResponseWriter) {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"type\":\"message_start\",\"message\":{\"id\":\"a\",\"usage\":{}}}\n\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{}}\n\ndata: {\"type\":\"message_stop\"}\n\n")
		}, func(t *testing.T, b map[string]any) {
			if b["max_tokens"] != float64(321) {
				t.Fatalf("body=%#v", b)
			}
		}},
		{"gemini", "google-generative-ai", "/v1beta/models/fixture-model:streamGenerateContent", func(w http.ResponseWriter) {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"ok\"}]},\"finishReason\":\"STOP\"}]}\n\n")
		}, func(t *testing.T, b map[string]any) {
			g := b["generationConfig"].(map[string]any)
			if g["maxOutputTokens"] != float64(321) {
				t.Fatalf("body=%#v", b)
			}
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got map[string]any
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != tt.path {
					t.Errorf("path=%s want=%s", r.URL.Path, tt.path)
				}
				if r.Header.Get("X-Provider") != "provider" || r.Header.Get("X-Model") != "model" {
					t.Errorf("headers=%#v", r.Header)
				}
				if r.Header.Get("Authorization") != "" && tt.api != "openai-responses" {
					t.Error("OpenAI credential leaked")
				}
				if r.Header.Get("x-api-key") != "" && tt.api != "anthropic-messages" {
					t.Error("Anthropic credential leaked")
				}
				if r.Header.Get("x-goog-api-key") != "" && tt.api != "google-generative-ai" {
					t.Error("Google credential leaked")
				}
				json.NewDecoder(r.Body).Decode(&got)
				tt.response(w)
			}))
			defer srv.Close()
			state := t.TempDir()
			writeModelsConfig(t, state, map[string]any{"providers": map[string]any{"fixture": map[string]any{"baseUrl": srv.URL + map[string]string{"responses": "/v1", "anthropic": "/v1", "gemini": "/v1beta"}[tt.name], "api": tt.api, "apiKey": "fixture-key", "headers": map[string]string{"X-Provider": "provider"}, "models": []any{map[string]any{"id": "fixture-model", "reasoning": false, "maxTokens": 321, "headers": map[string]string{"X-Model": "model"}}}}}})
			o := Options{StateDir: state, Provider: "fixture"}
			if err := configureProviderOptions(&o); err != nil {
				t.Fatal(err)
			}
			if o.Model != "fixture-model" || o.Thinking != "off" {
				t.Fatalf("options=%#v", o)
			}
			p, err := newApplicationProvider(o)
			if err != nil {
				t.Fatal(err)
			}
			res, err := p.Complete(context.Background(), core.Request{Model: o.Model, Messages: []core.Message{{Role: "user", Content: "hi"}}}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if res.Message.Provider != "fixture" || res.Message.Model != "fixture-model" {
				t.Fatalf("provenance=%#v", res.Message)
			}
			tt.checkBody(t, got)
		})
	}
}

func TestConfiguredExplicitOptionsWinAndHeadersStayScoped(t *testing.T) {
	var path, key string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		key = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"r\",\"status\":\"completed\",\"output\":[],\"usage\":{}}}\n\n")
	}))
	defer srv.Close()
	state := t.TempDir()
	writeModelsConfig(t, state, map[string]any{"providers": map[string]any{"fixture": map[string]any{"baseUrl": "http://127.0.0.1:1/v1", "api": "openai-responses", "apiKey": "config-key", "headers": map[string]string{"Authorization": "Bearer configured"}, "models": []any{map[string]any{"id": "m"}}}}})
	o := Options{StateDir: state, Provider: "fixture", Model: "m", BaseURL: srv.URL + "/explicit", APIKey: "explicit-key"}
	p, err := newApplicationProvider(o)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.Complete(context.Background(), core.Request{Model: "m"}, nil); err != nil {
		t.Fatal(err)
	}
	if path != "/explicit/responses" {
		t.Fatal(path)
	}
	// An explicit CLI key removes a conflicting configured auth header.
	if key != "Bearer explicit-key" {
		t.Fatalf("authorization=%q", key)
	}
}

func TestCustomModelsJSONRejectsUnlistedModelAndUnsupportedAPI(t *testing.T) {
	state := t.TempDir()
	os.WriteFile(filepath.Join(state, "models.json"), []byte(`{"providers":{"custom":{"api":"cohere-chat","baseUrl":"http://127.0.0.1","apiKey":"x","models":[{"id":"one"}]}}}`), 0600)
	o := Options{StateDir: state, Provider: "custom", Model: "two"}
	if configureProviderOptions(&o) == nil {
		t.Fatal("unlisted model accepted")
	}
	o.Model = "one"
	if _, err := newApplicationProvider(o); err == nil || !strings.Contains(err.Error(), "unsupported api") {
		t.Fatalf("err=%v", err)
	}
}

func TestParseOptionsLeavesDefaultMaxTokensProviderControlled(t *testing.T) {
	o, err := ParseOptions(nil)
	if err != nil {
		t.Fatal(err)
	}
	if o.MaxTokens != 0 {
		t.Fatalf("default max tokens=%d", o.MaxTokens)
	}
	o, err = ParseOptions([]string{"--max-tokens", "77"})
	if err != nil || o.MaxTokens != 77 {
		t.Fatalf("explicit max: %#v %v", o, err)
	}
}
