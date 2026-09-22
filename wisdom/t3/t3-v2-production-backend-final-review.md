# T3 v2 production backend final review

Reviewed the current working tree in `.cache/die-t3code-v2-production` (read-only; no candidate source edited), plus the production design/backend/cancellation/resource notes. Native integration and browser-owned files were not touched.

## Verdict: BLOCKED

### P0 — Die authority is still granted to every root Pi thread when Die web mode is enabled

This is a current source bug, not an obsolete design-note concern.

`ProviderSessionManager.ts:439-447` derives `{ profile: "orchestrator", depth: 0 }` whenever `DIE_WEB_DIE_BINARY` resolves, `providerInstanceId === "pi"`, and the thread has no parent. There is no durable “created/owned by Die” marker or trusted launch identity check. It then mints `die-delegation` instead of ordinary `orchestration` at lines 480-523. Thus any ordinary root conversation using the shared Pi provider in a server with Die mode configured receives authoritative orchestrator Die credentials. This directly contradicts the backend/design claim that non-Die Pi instances are not authorized solely by `driver=pi`.

Impact: an unrelated Pi root can call `die_task_launch` with orchestrator authority and consume the trusted server-side profile/model mapping. This is an authorization-boundary failure.

Required fix/test: persist or otherwise supply a server-trusted Die root identity at thread/session creation and require it when deriving depth 0. Add a negative integration test: Die binary configured + ordinary root Pi thread => no `die-delegation`; genuine Die root => depth-0 orchestrator policy. Existing policy unit tests start from an already trusted boolean and therefore do not cover this minting flaw.

### P0 — a cancelled ancestor's bearer remains authoritative during teardown, so cancellation can miss a newly launched descendant

`DieTaskService.requireDieScope` (`DieTaskService.ts:102-111`) trusts the policy cached in the bearer and only reloads the current thread projection; it does not re-derive lineage or verify that the parent Die edge is still live. `cancel` performs a finite, one-time recursive projection walk (lines 288-310). Ancestor cancellation is persisted and the active run is interrupted, then descendants are loaded and walked, but there is no authority fence preventing an in-flight MCP call from the child credential from committing `die_task_launch` after that child's subtree snapshot. Credential revocation/session teardown is not atomic with the durable cancellation command.

Impact: cancellation is not an authoritative subtree barrier. A racing child launch can create a grandchild after the walk and escape cancellation, leaving work/processes alive despite a successful cancel response.

Required fix/test: launch authorization must revalidate durable ancestry under the same serialization boundary as delegated-task creation (every ancestor edge still Die-owned/nonterminal/not disposed), or cancellation must durably close delegation for the subtree before scanning and creation must reject against that fence. Add a barrier test that pauses child launch immediately before dispatch, cancels the ancestor, then resumes launch; launch must fail and no descendant/process may exist. Current tests prove idempotent row cancellation and ordinary pre-existing descendant traversal, not this concurrent creation race.

### P1 — delegated completion wakes instruct Die sessions to call a capability they deliberately do not have

`ProviderContinuationService.ts:20-24` and the equivalent wake-detail path emit “Use task_status…”. Die credentials intentionally contain `die-delegation` rather than `orchestration` (`ProviderSessionManager.ts:480-523`), while `OrchestratorMcpService.requireCapability` requires `orchestration` (lines 751-759). Therefore `task_status` is denied for the recipient of a native Die completion wake; its supported read API is `die_task_observe`.

This does not by itself show loss of the durable result—the projection/recovery path retains it—but the continuation delivered to the model gives an unusable ACK/read instruction and can make the completion turn fail to retrieve its result. Generate capability-aware wake text (native Die task IDs => `die_task_observe`) and test the actual restricted credential/tool call, not only the queued message shape.

### P1 — resident continuation limits are item-count-only, not memory bounds

`ProviderContinuationRequests` and the retry scheduler cap each queue at 256 items, and the retry worker/fiber count is bounded. However a request retains arbitrary `detail` and `notification` payloads; neither admission nor queue accounting imposes a byte ceiling. Consequently the claimed resource bound is not a memory bound. The backpressure test only fills item slots. Add payload limits/byte-budget accounting and a large-payload retention test. For native delegated completions specifically the request uses `detail:null`, so this is a shared continuation-service production bound, not evidence that each Die completion is oversized.

## Reviewed areas that are currently supported (not blockers found here)

- Durable cancellation resolution correctly makes cancel win over a later ACK: `delegated_task.cancel` writes cancelled/disposed, and acknowledge-after-dispose is an idempotent no-op. It also removes the task from the current cohort and cancels an empty queued wake.
- Completion recovery is projection-driven: startup scans `delegated-completions`, reconciles terminal delivery runs, and reoffers current delivery identity. The continuation tests include persisted-steer recovery, transient retry, backoff, generation invalidation, and stopped/disposed non-revival. I did not find a source-level lost-replay bug in those paths.
- Fresh and retry continuation queues and retry fibers/timers are count-bounded; this is better than the older unbounded/per-failure behavior, but does not resolve the byte-bound blocker above.
- `die_task_list` is paged (max 100), list omits outputs, and observe truncates output to 64k characters.

## Evidence caveat

Backend/design notes cite passing focused/full suites and the current tests contain the cases above. I did not treat historical pass counts as current proof while concurrent workers are editing the tree, and I did not run or modify `NativeDieIntegration.production.test.ts`. The process-resource test visible in `ProviderSessionManager.test.ts` exercises five children and exact PID release; it is useful regression evidence but is not the N-cycle heap/FD/socket/queue plateau acceptance specified by the resource review.
