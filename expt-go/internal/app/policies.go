package app

// Policy integration is deliberately kept above the provider boundary.  Fast
// state can be selected and restored here, but providers remain fail-closed
// until they implement a guarded, request-local service-tier mapping.

import (
	"encoding/json"
	"errors"
	"fmt"
	"godie/internal/session"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	nativeFastEntry       = "die-native-fast-mode"
	cacheCallEntry        = "die-cache-call"
	cacheSettingsFile     = "cache-settings.json"
	defaultCacheTTL       = time.Hour
	minCacheTTL           = time.Minute
	maxCacheTTL           = 7 * 24 * time.Hour
	maxPolicyIdentity     = 256
	maxCacheSettingsBytes = 4096
)

type nativeFastRecord struct {
	Version          int    `json:"version"`
	SessionID        string `json:"sessionId"`
	Provider         string `json:"provider"`
	Model            string `json:"model"`
	Enabled          bool   `json:"enabled"`
	CostAcknowledged bool   `json:"costAcknowledged"`
	Timestamp        int64  `json:"timestamp"`
}

type cacheCallRecord struct {
	Timestamp int64  `json:"timestamp"`
	Provider  string `json:"provider"`
	Model     string `json:"model"`
}

type cacheSettings struct {
	CacheTTLMS int64 `json:"cacheTtlMs"`
}

type policyBaseline struct{ provider, model, thinking string }

var policyBaselines sync.Map // map[*Application]policyBaseline

func (a *Application) policyBaseline() policyBaseline {
	created := policyBaseline{provider: a.Options.Provider, model: a.Options.Model, thinking: a.Options.Thinking}
	value, loaded := policyBaselines.LoadOrStore(a, created)
	if !loaded {
		cleanup := a.cleanup
		a.cleanup = func() { policyBaselines.Delete(a); cleanup() }
	}
	return value.(policyBaseline)
}

var cacheTTLPattern = regexp.MustCompile(`^(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs|d|day|days)?$`)

func boundedPolicyID(v string) bool { return v != "" && len(v) <= maxPolicyIdentity }

func officialFastSurface(kind, baseURL string) bool {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	switch strings.ToLower(kind) {
	case "openai":
		return baseURL == "" || baseURL == "https://api.openai.com/v1"
	case "codex", "openai-codex":
		return baseURL == "" || baseURL == "https://chatgpt.com/backend-api"
	default:
		return false
	}
}

func supportedFastModel(kind, model string) bool {
	var allowed map[string]bool
	switch strings.ToLower(kind) {
	case "openai":
		allowed = map[string]bool{"gpt-6-astra": true, "gpt-5.6-sol": true, "gpt-5.3-codex": true}
	case "codex", "openai-codex":
		allowed = map[string]bool{"gpt-6-astra": true, "gpt-5.6-sol": true, "gpt-5.6-terra": true, "gpt-5.6-luna": true, "gpt-5.5": true, "gpt-5.4": true}
	default:
		return false
	}
	return allowed[model]
}

func validFastRecord(r nativeFastRecord) bool {
	return r.Version == 1 && boundedPolicyID(r.SessionID) && boundedPolicyID(r.Provider) && boundedPolicyID(r.Model) && r.Timestamp >= 0 && r.CostAcknowledged == r.Enabled
}

// fastSetting resolves only the active branch.  A malformed newest record for
// the current identity is an error rather than permission to use an older opt-in.
func (a *Application) fastSetting() (*nativeFastRecord, error) {
	entries, err := a.Session.Branch()
	if err != nil {
		return nil, err
	}
	for i := len(entries) - 1; i >= 0; i-- {
		e := entries[i]
		if e.Type != "custom" || e.CustomType != nativeFastEntry {
			continue
		}
		var identity struct{ SessionID, Provider, Model string }
		if json.Unmarshal(e.Data, &identity) != nil || !boundedPolicyID(identity.SessionID) || !boundedPolicyID(identity.Provider) || !boundedPolicyID(identity.Model) {
			return nil, errors.New("invalid native fast policy record")
		}
		if identity.SessionID != a.Session.ID() || identity.Provider != a.Options.Provider || identity.Model != a.Options.Model {
			continue
		}
		var r nativeFastRecord
		if json.Unmarshal(e.Data, &r) != nil || !validFastRecord(r) {
			return nil, errors.New("invalid native fast policy record for current model")
		}
		return &r, nil
	}
	return nil, nil
}

