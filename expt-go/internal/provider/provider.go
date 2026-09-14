package provider

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"

	"godie/internal/core"
)

// Compactor is an optional provider capability. Compact must use the request's
// resolved provider/model identity and standard service tier; it must not silently
// fall back to a different compaction strategy.
type Compactor interface {
	Compact(context.Context, core.Request, func(core.StreamEvent)) (core.Response, error)
}

type Config struct {
	DefaultMaxTokens int
	Kind             string
	Model            string
	APIKey           string
	BaseURL          string
	HTTPClient       *http.Client
	Headers          map[string]string
	AuthStateDir     string
	OAuthBaseURL     string // test/private OAuth authority; defaults to OpenAI
	UseEnvironment   bool
}

func cloneStringMap(src map[string]string) map[string]string {
	if len(src) == 0 {
		return nil
	}
	out := make(map[string]string, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

func prepareNativeConfig(cfg Config, fallbackKind, fallbackBase, missingKey string) (Config, error) {
	cfg.Headers = cloneStringMap(cfg.Headers)
	cfg.Kind = strings.TrimSpace(cfg.Kind)
	if cfg.Kind == "" {
		cfg.Kind = fallbackKind
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = http.DefaultClient
	}
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if cfg.BaseURL == "" {
		cfg.BaseURL = fallbackBase
	}
	if cfg.APIKey == "" && cfg.UseEnvironment {
		switch strings.ToLower(cfg.Kind) {
		case "openai":
			cfg.APIKey = os.Getenv("OPENAI_API_KEY")
		case "anthropic":
			cfg.APIKey = os.Getenv("ANTHROPIC_API_KEY")
		case "gemini", "google":
			cfg.APIKey = os.Getenv("GEMINI_API_KEY")
		}
	}
	if cfg.APIKey == "" {
		return Config{}, errors.New(missingKey)
	}
	return cfg, nil
}

// NewResponses constructs an OpenAI Responses wire adapter while preserving
// cfg.Kind as the request/response provenance identity.
func NewResponses(cfg Config) (core.Provider, error) {
	cfg, err := prepareNativeConfig(cfg, "openai", "https://api.openai.com/v1", "provider: Responses API key is required")
	if err != nil {
		return nil, err
	}
	return &openAIProvider{cfg: cfg}, nil
}

// NewAnthropicMessages constructs an Anthropic Messages wire adapter.
func NewAnthropicMessages(cfg Config) (core.Provider, error) {
	cfg, err := prepareNativeConfig(cfg, "anthropic", "https://api.anthropic.com", "provider: Anthropic API key is required")
	if err != nil {
		return nil, err
	}
	return &anthropicProvider{cfg: cfg}, nil
}

// NewGoogleGenerativeAI constructs a Google Generative AI wire adapter.
func NewGoogleGenerativeAI(cfg Config) (core.Provider, error) {
	cfg, err := prepareNativeConfig(cfg, "gemini", "https://generativelanguage.googleapis.com/v1beta", "provider: Gemini API key is required")
	if err != nil {
		return nil, err
	}
	return &geminiProvider{cfg: cfg}, nil
}

func requestHeaders(defaults, configured map[string]string) map[string]string {
	out := make(map[string]string, len(defaults)+len(configured))
	for k, v := range defaults {
		out[k] = v
	}
	for k, v := range configured {
		for old := range out {
			if strings.EqualFold(old, k) {
				delete(out, old)
			}
		}
		out[k] = v
	}
	return out
}

func New(cfg Config) (core.Provider, error) {
	cfg.Headers = cloneStringMap(cfg.Headers)
	cfg.Kind = strings.ToLower(strings.TrimSpace(cfg.Kind))
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = http.DefaultClient
	}
	if cfg.APIKey == "" && cfg.UseEnvironment {
		switch cfg.Kind {
		case "openai":
			cfg.APIKey = os.Getenv("OPENAI_API_KEY")
		case "anthropic":
			cfg.APIKey = os.Getenv("ANTHROPIC_API_KEY")
		case "gemini", "google":
			cfg.APIKey = os.Getenv("GEMINI_API_KEY")
		}
	}
	switch cfg.Kind {
	case "openai":
		if cfg.APIKey == "" {
			return nil, errors.New("provider: OPENAI API key is required")
		}
		if cfg.BaseURL == "" {
			cfg.BaseURL = "https://api.openai.com/v1"
		}
		return &openAIProvider{cfg: cfg}, nil
	case "codex", "openai-codex":
		if cfg.AuthStateDir == "" {
			return nil, errors.New("provider: codex requires an isolated AuthStateDir")
		}
		if cfg.BaseURL == "" {
			cfg.BaseURL = "https://chatgpt.com/backend-api"
		}
		return newCodexProvider(cfg)
	case "anthropic":
		if cfg.APIKey == "" {
			return nil, errors.New("provider: Anthropic API key is required")
		}
		if cfg.BaseURL == "" {
			cfg.BaseURL = "https://api.anthropic.com"
		}
		return &anthropicProvider{cfg: cfg}, nil
	case "gemini", "google":
		if cfg.APIKey == "" {
			return nil, errors.New("provider: Gemini API key is required")
		}
		cfg.Kind = "gemini"
		if cfg.BaseURL == "" {
			cfg.BaseURL = "https://generativelanguage.googleapis.com/v1beta"
		}
		return &geminiProvider{cfg: cfg}, nil
	default:
		return nil, errors.New("provider: Kind must be openai, codex, anthropic, or gemini")
	}
}

func model(req core.Request, fallback string) string {
	if req.Model != "" {
		return req.Model
	}
	return fallback
}
