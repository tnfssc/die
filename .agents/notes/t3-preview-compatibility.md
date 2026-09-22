# Official T3 preview compatibility investigation (2026-09-22)

Research/probe only. No release, push, canonical pin/patch replacement, or shared cached-source mutation authorized.

## Resumable workspaces

- Owner: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_8a2c4ca2; branch die/investigate-t3-preview-compatibility-8a2c4ca2.
- Candidate/build worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_8a2c4ca2-a86675007a5e-task_02d7b006; branch die/preview-disposable-candidate-and-validat-02d7b006.
- Independent static audit: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_8a2c4ca2-a86675007a5e-task_2a5e28e3; branch die/preview-feature-and-packaging-audit-2a5e28e3.

Read parent uncommitted nightly-upgrade/release notes by absolute path, production requirements/final and process-resource notes; historical non-adoption statements are not the present product pin.

## Official identity

Owner rechecked GitHub releases API at 2026-09-22T07:59Z (100 releases): latest preview remains **v0.0.43-preview.20260921.2045**, target **b488c57f3f9f1688e31c53daee99e29dd1d0baa2**, prerelease, published **2026-09-21T06:28:04Z**.
https://github.com/pingdotgg/t3code/releases/tag/v0.0.43-preview.20260921.2045
Local raw response: owner artifacts/t3-preview/releases.json (disposable evidence).
Current canonical revision: a9b49a7df0a4261dcc438d4493cc3154a1d9819e.
Canonical patch SHA256 before investigation: 4d73cc3cdc4ad8962358d61bd31d178d3e47b346819bb2562d0b0d590c85ec02.
Canonical source JSON SHA256: b4dc0142f8fc7a4558e45cc6ae7f406d21c7cc0d8bf5a6c548a71f20657122b7.

## Verified ancestry and patch delta

Independent tag recheck also found no newer preview. Merge base is dfbb11bdd7c3f1a5575cb55d3e3abb12be025727; current-only 585 commits, preview-only 659. Neither is ancestor of the other. Direct tree delta is 311 files (259 modified, 49 added, 3 deleted), +16,007/-4,113 lines. This is v2-compatible source, not the incompatible nightly architecture. Divergent ancestry requires review, not an assumption that preview contains every current commit.

Canonical patch covers 102 files, 597,691 bytes; 21 overlap upstream delta. Plain apply fails in cli/config.ts, orchestration-v2/{Orchestrator,ProjectionStore}.ts, components/chat/MessagesTimeline.logic{,.test}.ts and contracts/src/orchestrationV2.ts. Three-way application reduces this to five regions in three files: Orchestrator (3), ProjectionStore (1), timeline test (1). Preserve both preview usage-limit recovery/targeted control reads and Die owned-local-job fencing/native usage reporting; concatenate independent test suites rather than select one side.

## Feature/packaging audit (static evidence, not runtime acceptance)

- PiDriver.ts, PiAdapterV2.ts and orchestratorMcp.ts are byte-identical upstream between pins. Die MCP/Pi injection/policy/completion/cancellation/accounting/session changes otherwise merge. BunPtyAdapter remains a clean Die addition. No architecture-removal blocker like nightly.
- Auth: preview changes OTLP config and retry/install device-list authorization/WS routing. DieWebAuth/EnvironmentAuth and tests apply; cli/config no-auth loopback logic auto-merges three-way. Hostile Origin/Host HTTP/WS matrix still needs runtime acceptance.
- Worktree: patched ThreadLaunchService implementation has no final-tree upstream change; test patch applies. Preview changes worktree UI/tests. Existing limitation remains: native delegated children share/inherit parent worktree, not automatic per-child worktree/setup. Do not advertise that as newly provided.
- Resource-sensitive changes: upstream Orchestrator +124/-5, ProjectionStore +541/-10. Existing Die bounded queues, exact process release and short child-idle policy merge; static application is not leak proof. Native usage projection still scans projected rows; review it alongside upstream targeted control reads.
- Dependencies: web adds @tiptap/extension-code ^3.31.3; shared exports orchestrationV2ThreadError; lock adds corresponding Tiptap entry and changes React Native menu patch hash. Third-party metadata bumps agent-device 0.20.10→0.21.7, expo-device-hub 0.9.0→0.10.1. Root/server manifests, pnpm-workspace.yaml and release workflow unchanged upstream. Die portable architecture expansion applies. Retain preview lock/license metadata.
- Official preview is a distinct prerelease channel, not nightly. No upstream channel relabeling is justified.

Static audit full response and evidence were copied into owner artifacts/t3-preview/static-audit.md and static-evidence/ (persistent disposable artifacts). Auditor used a disposable /var/tmp clone, not ongoing candidate source; candidate implementation remains in the persistent worker worktree above.

## Candidate validation

The worker created an independent clone at its .cache/t3-preview-candidate, branch die-preview-probe, base b488c57f3f9f1688e31c53daee99e29dd1d0baa2. Changes are staged, uncommitted, disposable—not canonical. Candidate patch is worker artifacts/t3-preview-probe/candidate.patch, 544,611 bytes, 103 files (+8,649/-543), SHA256 **1c879cb723de12b3803b11c1772b9688267f65ee52d855f20fd7f658fcf9f4a0**, staged tree **2982abf686f6147c5c36f7cdad41cf9920b096a7**. Formatting was normalized after merging; this is not merely the original patch with shifted contexts.

