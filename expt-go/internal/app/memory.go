package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"godie/internal/memory"
	run "godie/internal/runtime"
	"path/filepath"
	"strings"
	"time"
)

const memoryInspectInterval = 250 * time.Millisecond

// memoryCommand implements the explicit, root-owned project-memory workflow.
// It waits for the one child it launched by inspecting that job directly; it
// deliberately does not consume Runtime.Events, which belongs to the
// application supervisor.
func (a *Application) memoryCommand(ctx context.Context, args string) (string, error) {
	if !memoryRoot(a) {
		return "", memory.ErrRootOnly
	}

	root, err := filepath.Abs(a.Options.CWD)
	if err != nil {
		return "", fmt.Errorf("memory: resolve project root: %w", err)
	}
	store, err := memory.New(root, nil)
	if err != nil {
		return "", err
	}

	verb, profile, constraints, err := parseMemoryCommand(args)
	if err != nil {
		return "", err
	}
	if verb == "status" {
		pending, snapshotErr := store.SnapshotPending()
		if snapshotErr != nil {
			return "", snapshotErr
		}
		if len(pending) == 0 {
			return "No pending project memory notes.", nil
		}
		return fmt.Sprintf("%d pending project memory note(s).", len(pending)), nil
	}

	// Capture all application identity used to prepare the snapshot. The same
	// identity must still own the application when consumption markers publish.
	session := a.Session
	runtime := a.Runtime
	sessionID := session.ID()
	sessionFile := session.File()
	metadata := session.Header().Metadata
	owned := func() bool {
		if a.Session != session || a.Runtime != runtime || !memoryRoot(a) {
			return false
		}
		if a.Session.ID() != sessionID || a.Session.File() != sessionFile {
			return false
		}
		currentRoot, e := filepath.Abs(a.Options.CWD)
		if e != nil || filepath.Clean(currentRoot) != filepath.Clean(root) {
			return false
		}
		current := a.Session.Header().Metadata
		return current.Depth == metadata.Depth &&
			current.Role == metadata.Role &&
			current.ParentSessionID == metadata.ParentSessionID &&
			current.ParentSessionFile == metadata.ParentSessionFile &&
			current.RootSessionID == metadata.RootSessionID
	}

	prep, err := store.Prepare(memory.PrepareRequest{
		Root:        owned(),
		Profile:     profile,
		Constraints: constraints,
	})
	if err != nil {
		if errors.Is(err, memory.ErrNoPending) {
			return "No pending project memory notes; no worker launched.", nil
		}
		return "", err
	}

	raw, err := json.Marshal(map[string]any{
		"type":        prep.Profile,
		"prompt":      prep.Prompt,
		"waitSeconds": 3,
	})
	if err != nil {
		return "", err
	}
	launched, err := a.subagent(ctx, raw)
	if err != nil {
		// No job was returned to own. Commit a failed completion only to apply
		// the package's receipt cleanup and retention path.
		_, _ = store.Commit(prep, memory.Completion{Root: owned(), StillValid: owned})
		return "", fmt.Errorf("memory: launch consolidation worker: %w", err)
	}
	inspection, err := memoryInspection(launched)
	if err != nil {
		return "", err
	}

	terminal, err := waitMemoryJob(ctx, runtime, inspection)
	if err != nil {
		// A cancelled command must not commit while its child can still write.
		// Stop only the job this invocation owns and give the runtime's normal
		// TERM/KILL lifecycle a bounded period to reach a terminal state.
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			if stopped, stopErr := stopMemoryJob(runtime, terminal.ID); stopErr == nil {
				_, _ = store.Commit(prep, memory.Completion{
					Root:       owned(),
					Completed:  stopped.Status == "completed",
					ExitCode:   stopped.ExitCode,
					StillValid: owned,
				})
			}
		}
		return "", err
	}

	result, err := store.Commit(prep, memory.Completion{
		Root:       memoryRoot(a),
		Completed:  terminal.Status == "completed",
		ExitCode:   terminal.ExitCode,
		StillValid: owned,
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Consolidated project memory; %d pending note(s) consumed.", len(result.Consumed)), nil
}

func memoryRoot(a *Application) bool {
	return a != nil && a.Session != nil && a.Runtime != nil &&
		a.Options.Depth == 0 && a.Session.Header().Metadata.Depth == 0
}

func parseMemoryCommand(args string) (verb, profile, constraints string, err error) {
	args = strings.TrimSpace(args)
	if args == "" || args == "status" {
		return "status", "", "", nil
	}
	const prefix = "consolidate "
	if !strings.HasPrefix(args, prefix) {
		return "", "", "", errors.New("usage: /memory status | /memory consolidate fast|normal --constraints TEXT")
	}
	rest := strings.TrimSpace(strings.TrimPrefix(args, prefix))
	profile, rest, _ = strings.Cut(rest, " ")
	rest = strings.TrimSpace(rest)
	if profile != "fast" && profile != "normal" {
		return "", "", "", memory.ErrInvalidProfile
	}
	const constraintFlag = "--constraints"
	if rest != constraintFlag && !strings.HasPrefix(rest, constraintFlag+" ") {
		return "", "", "", errors.New("usage: /memory consolidate fast|normal --constraints TEXT")
	}
	constraints = strings.TrimSpace(strings.TrimPrefix(rest, constraintFlag))
	if constraints == "" {
		return "", "", "", memory.ErrConstraintsRequired
	}
	return "consolidate", profile, constraints, nil
}

func memoryInspection(v any) (run.Inspection, error) {
	if inspection, ok := v.(run.Inspection); ok {
		if inspection.ID == "" {
			return run.Inspection{}, errors.New("memory: consolidation worker returned no job id")
		}
		return inspection, nil
	}
	// Keep this boundary tolerant of helper adapters which round-trip values
	// through JSON, while still requiring the runtime Inspection schema.
	b, err := json.Marshal(v)
	if err != nil {
		return run.Inspection{}, fmt.Errorf("memory: invalid consolidation job result: %w", err)
	}
	var inspection run.Inspection
	if err = json.Unmarshal(b, &inspection); err != nil || inspection.ID == "" {
		return run.Inspection{}, errors.New("memory: consolidation worker returned an invalid job inspection")
	}
	return inspection, nil
}

func waitMemoryJob(ctx context.Context, runtime *run.Runtime, current run.Inspection) (run.Inspection, error) {
	for current.Status == "running" {
		timer := time.NewTimer(memoryInspectInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return current, ctx.Err()
		case <-timer.C:
		}
		v, err := runtime.Call(ctx, "jobs.inspect", mustJSON(map[string]any{
			"id": current.ID, "offset": current.OutputEnd, "limit": 1,
		}))
		if err != nil {
			return current, fmt.Errorf("memory: inspect consolidation worker: %w", err)
		}
		current, err = memoryInspection(v)
		if err != nil {
			return current, err
		}
	}
	return current, nil
}

func stopMemoryJob(runtime *run.Runtime, id string) (run.Inspection, error) {
	if id == "" {
		return run.Inspection{}, errors.New("memory: cannot stop worker without a job id")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := runtime.Call(ctx, "jobs.stop", mustJSON(map[string]any{"id": id})); err != nil {
		return run.Inspection{}, err
	}
	v, err := runtime.Call(ctx, "jobs.inspect", mustJSON(map[string]any{"id": id, "limit": 1}))
	if err != nil {
		return run.Inspection{}, err
	}
	inspection, err := memoryInspection(v)
	if err != nil {
		return run.Inspection{}, err
	}
	return waitMemoryJob(ctx, runtime, inspection)
}
