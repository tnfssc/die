# Product/session surface implementation

## Scope and sources

Reviewed the governing `COORDINATION.md`, `PARITY.md`, `IMPLEMENTATION.md`, all existing `implementation-*.md` notes, the original `src/goals/**`, `src/history/**`, `src/herdr-agent-state.ts`, and Pi's original built-in slash-command catalog. Work was restricted to `internal/session/**`, new `internal/app/product_*.go` files, this note, and `evidence/product-new/**`. Existing TypeScript, TUI/provider code, `application.go`, `commands.go`, validation, and root files were not changed.

## Audit findings, in priority order

1. **P0 durable history and goals:** already substantially implemented in `internal/session/history.go` and `goals.go`, including branch snapshots, refs/cursors, explicit cross-session consent, shaken-entry exclusion, legal goal transitions, runtime-owned waiting, and concurrency locking. The executable app only exposes a shallow `/history <query>`; ref reads are unreachable from the user slash surface.
2. **P0 session navigation/product commands:** the original built-in catalog includes `/session`, `/tree`, `/export`, `/fork`, `/clone`, `/new`, and `/resume`. Godie currently advertises only its non-original `/sessions` and low-level `/branch`. It lacks a whole-tree view, session stats, safe export, and normal resume command. Interactive selectors and application replacement cannot be completed without coordinator/TUI-owned edits.
3. **P1 Herdr lifecycle:** `internal/herdr` is already a careful implementation matching the original root-interactive-only, bounded, nonfatal protocol, but it is not wired into the app lifecycle. Duplicating that package would be harmful; integration is the remaining gap.
4. **P1 remaining original built-ins:** `/name`, `/copy`, `/settings`, `/scoped-models`, `/import`, `/share`, `/hotkeys`, `/changelog`, `/trust`, and `/reload` remain absent or depend on UI/config/security ownership. `/fork` and `/clone` also require explicit persistence semantics and session replacement, not a superficial alias for branch selection.

## Implemented

### Durable session product primitives

`internal/session/product_surfaces.go` adds:

- `Session.Tree`: returns every non-control archive entry, including abandoned branches, with active-path and active-leaf markers and bounded message previews.
- `Catalog`: returns newest-first native Godie session headers for a CWD, while isolating malformed/unreadable archives so one damaged file cannot break resume discovery.
- `ExportJSONL`: syncs and copies the complete append-only archive to an exclusive private (0600) destination; refuses source overwrite and removes partial output.
- `ExportHTML`: writes an exclusive private, self-contained active-branch transcript with role/content HTML escaping and partial-output cleanup.

Focused tests create only temporary archives and verify divergent-tree visibility, active-path marking, catalog discovery, exact JSONL presence, and HTML escaping.

### Ready-to-route app surfaces

- `internal/app/product_session.go` implements presentation for `/session`, `/tree`, catalog-only `/resume`, and `/export [path.html|path.jsonl]`.
- `internal/app/product_history.go` implements `/history search <query>`, `/history read <ref> [maxChars]`, and preserves `/history <query>` shorthand.

These are intentionally not routed from coordinator-owned `commands.go` without ownership approval.

## Integration-owner approval/requested existing app edits

The integration owner should make the following bounded edits:

1. In `internal/app/commands.go`, route `/history` to `a.ProductHistoryCommand(ctx, args)`; route `/session`, `/tree`, `/resume`, and `/export` to `a.ProductSessionCommand(name, args)`; add them to `/help`.
2. For `/resume <path-or-id>`, do not merely call `Session.Resume` (that selects an entry in the current archive). The coordinator must close/replace the current session and rebuild session-bound History/Goals/runtime/policy state, while refusing active jobs. The no-argument implementation safely supplies catalog data until a TUI selector owns selection.
3. Wire existing `internal/herdr.FromEnvironment(root, interactive)` only in root TUI startup. Report session identity, working at turn start, idle only when foreground and owned jobs settle, blocked around user prompts, and close/release on shutdown. Never enable it for print/JSON/RPC/children. Transport errors remain diagnostics/nonfatal.
4. `/new`, `/fork`, and `/clone` need the same coordinator-owned session replacement boundary. Do not fake them by changing the current leaf. `/copy` needs TUI clipboard ownership.

## Executable evidence

Captured in `evidence/product-new/go-product-checks.txt`:

~~~sh
go test -v ./internal/session -run Product
go test ./internal/app ./internal/herdr
go vet ./internal/session ./internal/app
go test -race ./internal/session ./internal/app ./internal/herdr
~~~

All passed. The Herdr package tests use only fake Unix sockets. No live calls, installs, commits, original/root edits, validation edits, or TypeScript changes were made. No claim is made for integrated slash/TUI parity until the coordinator routes these methods and differential PTY checks are run by the validation owner.
