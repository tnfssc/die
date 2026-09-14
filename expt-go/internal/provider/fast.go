package provider

import (
	"context"
	"errors"
	"strings"

	"godie/internal/core"
)

const (
	officialOpenAIBase = "https://api.openai.com/v1"
	officialCodexBase  = "https://chatgpt.com/backend-api"
)

var openAIFastModels = map[string]struct{}{
	"gpt-6-astra": {}, "gpt-5.6-sol": {}, "gpt-5.3-codex": {},
}
var codexFastModels = map[string]struct{}{
	"gpt-6-astra": {}, "gpt-5.6-sol": {}, "gpt-5.6-terra": {},
	"gpt-5.6-luna": {}, "gpt-5.5": {}, "gpt-5.4": {},
}

type fastAuthorization struct {
	requested  bool
	providerID string
	model      string
	tier       string
}

// captureFastAuthorization snapshots the app-authorized Fast bit and resolved
// identity at Complete entry. Nothing later re-reads mutable app/session state.
func captureFastAuthorization(req core.Request, cfg Config, providerID string) (fastAuthorization, error) {
	auth := fastAuthorization{requested: req.Fast, providerID: providerID, model: model(req, cfg.Model)}
	if !req.Fast {
		return auth, nil
	}
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	var allowed map[string]struct{}
	switch providerID {
	case "openai":
		if base != officialOpenAIBase {
			return auth, errors.New("provider: fast requires the official OpenAI Responses endpoint")
		}
		allowed, auth.tier = openAIFastModels, "fast"
	case "openai-codex":
		if base != officialCodexBase {
			return auth, errors.New("provider: fast requires the official Codex endpoint")
		}
		allowed, auth.tier = codexFastModels, "priority"
	default:
		return auth, errors.New("provider: fast/premium service tier is unsupported")
	}
	if _, ok := allowed[auth.model]; !ok {
		return auth, errors.New("provider: fast is unsupported for this exact model alias")
	}
	return auth, nil
}

// guardResponsesPayload applies the captured tier to the completed serializer
// output, then verifies exact model/tier identity immediately before dispatch.
func guardResponsesPayload(body map[string]any, auth fastAuthorization, standard bool) error {
	if body == nil || body["model"] != auth.model {
		return errors.New("provider: guarded Responses payload model mismatch")
	}
	if standard {
		if auth.requested {
			return errors.New("provider: fast cannot be used for compaction")
		}
		body["service_tier"] = "default"
		if body["service_tier"] != "default" {
			return errors.New("provider: guarded Responses payload tier mismatch")
		}
		return nil
	}
	if !auth.requested {
		return nil
	}
	body["service_tier"] = auth.tier
	if body["model"] != auth.model || body["service_tier"] != auth.tier {
		return errors.New("provider: guarded Responses payload identity mismatch")
	}
	return nil
}

type standardTierKey struct{}

func withStandardTier(ctx context.Context) context.Context {
	return context.WithValue(ctx, standardTierKey{}, true)
}
func standardTierRequested(ctx context.Context) bool {
	standard, _ := ctx.Value(standardTierKey{}).(bool)
	return standard
}
