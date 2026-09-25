# T3 runtime boundary (2026-09-25)

From c075261, moved host T3 adapters to `src/t3/tasks` and packaged web runtime to `src/t3/web`. Core `src/tasks` retains TaskManager/JobService; T3 adapters depend on the domain and are invoked by it, rather than owning task lifecycle. Direct integration tests now sit in `tests/t3`; generic CLI/update tests remain where they were. No aliases retain the old paths. The physical web archive/bootstrap, wire events, credentials and launch identity were not changed.

The contract fixture is consumed at `integrations/t3/fixtures/native-task-contract.json` (fixture move owned by tooling); build-web/web-source scripts move to `integrations/t3/build` in the tooling change. Check merged typecheck and tests after both land: this isolated worktree intentionally has neither new fixture nor moved build script yet.