// fastCommand shows or changes model-bound fast policy. It never calls a
// provider. In print/RPC/child modes, enabling premium policy requires the
// literal --accept-cost token; an interactive coordinator may obtain consent.
func (a *Application) fastCommand(args string) (string, error) {
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(args)))
	action := "status"
	accepted := false
	actionSeen := false
	for _, f := range fields {
		switch f {
		case "status", "on", "off":
			if actionSeen {
				return "", errors.New("usage: /fast on|off|status [--accept-cost]")
			}
			action, actionSeen = f, true
		case "--accept-cost":
			if accepted {
				return "", errors.New("usage: /fast on|off|status [--accept-cost]")
			}
			accepted = true
		default:
			return "", errors.New("usage: /fast on|off|status [--accept-cost]")
		}
	}
	if action == "status" {
		r, err := a.fastSetting()
		if err != nil {
			return "", err
		}
		if r == nil {
			return "Native fast mode: off (no model-bound setting; standard tier).", nil
		}
		if r.Enabled {
			return "Native fast mode: requested (tier/cost evidence unavailable).", nil
		}
		return "Native fast mode: off (explicit default/standard tier).", nil
	}
	if !officialFastSurface(a.Options.Provider, a.Options.BaseURL) {
		return "", errors.New("native fast mode is limited to official OpenAI API and Codex provider surfaces")
	}
	if action == "on" {
		if !supportedFastModel(a.Options.Provider, a.Options.Model) {
			return "", fmt.Errorf("native fast mode is not allowlisted for %s/%s", a.Options.Provider, a.Options.Model)
		}
		nonTTY := a.Options.Print || a.Options.InternalAgent || a.Options.Mode != "text"
		if nonTTY && !accepted {
			return "", errors.New("premium fast mode was not enabled; pass --accept-cost in non-TTY mode")
		}
	}
	r := nativeFastRecord{Version: 1, SessionID: a.Session.ID(), Provider: a.Options.Provider, Model: a.Options.Model, Enabled: action == "on", CostAcknowledged: action == "on", Timestamp: time.Now().UnixMilli()}
	if _, err := a.Session.AppendCustom(nativeFastEntry, r); err != nil {
		return "", err
	}
	a.Engine.Request.Fast = r.Enabled
	if r.Enabled {
		return "Native fast mode requested for this branch and model; provider tier evidence is unavailable.", nil
	}
	return "Native fast mode off for this branch and model; default/standard tier selected.", nil
}

