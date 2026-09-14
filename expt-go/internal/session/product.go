package session

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"godie/internal/core"
)

// NewHelper routes the durable history.* and goal.* helper namespaces.
func NewHelper(s *Session) core.Helper {
	history := NewHistory(s)
	goals := NewGoals(s)
	return func(ctx context.Context, method string, args json.RawMessage) (any, error) {
		switch {
		case strings.HasPrefix(method, "history."):
			return history.Handle(ctx, method, args)
		case strings.HasPrefix(method, "goal."):
			return goals.Handle(ctx, method, args)
		default:
			return nil, fmt.Errorf("unknown product helper method: %s", method)
		}
	}
}
