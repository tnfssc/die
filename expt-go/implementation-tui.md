# TUI implementation log

## Public API contract

Package `internal/tui` owns terminal presentation. The existing foreground backend contract is unchanged:

```go
type Backend interface {
    Submit(ctx context.Context, prompt string, emit EmitFunc) error
    Cancel()
}
```

Job control is a separate optional capability. Supply it as `Config.JobBackend`, or implement it on the same value as `Config.Backend`:

```go
type JobBackend interface {
    ListJobs() []Job
    InspectJob(id string, maxBytes int) (string, error)
    StopJob(id string) error
}
```

`InspectJob` must return no more than `maxBytes` of the most recent output. The TUI currently asks for 16 KiB and defensively bounds oversized results.

Sub-agent settings are another optional capability, supplied as `Config.SettingsBackend`:

```go
type SubagentType string
type SubagentProfile struct { Model, Thinking string }
type SubagentProfiles map[SubagentType]SubagentProfile
type ProfileModel struct { Provider, ID, Name string }
type SettingsBackend interface {
    GetSubagentProfiles() (SubagentProfiles, error)
    SaveSubagentProfiles(SubagentProfiles) error
    ListModels() ([]ProfileModel, error)
}
```

The known profile keys are `fast`, `normal`, and `orchestrator`; an empty model or thinking value means inherit. Save persistence and atomic replacement belong to the backend, never the TUI.

- `New(Config) *Model` creates the Bubble Tea model; `Run(ctx, Config) (*Model, error)` runs it inline (not in the alternate screen).
- `Config.History` and `Config.InitialDraft` restore input state; `Draft()`, `History()`, `Messages()`, and `Active()` expose final state.
- Existing events remain supported. New events are `EventNotice` (visible system notice), `EventMessageBoundary` (forces the next assistant delta into a new message), and `EventExecutePreview` (system row with foldable `Event.Detail`). `EventStatus` is now both the footer state and a visible, consecutive-deduplicated system notice; a non-empty `Detail` is foldable.
- `Message` adds `Detail string` and `Foldable bool`. `Job` adds optional `Detail string`.

## Interaction and rendering

- Enter submits; Alt+Enter queues a follow-up while active; Shift+Enter/Ctrl+J inserts a newline; Up/Down browse one-line history; Escape cancels an active turn, Ctrl+C clears, and a second idle Ctrl+C exits.
- Enter on an exact `/subagents` draft opens the profile editor. Fast, normal, and orchestrator each expose model and thinking rows; empty values inherit. Model selection includes the current unavailable value, deduplicates/sorts the backend catalog, and supports fuzzy keyboard filtering. Escape backs out/cancels without changing the editor draft; Save makes one backend call and leaves backend errors visible.
- Enter on an exact `/ps` draft opens the job overlay without submitting. Ctrl+P also opens it. The draft is retained exactly while the overlay is open and restored on close/cancel.
- Overlay: Up/Down or j/k select, Enter/i inspects bounded output, s/x opens a stop confirmation, y/Enter explicitly confirms, n/Esc cancels confirmation, Esc leaves inspect then closes, and Ctrl+C closes without cancelling the foreground turn.
- Ctrl+O toggles foldable status/execute details.
- Backend/config text is sanitized before rendering: ANSI CSI/OSC/string escapes, C0/C1 controls, invalid UTF-8, terminal line controls, and bidi overrides are removed; tabs become spaces.
- Window dimensions are no longer clamped upward. Final rendering is cell-aware and bounded to the actual terminal, including 20x4, narrower widths, and zero dimensions.

## Evidence

Focused tests in `internal/tui/model_test.go` and `internal/tui/enhancements_test.go` cover streaming, draft/history preservation, active cancellation, errors, responsive rendering, 20x4 and smaller bounds, ANSI/control sanitization, job selection and inspection limits, explicit stop confirmation/cancellation/errors, foldable details, visible notices, and assistant-message boundaries. `settings_test.go` additionally covers all three profile fields, inherited/current/unavailable models, fuzzy filtering, editor-draft preservation, backend-only saving, and visible sanitized load/list/save failures.

Commands run:

- `go test ./internal/tui`
- `go test -race ./internal/tui`
- `go vet ./internal/tui`
- `go test -count=10 ./internal/tui`

No PTY parity claim is made here; PTY validation requires the integrated binary.


## Compact inline parity pass (2026-09-13)

The generic full-screen chat shell has been removed. The normal view now uses Bubble Tea’s inline screen (no alternate-screen flag), has no product title/header or key-hint bar, does not fill an empty viewport, and grows the transcript naturally until the terminal becomes the scroll window. The editor is borderless in presentation, has no placeholder, and uses the source ` ` prompt (a same-width working glyph while active). User turns retain a leading breathing row while assistant/system output is dense and unlabeled. Existing viewport keys still scroll once content exceeds available rows. Overlays and the subagent/model editors also remain inline; incoming stream/job events continue to be applied while an overlay is open and are visible when it closes.

The bottom row is now the source-style product footer rather than `ready / enter send / ctrl+c quit`. It progressively fits project, mode, cost, context, cache, and provider/model. Conservative defaults are project basename, orchestrator, `$0.000`, `ctx ?`, `cache est ?`, and provider parsed from the existing title or `unknown`. Narrow terminals retain high-value usage/provider fields. Ctrl-C remains source-compatible: it clears the editor, and a second idle Ctrl-C within 500 ms exits; Escape cancels an active turn without destroying a steering draft.

### Integration API required for live footer values

No `internal/app` file was edited. Integration should populate `Config.Footer FooterState` initially and emit `Event{Kind: EventFooter, Footer: ...}` when accounting/model state changes. `FooterState` fields are `Project`, `Mode`, `Cost`, `Context`, `Cache`, and `Provider`; partial events merge non-empty fields, so app accounting can update one badge without racing or resetting the others. In particular, the app should supply its actual instruction mode, root-session total cost, context percentage, cache countdown estimate, and current provider/model after model switches. The existing title parsing keeps the currently integrated binary useful but is only a static fallback.

### Checks and PTY evidence

- `go test ./internal/tui`
- `go test -race ./internal/tui`
- `go vet ./internal/tui`
- Real isolated controlling-PTY run for original and a source-built TUI fixture: `evidence/implementation-tui-new/{original,candidate}/`. Both restored terminal flags, exited on double Ctrl-C, and reported no panic.
- Independent 100x30 tmux captures: `evidence/implementation-tui-new/{original-tmux,candidate-tmux}/{startup,edited}.txt`. Candidate now has the same top-level shape as original: `` / ` abc` immediately followed by a single project/cost/context/cache/provider footer; there is no header, textarea border, hint bar, or reserved blank transcript region. The candidate additionally shows `mode: orchestrator` as requested.

The full application source build was not used for this worker’s PTY artifact because concurrently owned app work was not buildable (`internal/app/diagnostics.go` contained an invalid NUL at capture time; the later whole-tree check instead stopped at an unresolved `ValidateSessionID`). The fixture imports and runs the real `internal/tui` package; app integration should rebuild and repeat the same PTY drive after its source is coherent. No provider call was made.

## Final coordinator integration
Footer data is populated from durable app snapshots and updated on turn/notice. Added InitialPrompt to submit positional interactive input rather than leaving a draft (InitialDraft remains separate). Real original/candidate streaming PTY verifies initial automatic request, unsent Unicode draft preservation during stream, second request and terminal restoration. Added EventQuit for graceful navigation: context-kill skipped Bubble Tea reader join and caused lost keys after replacement; graceful quit fixes it. Evidence final-streaming-pty and navigation-repeat-fixed.log.