The focused projection test exposed a SQLite binding failure in preview's new recovery path: boolean options.autoResume/options.snooze cannot be bound by Node SQLite. Disposable candidate converts both to Number(...). Isolated test fails before and passes after this change; this is a required candidate fix, not evidence that the original official preview passes unchanged. No separate pristine-preview reproduction or live Bun-path claim is made.

Verified worker results (logs under worker artifacts/t3-preview-probe/):

| Command / scope | Result / evidence |
| --- | --- |
| corepack pnpm install --frozen-lockfile | PASS, pnpm-install.log |
| corepack pnpm fmt:check | PASS, fmt-check-final-2.log |
| corepack pnpm typecheck (full workspace) | PASS, typecheck-final.log |
| corepack pnpm build (apps workspace build) | PASS, build-final.log; x11 external/import-meta warnings, not failures |
| Web unit suite | 414 files / 5,464 tests PASS, web-focused-test.log |
| Server vitest: ProjectionStore.test.ts, LocalJobNotification.test.ts, Orchestrator.control-reads.test.ts | 3 files / 27 tests PASS, server-focused-final.log |
| Isolated repaired projection case | 1 PASS, projection-isolated-fixed.log (before failure: projection-isolated.log) |
| git diff --cached --check | PASS, diff-check.log |

A Bun frozen install attempt failed because Bun tried to migrate the pnpm workspace lockfile (bun-install.log); use the pinned pnpm workflow. This is not a successful Bun install claim.

Owner independently checked candidate patch SHA/tree above, reverse apply check, and imported scripts/web-source.ts verifyWebSource(candidate, candidate.patch): **PASS** (exact HEAD + candidate patch, including untracked-source guard; cached git apply inside verifier succeeds).

Owner additionally ran from candidate apps/server:

```sh
TMPDIR=/var/tmp corepack pnpm exec vp test run \
  src/auth/DieWebAuth.test.ts src/auth/EnvironmentAuth.test.ts \
  src/mcp/DieDelegationPolicy.test.ts \
  src/orchestration-v2/Adapters/PiAdapterV2.test.ts \
  src/orchestration-v2/NativeUsageAccounting.test.ts \
  src/orchestration-v2/ProviderSessionManager.test.ts
```

**6 files / 127 tests PASS**, exit 0, 11.45s. Evidence: owner artifacts/t3-preview/owner-server-focused.log. Together the two distinct server runs cover 154 tests; the isolated projection rerun is overlapping evidence, not an extra distinct test. These suites exercise auth, delegation policy, Pi adapter, native usage and provider resource/session behavior, but are not a live end-to-end deployment acceptance claim.

## Recommendation and remaining gates

**Preview is a feasible, manageable upgrade candidate; authorize a separate adoption/acceptance task if desired. Retain current canonical pin/patch until then.** Unlike nightly, no missing-v2/native architecture blocker exists. Code migration is small-to-medium (three conflict files plus the tested SQLite binding correction and formatting), but lifecycle review is medium-high risk and acceptance scope remains large. Estimate **1–2 engineer-days including review and full validation**, assuming no new runtime regressions; this is an estimate, not a release promise.

Remaining adoption gates:

- Review semantic composition of Orchestrator usage-limit recovery/local-job ownership and ProjectionStore targeted control reads/native subtree usage; do not simply select one conflict side.
- Real native Die root→child execution, status/stop/cancel/replay/reconnect, policy/depth/profile enforcement, completion/continuation and second-turn local-shell preservation, plus nested cost/Herdr behavior.
- Runtime no-auth loopback hostile Origin/Host HTTP/WS matrix, ordinary/root worktree setup and the documented native child worktree limitation.
- Migration from canonical production state and idempotent restart; resource fan-out/replay/queue/FD/PID/shutdown acceptance beyond focused unit/process fixtures.
- Actual Die build-web deploy/archive, supported-platform optional native dependency completeness, license outputs, relocated single-binary browser/terminal smoke without development runtime. Workspace build alone does not test pnpm deploy, portable ffi-rs verification, bootstrap/archive or final executable.
- Broader server/desktop/platform suites were not run; no full-upstream-suite, universal-platform, zero-leak, or release-readiness claim.

## Evidence and safety boundary

Worker evidence directory contains releases.json/latest-preview.txt/remote-preview-tags.txt, apply-check.log/apply-3way.log/conflicts.diff, install/format/typecheck/build/test logs, candidate.patch and candidate-identity.txt. Owner copied the full worker response to artifacts/t3-preview/candidate-worker.md. Paths are persistent local disposable artifacts, not committed build outputs; this report preserves identities and outcomes for future reproduction.

No shared cached source modified; clones are independent. No release/version/tag/push or application installation action (dependency installs were confined to the disposable candidate). Canonical web/t3-source.json and web/t3.patch unchanged; final owner git diff against HEAD confirms no product changes. Only this report and notes index are committed.
