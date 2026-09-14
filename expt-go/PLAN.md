# Experimental Go rebuild plan

Status: **experimental; not production-ready or parity-complete.** Research is substantially complete for app inventory, TUI, providers, and alternatives; focused Bun packaging and parity-validation reports are finishing. User authorized implementation after research and explicitly requires observed behavior parity, not merely new tests passing.

## Direction

- Go owns CLI, TUI, provider requests/auth adapters, sessions, turn lifecycle, jobs, child agents, attention, goals, memory, history and diagnostics.
- Bun is bundled solely for the existing programmable JS/TS execute contract. No Pi application hidden behind a Go launcher. Bundled subprocess is acceptable; in-process embedding is not assumed.
- Bubble Tea v2 family for the terminal, subject to toolchain/API compatibility verification. Thin provider adapters preserve native request/response items. No overarching agent framework.
- Linux amd64 first. Existing die source, executable, user state and sessions remain untouched. New default state should be isolated under ~/.godie; explicit migration/import later, never silently rewrite ~/.die.
- Current-app inventory defines behavior targets. Existing JS/TS extension binary compatibility is not assumed, but any omitted user-facing capabilities are recorded as gaps.

## Implementation sequence

1. Pin shared Go contracts and build the executable scaffold, durable session/event model and headless loop. Inventory CLI/slash/helper surfaces against original source.
2. Implement Go-owned job service and Bun execution bridge; verify packages, images, output bounds, handoff, stdin, ownership and process-group cancellation. Parent owns launched jobs independently from execute lifetime.
3. Add provider streaming/tool cycles and lossless replay, including the actual provider/auth path used by current die. Official API support alone is not Codex subscription parity. Keep provider auth/capabilities separate; never silently downgrade premium/compaction/model semantics.
4. Add terminal editor/transcript/footer/job monitor and session resume/branching. Port product-specific goal, memory, history, attention, cost, compaction and fast-mode policies.
5. Validate continuously with race/unit/integration checks and original-vs-new scenario comparisons; run real PTY checks and bounded live-provider flows where available. Missing access is a blocker to report, not a passed check.
6. Build the distribution artifact with bundled runtime, notices and relocation/offline-runtime-start checks. No installation over the existing die binary without user request.

## Acceptance

- Match observed behavior of current source-built die, not stale README version statements.
- User-visible behavior matters: editable responsive input while work runs, completion resumes agent, no polling floods, session-owned job IDs, worker delegation restrictions, cancellation scope, output/image limits, persistence and safe replay.
- Test at least 50 concurrent tasks with bounded output/state and no goroutine/process leaks. Never broad process-name kills or signaling unrelated process groups. Use isolated temp homes/state/worktrees for destructive scenarios.
- Preserve auth secrecy. Do not log tokens or copy full real session histories into artifacts. Provider calls must use bounded fixtures and standard tier; no unapproved premium or bulk load testing.
- A passing mock or unit suite is not proof of provider/TUI parity. Store commands, versions, outcomes and deviations in validation evidence.
- Maintain a parity matrix with implemented/tested/blocked/missing, and continue closing gaps rather than labeling an MVP the same app.

## Research

See research/current-app.md, go-runtime.md, go-llm.md, alternatives.md, and the forthcoming bundled-bun.md and parity-validation.md. Raw web discovery/extraction evidence is under research/sources/. The go-tools report is an alternatives study; its Go-only premise was superseded by the user's Bun decision.

## Work ownership

Initial implementation orchestrator task_68582da3 is historical. The replacement implementation owner integrated the current runnable candidate; see evidence/FINAL-INTEGRATION.md for final source hash, gates, and remaining boundaries. Main agent owns final review and independent acceptance evidence. Reserve expt-go/validation/ for main-agent acceptance workers (do not overwrite their work); research authors own research reports.
