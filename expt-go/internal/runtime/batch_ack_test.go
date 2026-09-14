package runtime

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestBatchForegroundCrashRestoresEveryOwner(t *testing.T) {
	r := testRuntime(t)
	r.cfg.Helper = func(ctx context.Context, method string, args json.RawMessage) (any, error) {
		out := []any{}
		for i := 0; i < 2; i++ {
			v, err := r.LaunchForeground(ctx, []string{"/bin/sh", "-c", "printf done"}, LaunchOptions{Kind: "command", CloseInput: true}, time.Second)
			if err != nil {
				return out, err
			}
			out = append(out, v)
		}
		return out, nil
	}
	res, err := r.Execute(context.Background(), "await subagent({prompts:['a','b']}); throw new Error('after ack');", 3*time.Second)
	if err != nil || res.ExitCode == 0 {
		t.Fatalf("%+v %v", res, err)
	}
	if len(r.order) != 2 {
		t.Fatalf("helper launch failed: %+v", res)
	}
	found := map[string]bool{}
	deadline := time.After(time.Second)
	for len(found) < 2 {
		select {
		case ev := <-r.Events():
			if ev.Type == "completed" {
				found[ev.Job.ID] = true
			}
		case <-deadline:
			t.Fatalf("restored %d instead of 2", len(found))
		}
	}
}
func TestForegroundOwnersNested(t *testing.T) {
	ids := foregroundOwners(map[string]any{"results": []any{Inspection{Job: Job{ID: "a", Status: "completed"}}, Inspection{Job: Job{ID: "b", Status: "running"}, Background: true}}})
	if len(ids) != 1 || ids[0] != "a" {
		t.Fatal(ids)
	}
}
