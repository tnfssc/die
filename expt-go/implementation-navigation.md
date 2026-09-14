# Interactive session navigation implementation

Implemented the coordinator-owned application replacement boundary for interactive sessions.

## Owned changes

- `cmd/godie/main.go` now runs applications in a lifecycle loop, integrates `applyCLIParity`, and closes each old runtime/session before opening a requested replacement.
- `cmd/godie/navigation.go` owns the per-TUI cancellation/request controller and returns a typed `interactiveRestart` only after the TUI and background event pump stop.
- `internal/app/navigation.go` validates and prepares `/new`, `/resume path|id`, `/fork [entry-id]`, and `/clone` without mutating live Application fields.
- Navigation preserves provider/model/thinking/CWD and other durable CLI identity while clearing one-shot selection, prompt, command, and export fields.
- Root interactive sessions only: child/internal and `--no-session` navigation is rejected.
- Navigation takes the engine idle lock and rejects any running owned jobs. The old Application is then closed by the main loop, so runtime shutdown precedes session replacement.
- `/resume` with no argument remains routed to the existing catalog presentation.
- Fork copies the branch through an optional entry; clone copies the current active branch. Both create a closed durable child archive before restart.

## Tests

- `internal/app/navigation_test.go`: new/resume lifecycle, option identity, fork-vs-clone history, parent provenance, catalog fallback, and child restriction.
- `cmd/godie/navigation_pty_test.go`: real controlling-PTY test starts the offline CLI with isolated state, runs `/new`, verifies a distinct session, runs `/resume <old-id-prefix>`, verifies the old ID is displayed again after lock ownership switches back, and checks there are exactly two archives and no panic.

Executed without network or credentials:

`go test ./internal/app -run Navigation -count=1`
`go test ./cmd/godie -run 'InteractiveNewAndResumePTY|NavigationPTYHelper' -count=1 -v`

A separate direct built-binary PTY smoke also passed with two session archives, the old ID shown after resume, and no panic.
