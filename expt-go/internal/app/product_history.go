package app

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

// ProductHistoryCommand gives the advertised /history surface both search and
// ref-based read operations instead of exposing only a fixed first search page.
func (a *Application) ProductHistoryCommand(ctx context.Context, args string) (string, error) {
	fields := strings.Fields(strings.TrimSpace(args))
	if len(fields) == 0 {
		return "", errors.New("usage: /history search <query> | read <ref> [maxChars]")
	}
	command := fields[0]
	var method string
	params := map[string]any{}
	switch command {
	case "search":
		query := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(args), command))
		if query == "" {
			return "", errors.New("history query is required")
		}
		method = "history.search"
		params["query"] = query
	case "read":
		if len(fields) < 2 || len(fields) > 3 {
			return "", errors.New("usage: /history read <ref> [maxChars]")
		}
		method = "history.read"
		params["ref"] = fields[1]
		if len(fields) == 3 {
			n, err := strconv.Atoi(fields[2])
			if err != nil {
				return "", errors.New("maxChars must be an integer")
			}
			params["maxChars"] = n
		}
	default:
		// Preserve the previous convenient shorthand: /history <query>.
		method = "history.search"
		params["query"] = strings.TrimSpace(args)
	}
	v, err := a.History.Handle(ctx, method, mustJSON(params))
	if err != nil {
		return "", err
	}
	b, _ := json.MarshalIndent(v, "", "  ")
	return string(b), nil
}
