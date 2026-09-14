package app

import (
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed catalog/*.json
var catalog embed.FS

type ModelInfo struct {
	ID               string             `json:"id"`
	Name             string             `json:"name"`
	Provider         string             `json:"provider"`
	API              string             `json:"api"`
	BaseURL          string             `json:"baseUrl,omitempty"`
	ContextWindow    int                `json:"contextWindow"`
	MaxTokens        int                `json:"maxTokens"`
	Reasoning        bool               `json:"reasoning"`
	ThinkingLevelMap map[string]*string `json:"thinkingLevelMap,omitempty"`
	Headers          map[string]string  `json:"-"`
}

type modelDefinition struct {
	ID               string             `json:"id"`
	Name             string             `json:"name"`
	API              string             `json:"api"`
	BaseURL          string             `json:"baseUrl"`
	ContextWindow    *int               `json:"contextWindow"`
	MaxTokens        *int               `json:"maxTokens"`
	Reasoning        *bool              `json:"reasoning"`
	ThinkingLevelMap map[string]*string `json:"thinkingLevelMap"`
	Headers          map[string]string  `json:"headers"`
}

type modelOverride struct {
	Name             *string            `json:"name"`
	ContextWindow    *int               `json:"contextWindow"`
	MaxTokens        *int               `json:"maxTokens"`
	Reasoning        *bool              `json:"reasoning"`
	ThinkingLevelMap map[string]*string `json:"thinkingLevelMap"`
	Headers          map[string]string  `json:"headers"`
}

func defaultProviderBaseURL(provider string) string {
	switch provider {
	case "openai":
		return "https://api.openai.com/v1"
	case "openai-codex":
		return "https://chatgpt.com/backend-api"
	case "anthropic":
		return "https://api.anthropic.com"
	case "google":
		return "https://generativelanguage.googleapis.com/v1beta"
	default:
		return ""
	}
}

func Models() []ModelInfo {
	files, _ := catalog.ReadDir("catalog")
	out := []ModelInfo{}
	seen := map[string]bool{}
	for _, f := range files {
		b, _ := catalog.ReadFile("catalog/" + f.Name())
		var groups map[string]map[string]ModelInfo
		if json.Unmarshal(b, &groups) != nil {
			continue
		}
		for _, items := range groups {
			for _, m := range items {
				k := m.Provider + "/" + m.ID
				if m.ID == "" || seen[k] {
					continue
				}
				seen[k] = true
				if m.BaseURL == "" {
					m.BaseURL = defaultProviderBaseURL(m.Provider)
				}
				out = append(out, m)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Provider+"/"+out[i].ID < out[j].Provider+"/"+out[j].ID })
	return out
}

// ModelProviderConfig is a credential-blind models.json provider snapshot.
// Values are resolved only for the selected request; loading/listing never reads env.
type ModelProviderConfig struct {
	Name           string                   `json:"name"`
	BaseURL        string                   `json:"baseUrl"`
	API            string                   `json:"api"`
	APIKey         string                   `json:"apiKey"`
	Headers        map[string]string        `json:"headers"`
	Models         []ModelInfo              `json:"-"`
	Definitions    []modelDefinition        `json:"models"`
	ModelOverrides map[string]modelOverride `json:"modelOverrides"`
}

type modelsFile struct {
	Providers map[string]ModelProviderConfig `json:"providers"`
}

func validateConfiguredHeaders(headers map[string]string) error {
	seen := map[string]bool{}
	for k, v := range headers {
		fold := strings.ToLower(k)
		if strings.TrimSpace(k) == "" || seen[fold] || strings.ContainsAny(k+v, "\r\n") {
			return fmt.Errorf("invalid or duplicate header")
		}
		seen[fold] = true
	}
	return nil
}

func cloneHeaders(src map[string]string) map[string]string {
	if len(src) == 0 {
		return nil
	}
	out := make(map[string]string, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}
func mergeModelHeaders(parts ...map[string]string) map[string]string {
	var out map[string]string
	for _, part := range parts {
		for k, v := range part {
			if out == nil {
				out = map[string]string{}
			}
			for old := range out {
				if strings.EqualFold(old, k) {
					delete(out, old)
				}
			}
			out[k] = v
		}
	}
	return out
}
func mergeThinking(base, override map[string]*string) map[string]*string {
	if len(base) == 0 && len(override) == 0 {
		return nil
	}
	out := map[string]*string{}
	for k, v := range base {
		out[k] = v
	}
	for k, v := range override {
		out[k] = v
	}
	return out
}
func applyOverride(m ModelInfo, o modelOverride) ModelInfo {
	if o.Name != nil {
		m.Name = *o.Name
	}
	if o.ContextWindow != nil {
		m.ContextWindow = *o.ContextWindow
	}
	if o.MaxTokens != nil {
		m.MaxTokens = *o.MaxTokens
	}
	if o.Reasoning != nil {
		m.Reasoning = *o.Reasoning
	}
	m.ThinkingLevelMap = mergeThinking(m.ThinkingLevelMap, o.ThinkingLevelMap)
	m.Headers = mergeModelHeaders(o.Headers, m.Headers)
	return m
}
func modelFromDefinition(provider string, d modelDefinition, cfg ModelProviderConfig, existing *ModelInfo) (ModelInfo, error) {
	api := strings.ToLower(strings.TrimSpace(d.API))
	if api == "" {
		api = cfg.API
	}
	if api == "" && existing != nil {
		api = existing.API
	}
	base := strings.TrimSpace(d.BaseURL)
	if base == "" {
		base = cfg.BaseURL
	}
	if base == "" && existing != nil {
		base = existing.BaseURL
	}
	if api == "" {
		return ModelInfo{}, fmt.Errorf("models config: provider %s model %s has no api", provider, d.ID)
	}
	if base == "" {
		return ModelInfo{}, fmt.Errorf("models config: provider %s model %s has no baseUrl", provider, d.ID)
	}
	m := ModelInfo{ID: d.ID, Name: d.ID, Provider: provider, API: api, BaseURL: base, ContextWindow: 128000, MaxTokens: 16384, Headers: cloneHeaders(d.Headers), ThinkingLevelMap: mergeThinking(nil, d.ThinkingLevelMap)}
	if d.Name != "" {
		m.Name = d.Name
	}
	if d.ContextWindow != nil {
		m.ContextWindow = *d.ContextWindow
	}
	if d.MaxTokens != nil {
		m.MaxTokens = *d.MaxTokens
	}
	if d.Reasoning != nil {
		m.Reasoning = *d.Reasoning
	}
	if m.ContextWindow <= 0 || m.MaxTokens <= 0 {
		return ModelInfo{}, fmt.Errorf("models config: provider %s model %s has invalid token limits", provider, d.ID)
	}
	return m, nil
}

// LoadModelProviders reads one immutable literal-value models.json snapshot.
func LoadModelProviders(stateDir string) (map[string]ModelProviderConfig, error) {
	paths := []string{filepath.Join(stateDir, "models.json"), filepath.Join(stateDir, "agent", "models.json")}
	path := ""
	for _, candidate := range paths {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			path = candidate
			break
		} else if err != nil && !os.IsNotExist(err) {
			return nil, fmt.Errorf("models config: %w", err)
		}
	}
	if path == "" {
		return map[string]ModelProviderConfig{}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("models config: %w", err)
	}
	var file modelsFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("models config %s: %w", path, err)
	}
	if file.Providers == nil {
		return nil, fmt.Errorf("models config %s: providers object is required", path)
	}
	out := make(map[string]ModelProviderConfig, len(file.Providers))
	builtins := Models()
	for rawName, cfg := range file.Providers {
		name := strings.TrimSpace(rawName)
		if name == "" {
			return nil, fmt.Errorf("models config %s: provider name is empty", path)
		}
		cfg.API = strings.ToLower(strings.TrimSpace(cfg.API))
		cfg.BaseURL = strings.TrimSpace(cfg.BaseURL)
		if err := validateConfiguredHeaders(cfg.Headers); err != nil {
			return nil, fmt.Errorf("models config %s: provider %s headers: %w", path, name, err)
		}
		for id, override := range cfg.ModelOverrides {
			if err := validateConfiguredHeaders(override.Headers); err != nil {
				return nil, fmt.Errorf("models config %s: provider %s model override %s headers: %w", path, name, id, err)
			}
		}
		seen := map[string]bool{}
		merged := make([]ModelInfo, 0)
		for _, m := range builtins {
			if m.Provider == name {
				if cfg.BaseURL != "" {
					m.BaseURL = cfg.BaseURL
				}
				m.Headers = cloneHeaders(m.Headers)
				merged = append(merged, m)
			}
		}
		for _, d := range cfg.Definitions {
			d.ID = strings.TrimSpace(d.ID)
			if err := validateConfiguredHeaders(d.Headers); err != nil {
				return nil, fmt.Errorf("models config %s: provider %s model %s headers: %w", path, name, d.ID, err)
			}
			if d.ID == "" || seen[d.ID] {
				return nil, fmt.Errorf("models config %s: provider %s has an empty or duplicate model", path, name)
			}
			seen[d.ID] = true
			idx := -1
			for i := range merged {
				if merged[i].ID == d.ID {
					idx = i
					break
				}
			}
			var existing *ModelInfo
			if idx >= 0 {
				existing = &merged[idx]
			}
			m, e := modelFromDefinition(name, d, cfg, existing)
			if e != nil {
				return nil, e
			}
			if idx >= 0 {
				merged[idx] = m
			} else {
				merged = append(merged, m)
			}
		}
		for i := range merged {
			if o, ok := cfg.ModelOverrides[merged[i].ID]; ok {
				merged[i] = applyOverride(merged[i], o)
			}
			if merged[i].ContextWindow < 0 || merged[i].MaxTokens < 0 {
				return nil, fmt.Errorf("models config: provider %s model %s has invalid token limits", name, merged[i].ID)
			}
		}
		cfg.Models = merged
		out[name] = cfg
	}
	return out, nil
}

// ModelsForState merges configured additions with the embedded registry without
// consulting credentials. Configured models replace equal provider/id entries.
func ModelsForState(stateDir string) ([]ModelInfo, error) {
	providers, err := LoadModelProviders(stateDir)
	if err != nil {
		return nil, err
	}
	all := map[string]ModelInfo{}
	for _, m := range Models() {
		all[m.Provider+"/"+m.ID] = m
	}
	for _, p := range providers {
		for _, m := range p.Models {
			all[m.Provider+"/"+m.ID] = m
		}
	}
	out := make([]ModelInfo, 0, len(all))
	for _, m := range all {
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Provider+"/"+out[i].ID < out[j].Provider+"/"+out[j].ID })
	return out, nil
}
