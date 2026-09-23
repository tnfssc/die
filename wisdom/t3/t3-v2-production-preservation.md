# T3 v2 production preservation — Pi/config/auth/local shell

Date: 2026-09-21

## Ownership / coordination

This worker changed only the v2 candidate at `.cache/die-t3code-v2-production` in the PiAdapterV2, loopback-auth/config/startup, and their focused tests. It did **not** edit root `src/tasks/**`, the backend-owned `DieTaskService`/MCP tool schemas/handlers/policy, canonical `web/t3.patch`, `web/t3-source.json`, or the exported candidate patch. Concurrent backend changes under `apps/server/src/mcp/**` and `packages/contracts/src/orchestratorMcp.ts` were left intact.

## Preserved / implemented

- Credential-free Die web startup is enabled only when `DIE_WEB_DIE_BINARY` is non-empty, runtime mode is web, the resolved listener is exactly `127.0.0.1`, `::1`, or `localhost`, and Tailscale serve is off. Die defaults its listener to `127.0.0.1`; unsafe explicit binds fall back to normal authentication.
- Defense in depth revalidates that gate inside `EnvironmentAuth`, including manually assembled configs.
- No-auth HTTP and WebSocket requests require a loopback Host-derived request URL. Browser Origin must exactly equal the request origin and `Sec-Fetch-Site` must be same-origin/none; opaque, cross-site, wrong-port, alternate-host, and DNS-rebinding-style hosts reject. Headerless local non-browser clients remain supported.
- Browser/headless startup emits the plain loopback URL in no-auth mode and does not mint/log a pairing URL.
- Pi mode remains an independent `instructionMode` option: validated fast/normal/orchestrator, applied before the user prompt, reset across session switch/fork, and not encoded into model identity. Existing Pi-default/model/thinking restoration remains intact.
- V2 now consumes bounded `die_task_event` records for **Die-owned command jobs only**, projects them as ordinary command-execution timeline cards, caps retained records at 50, keeps the provider session/turn pending while a shell runs, and treats global Stop as a runtime teardown while one runs. `kind=agent` frames are deliberately ignored so backend-native child nodes are still the only owner/card for native children.
- Existing V2 mechanisms retained (not rewritten): active-branch history snapshots via `get_messages`, session-tree rollback refs via `get_entries`, full/delta handoff through normal user-message turns, live/final token usage, manual/automatic compaction lifecycle and continuation, session file/name identity, and process-group finalization.

## Focused evidence

- Auth/config focused: `DieWebAuth.test.ts`, `EnvironmentAuth.test.ts`, `cli/config.test.ts`: **40 passed / 0 failed**.
- PiAdapterV2 focused suite: **49 passed / 0 failed**, including local-shell ownership/pending/settlement and instruction-mode ordering.
- Startup suite: **9 passed / 0 failed**, including direct no-auth URL and ordinary pairing URL.
- Existing command-item presentation + MessagesTimeline suites: **67 passed / 0 failed**, confirming command-execution items remain renderable as ordinary work cards.
- `git diff --check`: pass. Focused `vp fmt --check` over 11 owned files: pass.
- Server `tsc --noEmit`: this worker’s files emitted **no TypeScript errors**, but the whole command exited 1 only on concurrently created backend-owned `src/orchestration-v2/NativeDieIntegration.production.test.ts` errors (including missing `T3ExecuteBridgeClient`, possibly-undefined values, and Effect lint diagnostics). This is not reported as a clean full typecheck. Final rerun confirmed zero `error TS` lines outside that file. Log: `.cache/preserve-tc-final.log`.
- Initial test attempt failed before import because shared `/tmp` was 100% full; reruns used private `TMPDIR=/home/tnfssc/Code/die/.cache/t3-test-tmp` and passed as above.

## Precise unported / blocked gates

- No per-shell-card inspect/output pagination or individual stop button is added. Shipped semantics are lifecycle card plus parent/global Stop; root `TaskManager` is still the shell owner. Any future per-job control must use the root-owned route and cannot be aliased to backend native-child cancel.
- Herdr's reporting/liveness bridge is root-owned and was not changed here. This work prevents local shells from disappearing/releasing early, but does not by itself prove Herdr native-child accounting.
- Pi history/handoff/compaction/usage are covered by the existing adapter suite and source review. No final packaged binary, restart/resume migration, real Pi process, or Herdr integration run was run by this worker.
- Native child launch/status/cancel/replay/ACK/profile/depth authorization remains backend/root-worker scope. Same-live-server browser acceptance, security negative matrix over every new MCP route, packaged runtime, crash/reconnect matrix, and resource soak remain coordinator release gates.
- Upstream unbounded producer queues and provider-session timeout/orphan concerns from `t3-v2-production-resource-review.md` are not resolved by these narrow preservation changes.

## Validation summary

See focused evidence above. No live user server, state, credentials, provider, or installed binary was used. No candidate/canonical patch was exported or adopted.