func parseCacheTTL(input string) (time.Duration, error) {
	m := cacheTTLPattern.FindStringSubmatch(strings.ToLower(strings.TrimSpace(input)))
	if m == nil {
		return 0, errors.New("use a duration such as 30m, 1h, or 1d")
	}
	amount, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return 0, err
	}
	multiplier := float64(time.Minute)
	if strings.HasPrefix(m[2], "h") {
		multiplier = float64(time.Hour)
	} else if strings.HasPrefix(m[2], "d") {
		multiplier = float64(24 * time.Hour)
	}
	ns := amount * multiplier
	if math.IsNaN(ns) || math.IsInf(ns, 0) || ns != math.Trunc(ns) || ns < float64(minCacheTTL) || ns > float64(maxCacheTTL) {
		return 0, errors.New("TTL must be an exact duration between 1 minute and 7 days")
	}
	return time.Duration(ns), nil
}
func formatCacheTTL(d time.Duration) string {
	if d%(24*time.Hour) == 0 {
		return fmt.Sprintf("%dd", d/(24*time.Hour))
	}
	if d%time.Hour == 0 {
		return fmt.Sprintf("%dh", d/time.Hour)
	}
	return strconv.FormatFloat(float64(d)/float64(time.Minute), 'f', -1, 64) + "m"
}
func (a *Application) cacheSettingsPath() string {
	return filepath.Join(a.Options.StateDir, cacheSettingsFile)
}
func (a *Application) loadCacheTTL() (time.Duration, error) {
	f, err := os.Open(a.cacheSettingsPath())
	if errors.Is(err, os.ErrNotExist) {
		return defaultCacheTTL, nil
	}
	if err != nil {
		return 0, err
	}
	defer f.Close()
	b, err := ioReadBounded(f, maxCacheSettingsBytes)
	if err != nil {
		return 0, fmt.Errorf("invalid cache settings (left unchanged): %w", err)
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(b, &raw) != nil {
		return 0, errors.New("invalid cache settings (left unchanged): malformed JSON")
	}
	if len(raw) != 1 || raw["cacheTtlMs"] == nil {
		return 0, errors.New("invalid cache settings (left unchanged): expected only cacheTtlMs")
	}
	var ms int64
	if json.Unmarshal(raw["cacheTtlMs"], &ms) != nil {
		return 0, errors.New("invalid cache settings (left unchanged): cacheTtlMs must be an integer")
	}
	d := time.Duration(ms) * time.Millisecond
	if d < minCacheTTL || d > maxCacheTTL {
		return 0, errors.New("invalid cache settings (left unchanged): cacheTtlMs out of range")
	}
	return d, nil
}
func ioReadBounded(f *os.File, n int64) ([]byte, error) {
	st, e := f.Stat()
	if e != nil {
		return nil, e
	}
	if !st.Mode().IsRegular() || st.Size() > n {
		return nil, errors.New("file is not a bounded regular file")
	}
	b := make([]byte, st.Size())
	_, e = f.ReadAt(b, 0)
	return b, e
}
func (a *Application) saveCacheTTL(d time.Duration) error {
	if d < minCacheTTL || d > maxCacheTTL || d%time.Millisecond != 0 {
		return errors.New("invalid cache TTL")
	}
	if err := os.MkdirAll(a.Options.StateDir, 0700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(cacheSettings{CacheTTLMS: d.Milliseconds()}, "", "  ")
	b = append(b, '\n')
	tmp, err := os.CreateTemp(a.Options.StateDir, ".cache-settings-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err = tmp.Chmod(0600); err == nil {
		_, err = tmp.Write(b)
	}
	if err == nil {
		err = tmp.Sync()
	}
	if e := tmp.Close(); err == nil {
		err = e
	}
	if err == nil {
		err = os.Rename(name, a.cacheSettingsPath())
	}
	return err
}

func validCacheCall(r cacheCallRecord) bool {
	return r.Timestamp > 0 && boundedPolicyID(r.Provider) && boundedPolicyID(r.Model)
}
func (a *Application) cacheEstimate(ttl time.Duration, now time.Time) string {
	entries, err := a.Session.Branch()
	if err != nil {
		return "cache est ?"
	}
	var latest int64
	for _, e := range entries {
		if e.Type != "custom" {
			continue
		}
		if e.CustomType == "die-manual-shake" {
			latest = 0
			continue
		}
		if e.CustomType != cacheCallEntry {
			continue
		}
		var r cacheCallRecord
		if json.Unmarshal(e.Data, &r) == nil && validCacheCall(r) && r.Provider == a.Options.Provider && r.Model == a.Options.Model && r.Timestamp > latest {
			latest = r.Timestamp
		}
	}
	if latest == 0 {
		return "cache est ?"
	}
	left := time.UnixMilli(latest).Add(ttl).Sub(now)
	if left <= 0 {
		return "cache est expired"
	}
	minutes := int64(math.Ceil(left.Minutes()))
	return fmt.Sprintf("cache est ~%dm", minutes)
}

func (a *Application) cacheCommand(args string) (string, error) {
	value := strings.TrimSpace(args)
	if value == "" {
		ttl, err := a.loadCacheTTL()
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("Cache TTL estimate: %s; %s. Informational only; no cache creation or hit is inferred.", formatCacheTTL(ttl), a.cacheEstimate(ttl, time.Now())), nil
	}
	ttl, err := parseCacheTTL(value)
	if err != nil {
		return "", err
	}
	if err = a.saveCacheTTL(ttl); err != nil {
		return "", err
	}
	return fmt.Sprintf("Cache TTL estimate set to %s. This does not guarantee provider cache retention or hits.", formatCacheTTL(ttl)), nil
}

// observeProviderAttempt records an attempt only after the coordinator has
// conservatively observed an HTTP response (or unavoidable direct dispatch).
// It performs no inference and is intentionally separate from provider calls.
func (a *Application) observeProviderAttempt(providerName, model string, observed time.Time) error {
	if !boundedPolicyID(providerName) || !boundedPolicyID(model) || observed.UnixMilli() <= 0 {
		return errors.New("invalid provider attempt observation")
	}
	_, err := a.Session.AppendCustom(cacheCallEntry, cacheCallRecord{Timestamp: observed.UnixMilli(), Provider: providerName, Model: model})
	return err
}

func decodeStringRecord(e session.Entry, kind string) (map[string]string, bool) {
	if e.Type != "custom" || e.CustomType != kind {
		return nil, false
	}
	var v map[string]string
	if json.Unmarshal(e.Data, &v) != nil {
		return nil, false
	}
	return v, true
}

// restorePolicyState projects the active branch into runtime state. It is safe
// to call after Resume. Child identity comes from the immutable session header;
// root mode records are never allowed to replace it.
func (a *Application) restorePolicyState() error {
	entries, err := a.Session.Branch()
	if err != nil {
		return err
	}
	base := a.policyBaseline()
	kind, model, thinking := base.provider, base.model, base.thinking
	if md := a.Session.Header().Metadata; md.Depth > 0 && md.Model != "" {
		if p, m, ok := strings.Cut(md.Model, "/"); ok {
			kind, model = p, m
		} else {
			model = md.Model
		}
	}
	rootMode := "normal"
	for _, e := range entries {
		if v, ok := decodeStringRecord(e, "model_change"); ok && boundedPolicyID(v["provider"]) && boundedPolicyID(v["model"]) {
			kind, model = v["provider"], v["model"]
		}
		if v, ok := decodeStringRecord(e, "thinking_level_change"); ok && strings.Contains("|off|minimal|low|medium|high|xhigh|max|", "|"+v["thinkingLevel"]+"|") {
			thinking = v["thinkingLevel"]
		}
		if a.Options.Depth == 0 {
			if v, ok := decodeStringRecord(e, "die-main-agent-mode"); ok && (v["mode"] == "fast" || v["mode"] == "normal" || v["mode"] == "orchestrator") {
				rootMode = v["mode"]
			}
		}
	}
	p := a.Engine.Provider
	identityChanged := kind != a.Options.Provider || model != a.Options.Model
	if p == nil || identityChanged {
		p = offlineProvider{}
		if !a.Options.Offline && a.Options.Execute == "" {
			resolved := a.Options
			resolved.Provider, resolved.Model = kind, model
			if err = configureProviderOptions(&resolved); err != nil {
				return err
			}
			thinking = resolved.Thinking
			p, err = newApplicationProvider(resolved)
			if err != nil {
				return err
			}
		}
	}
	system := a.Engine.Request.System
	if a.Options.Depth == 0 {
		system, err = SystemPrompt(a.Options.CWD, a.Options.StateDir, a.Options.System, a.Options.AppendSystem, "", 0, PromptOptions{NoContextFiles: a.Options.NoContextFiles, IgnoreProject: a.Options.IgnoreProject})
		if err != nil {
			return err
		}
		if rootMode == "orchestrator" {
			system += "\n\n" + prompt("main-orchestrator")
		}
	}
	a.Options.Provider, a.Options.Model, a.Options.Thinking = kind, model, thinking
	a.Engine.Provider = p
	a.Engine.Request.Model = model
	a.Engine.Request.Provider = kind
	a.Engine.Request.Thinking = thinking
	a.Engine.Request.System = system
	a.Engine.Request.Fast = false
	setting, err := a.fastSetting()
	if err != nil {
		return err
	}
	if setting != nil && setting.Enabled {
		if !officialFastSurface(kind, a.Options.BaseURL) || !supportedFastModel(kind, model) {
			return errors.New("persisted native fast policy is no longer supported for restored model")
		}
		a.Engine.Request.Fast = true
	}
	return nil
}
