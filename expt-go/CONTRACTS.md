# Implementation contracts (v1, 2026-09-13)
Module godie, Go1.25.7. core/types.go is integration-owned: propose additions rather than editing concurrently.
Go-only app/provider/session/orchestration; Bun execute only. No installs/system changes/real ~/.die mutations. Existing source read-only. No research or validation/ edits by implementation workers.

Ownership:
- provider worker: internal/provider/**, provider evidence in implementation-provider.md. Expose Config + New(Config)(core.Provider,error), auth/config functions as needed. Native provider message bytes in core.Message.Native. Complete handles only one inference, tool cycle owned app. Codex required, standard tier only live validation; no secret output. Native raw state preserved, refuse unsupported controls.
- runtime worker: internal/runtime/**, scripts/build runtime assets as agreed, implementation-runtime.md. Expose Config {CWD,StateDir,SessionFile,BunPath string; Helper core.Helper}, New(Config)(*Runtime,error), Execute implements core.Executor, Call(ctx,method,args) for shell/jobs.*; Events() channel completion notifications; Running() int; Close() error. Extra callback routes subagent/history/goal to app. Parent Go owns jobs separately from execute worker.
- product worker: internal/session/** and internal/tui/** and implementation-product.md. Session append JSONL branch tree, exclusive writer, history/goals. TUI independent backend interface callbacks; document exact API quickly. No CLI ownership.
- integration: cmd/godie, internal/app, core, top-level docs/parity matrix, go.mod/go.sum integration.

Avoid changing go.mod concurrently: report dependency requirements to coordinator, use stdlib first or coordinate exact additions. Bubble Tea v2 preferred and dependency downloads (not installation) allowed if compatible. JSON wire field names follow existing helpers rather than Go struct names. Treat helper args raw JSON; provider tool schema execute {code:string,timeoutSeconds?:number}.
