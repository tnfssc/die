package provider

import "godie/internal/core"

// ModelPricing is static USD pricing per one million tokens. Values are exposed
// only for exact provider/model matches present in the bundled Pi 0.85.0 model
// registry; unknown IDs deliberately have no inferred price.
type ModelPricing struct {
	Input, Output, CacheRead, CacheWrite float64
	InputTokensAbove                     int64
	Above                                *ModelPricing
}

var staticPricing = map[string]ModelPricing{
	"openai/gpt-4.1-mini":              {Input: .4, Output: 1.6, CacheRead: .1},
	"openai/gpt-5.4":                   {Input: 2.5, Output: 15, CacheRead: .25, InputTokensAbove: 272000, Above: &ModelPricing{Input: 5, Output: 22.5, CacheRead: .5}},
	"openai-codex/gpt-5.3-codex-spark": {Input: 1.75, Output: 14, CacheRead: .175},
	"openai-codex/gpt-5.4":             {Input: 2.5, Output: 15, CacheRead: .25, InputTokensAbove: 272000, Above: &ModelPricing{Input: 5, Output: 22.5, CacheRead: .5}},
	"openai-codex/gpt-5.4-mini":        {Input: .75, Output: 4.5, CacheRead: .075},
	"openai-codex/gpt-5.5":             {Input: 5, Output: 30, CacheRead: .5, InputTokensAbove: 272000, Above: &ModelPricing{Input: 10, Output: 45, CacheRead: 1}},
	"openai-codex/gpt-5.6-luna":        {Input: .2, Output: 1.2, CacheRead: .02, CacheWrite: .25, InputTokensAbove: 272000, Above: &ModelPricing{Input: .4, Output: 1.8, CacheRead: .04, CacheWrite: .5}},
	"openai-codex/gpt-5.6-sol":         {Input: 5, Output: 30, CacheRead: .5, CacheWrite: 6.25, InputTokensAbove: 272000, Above: &ModelPricing{Input: 10, Output: 45, CacheRead: 1, CacheWrite: 12.5}},
	"openai-codex/gpt-5.6-terra":       {Input: 2, Output: 12, CacheRead: .2, CacheWrite: 2.5, InputTokensAbove: 272000, Above: &ModelPricing{Input: 4, Output: 18, CacheRead: .4, CacheWrite: 5}},
	"anthropic/claude-sonnet-4-6":      {Input: 3, Output: 15, CacheRead: .3, CacheWrite: 3.75},
	"gemini/gemini-2.5-flash":          {Input: .3, Output: 2.5, CacheRead: .03},
}

func Pricing(providerID, model string) (ModelPricing, bool) {
	p, ok := staticPricing[providerID+"/"+model]
	if p.Above != nil {
		above := *p.Above
		p.Above = &above
	}
	return p, ok
}

// Usage.Input is uncached input across every adapter. CacheRead and CacheWrite
// are disjoint input components; add all three for context-window accounting.
func applyUsageCost(providerID, model string, usage *core.Usage) {
	p, ok := Pricing(providerID, model)
	if !ok {
		return
	}
	if usage.Input < 0 || usage.CacheRead < 0 || usage.CacheWrite < 0 {
		return
	}
	uncached := usage.Input
	totalInput := usage.Input + usage.CacheRead + usage.CacheWrite
	if p.Above != nil && totalInput > p.InputTokensAbove {
		p = *p.Above
	}
	usage.Cost = (float64(uncached)*p.Input + float64(usage.Output)*p.Output + float64(usage.CacheRead)*p.CacheRead + float64(usage.CacheWrite)*p.CacheWrite) / 1_000_000
}
