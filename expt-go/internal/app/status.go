package app

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"time"
)

func (a *Application) StatusSummary() string {
	u, err := a.Session.CombinedUsage()
	cost := "cost unavailable"
	if err == nil {
		cost = fmt.Sprintf("$%.4f estimated", u.Cost)
	}
	ttl, err := a.loadCacheTTL()
	cache := "cache unknown"
	if err == nil {
		cache = a.cacheEstimate(ttl, time.Now())
	}
	return fmt.Sprintf("%s/%s · %s · %d jobs · %s · %s", a.Options.Provider, a.Options.Model, a.Options.Thinking, a.Runtime.Running(), cost, cache)
}

func (a *Application) CurrentModel() string {
	if !a.Engine.mu.TryLock() {
		return ""
	}
	defer a.Engine.mu.Unlock()
	return a.Options.Provider + "/" + a.Options.Model
}

// FooterStatus uses durable snapshots rather than reading mutable Engine state:
// it is also called from streaming callbacks while the engine lock is held.
type FooterStatus struct{ Project, Mode, Cost, Context, Cache, Provider string }

func (a *Application) FooterStatus() FooterStatus {
	f := FooterStatus{Project: filepath.Base(a.Session.CWD()), Mode: "normal", Cost: "$0.000", Context: "ctx 0%", Cache: "cache est ?"}
	kind, model := "", ""
	if v, ok := policyBaselines.Load(a); ok {
		b := v.(policyBaseline)
		kind, model = b.provider, b.model
	}
	if md := a.Session.Header().Metadata; md.Role != "" {
		f.Mode = md.Role
	}
	if u, e := a.Session.CombinedUsage(); e == nil {
		f.Cost = fmt.Sprintf("$%.3f", u.Cost)
	}
	entries, _ := a.Session.Branch()
	var tokens int64
	var observed int64
	for _, e := range entries {
		switch e.CustomType {
		case "model_change":
			var v map[string]string
			if json.Unmarshal(e.Data, &v) == nil {
				kind, model = v["provider"], v["model"]
				tokens = 0
			}
		case "die-main-agent-mode":
			var v map[string]string
			if json.Unmarshal(e.Data, &v) == nil && v["mode"] != "" {
				f.Mode = v["mode"]
			}
		case "provider_attempt":
			var v struct {
				Provider, Model string
				Failed          bool
				Usage           struct{ Input, Output, CacheRead, CacheWrite int64 }
			}
			if json.Unmarshal(e.Data, &v) == nil && !v.Failed {
				tokens = v.Usage.Input + v.Usage.Output + v.Usage.CacheRead + v.Usage.CacheWrite
			}
		case cacheCallEntry:
			var v cacheCallRecord
			if json.Unmarshal(e.Data, &v) == nil && v.Provider == kind && v.Model == model {
				observed = v.Timestamp
			}
		}
	}
	if kind != "" {
		f.Provider = kind + "/" + model
	}
	if window, err := configuredContextWindow(a.Options.StateDir, kind, model); err != nil {
		f.Context = "ctx ?"
	} else if window > 0 {
		f.Context = fmt.Sprintf("ctx %.0f%%", 100*float64(tokens)/float64(window))
	}
	if ttl, e := a.loadCacheTTL(); e == nil && observed > 0 {
		remaining := ttl - time.Since(time.UnixMilli(observed))
		if remaining < 0 {
			remaining = 0
		}
		f.Cache = "cache est " + remaining.Round(time.Second).String()
	}
	return f
}
