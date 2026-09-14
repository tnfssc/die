package app

import (
	"fmt"
	"strings"

	"godie/internal/core"
	"godie/internal/provider"
)

func builtinProvider(kind string) bool {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "openai", "codex", "openai-codex", "anthropic", "gemini", "google":
		return true
	default:
		return false
	}
}

func configuredDefaultModel(providerID string) string {
	switch providerID {
	case "openai-codex", "codex":
		return "gpt-5.4"
	case "anthropic":
		return "claude-sonnet-4-6"
	case "google", "gemini":
		return "gemini-2.5-flash"
	default:
		return "gpt-4.1-mini"
	}
}

func selectedConfiguredModel(cfg ModelProviderConfig, id string) (ModelInfo, bool) {
	for _, m := range cfg.Models {
		if m.ID == id {
			return m, true
		}
	}
	return ModelInfo{}, false
}

// configureProviderOptions applies only model selection/capability semantics.
// Credential and header values remain untouched until provider construction.
func configureProviderOptions(o *Options) error {
	providers, err := LoadModelProviders(o.StateDir)
	if err != nil {
		return err
	}
	cfg, configured := providers[o.Provider]
	if !configured {
		if builtinProvider(o.Provider) {
			return nil
		}
		return nil // provider.New retains the established unknown-provider error
	}
	if o.Provider == "codex" || o.Provider == "openai-codex" {
		return fmt.Errorf("models config: OAuth Codex provider overrides are refused")
	}
	if o.Model == "" {
		if builtinProvider(o.Provider) {
			o.Model = configuredDefaultModel(o.Provider)
		} else if len(cfg.Models) > 0 {
			o.Model = cfg.Models[0].ID
		} else {
			return fmt.Errorf("models config: provider %s has no models", o.Provider)
		}
	}
	m, ok := selectedConfiguredModel(cfg, o.Model)
	if !ok {
		return fmt.Errorf("models config: model %s is not configured for provider %s", o.Model, o.Provider)
	}
	if !m.Reasoning {
		if o.ThinkingSet && o.Thinking != "off" && o.Thinking != "none" && o.Thinking != "" {
			return fmt.Errorf("models config: model %s does not support reasoning", o.Model)
		}
		o.Thinking = "off"
		return nil
	}
	if mapped, present := m.ThinkingLevelMap[o.Thinking]; present {
		if mapped == nil {
			if o.ThinkingSet {
				return fmt.Errorf("models config: model %s does not support thinking level %s", o.Model, o.Thinking)
			}
			o.Thinking = "off"
		} else {
			o.Thinking = *mapped
		}
	}
	return nil
}

func newApplicationProvider(o Options) (core.Provider, error) {
	providers, err := LoadModelProviders(o.StateDir)
	if err != nil {
		return nil, err
	}
	cfg, configured := providers[o.Provider]
	if (o.Provider == "codex" || o.Provider == "openai-codex") && configured {
		return nil, fmt.Errorf("models config: OAuth Codex provider overrides are refused")
	}
	if !configured {
		return provider.New(provider.Config{Kind: o.Provider, Model: o.Model, APIKey: o.APIKey, BaseURL: o.BaseURL, AuthStateDir: o.StateDir, UseEnvironment: true})
	}
	m, ok := selectedConfiguredModel(cfg, o.Model)
	if !ok {
		return nil, fmt.Errorf("models config: model %s is not configured for provider %s", o.Model, o.Provider)
	}
	api := strings.ToLower(strings.TrimSpace(m.API))
	if api == "" {
		api = cfg.API
	}
	if api == "" {
		return nil, fmt.Errorf("models config: provider %s model %s is missing api", o.Provider, o.Model)
	}
	baseURL := m.BaseURL
	if baseURL == "" {
		baseURL = cfg.BaseURL
	}
	if o.BaseURL != "" {
		baseURL = o.BaseURL
	}
	if !builtinProvider(o.Provider) && baseURL == "" {
		return nil, fmt.Errorf("models config: provider %s requires baseUrl", o.Provider)
	}
	apiKey := cfg.APIKey
	if o.APIKey != "" {
		apiKey = o.APIKey
	}
	headers := mergeModelHeaders(cfg.Headers, m.Headers)
	if o.APIKey != "" {
		authHeader := map[string]string{"openai-responses": "Authorization", "openai-completions": "Authorization", "openai-chat-completions": "Authorization", "anthropic-messages": "x-api-key", "google-generative-ai": "x-goog-api-key"}[api]
		for k := range headers {
			if strings.EqualFold(k, authHeader) {
				delete(headers, k)
			}
		}
	}
	pc := provider.Config{Kind: o.Provider, Model: o.Model, APIKey: apiKey, BaseURL: baseURL, Headers: headers, DefaultMaxTokens: m.MaxTokens, AuthStateDir: o.StateDir, UseEnvironment: builtinProvider(o.Provider)}
	switch api {
	case "openai-completions", "openai-chat-completions":
		return provider.NewChatCompletions(pc)
	case "openai-responses":
		return provider.NewResponses(pc)
	case "anthropic-messages":
		return provider.NewAnthropicMessages(pc)
	case "google-generative-ai":
		return provider.NewGoogleGenerativeAI(pc)
	case "openai-codex-responses":
		return nil, fmt.Errorf("models config: OAuth Codex Responses routing is not configurable")
	default:
		return nil, fmt.Errorf("models config: provider %s uses unsupported api %q", o.Provider, api)
	}
}
