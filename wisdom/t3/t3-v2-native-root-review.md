# Independent review: T3 v2 production native root delegation

Reviewed current root sources (`src/tasks/t3-*.ts`, `job-service.ts`, execute/job-bridge identity plumbing and focused tests), the exact fixture, current production candidate backend contract, and the prior requirements/resource/root notes. This is read-only review of implementation except for this requested note. I did not run the shared build/server or edit implementation.

## Concrete findings to feed implementation

### P0 — the scoped bearer is exposed directly to model-authored execute and shell code (claimed-complete bug)

**Source:** `src/typescript/execution.ts:108-116` constructs the isolated runner environment with `{ ...process.env }`. The production provider process receives `T3_MCP_BEARER_TOKEN`, so every execute program receives it too. In addition, `job-service.ts:226-235` launches `shell` without a scrubbed `env`, so the shell inherits the same bearer. Local agent spawn at `job-service.ts:336` also explicitly copies all of `process.env` (relevant whenever that local path is used).

**Minimal reproducer:** in an authorized T3-backed Die session, execute either:

`console.log(process.env.T3_MCP_BEARER_TOKEN)`

or `await shell('printf %s "$T3_MCP_BEARER_TOKEN"')`. The credential enters tool output/model context. Model code can also call the MCP endpoint directly, bypassing root's client-side four-tool allowlist. The candidate now issues a narrower `die-delegation` capability, which improves server authorization, but does not satisfy the explicit requirement that the bearer be absent from execute output/model/logs.

**Fix/test:** remove both `T3_MCP_URL` and `T3_MCP_BEARER_TOKEN` from the isolated runner and all model-directed local child environments; retain them only in the trusted parent-side JobService/MCP client. Add an execute test which seeds sentinel credentials and asserts JS and `shell` cannot read them while `subagent/jobs.*` still reach a parent-side fake adapter. This must not scrub unrelated local CLI environment variables.

### P1 — launch commit/lost-response recovery covers only reader/fetch exceptions, not other ambiguous post-dispatch failures (claimed-complete bug)

**Source:** `t3-native-task.ts:80-87` retries only `McpAmbiguousResponseError`. `t3-mcp-client.ts:108-180` classifies a reader exception as ambiguous, but an EOF with an empty/truncated/invalid JSON or SSE body throws ordinary errors (`invalid JSON` / `no matching SSE response`). `t3-mcp-client.ts:248-265` also converts the client's own 30-second timeout after dispatch into ordinary `T3 MCP request aborted`. All can occur after `die_task_launch` committed. The stable request ID makes one replay safe, but these paths do not replay.

**Minimal isolated reproducer:** mock `fetch` so initialize succeeds, then the launch POST returns HTTP 200 with an empty or truncated JSON body. `T3NativeTaskAdapter.launch` makes one launch call and rejects rather than replaying the same `clientRequestId`. A stream that stalls after the launch POST until the internal 30s timeout has the same property. Existing test at `tests/t3-native-routing.test.ts:179` injects the desired error class directly and therefore misses classification.

**Fix/test:** distinguish caller cancellation/definitive JSON-RPC rejection from failures after launch dispatch. Classify malformed/truncated successful responses and owner timeout as ambiguous (or safely replay launch once on all non-definitive, non-caller-abort transport/protocol failures). Assert two launch POSTs with exactly the same request ID for empty JSON, truncated SSE, and internal timeout; preserve one call for typed/HTTP authorization rejection and caller abort.

### P1 — per-session launch-ledger cache is unbounded (claimed-complete resource bug)

**Source:** `job-service.ts:90` has `#launchLedgers = new Map<string, T3LaunchIdentityLedger>()`; `165-174` inserts one entry for every distinct session file and never removes or caps entries. The on-disk ledger is bounded, but the process-resident path/object map is not. A long-lived CLI/web process opening many sessions grows it forever, contrary to the bounded cache requirement.

**Minimal reproducer:** reuse one JobService and perform native launches with N contexts whose `getSessionFile()` values differ; after responses/ACKs and closed adapters, N ledger objects remain reachable from JobService. Current tests exercise one/few paths and do not cover churn.

**Fix/test:** avoid permanent caching, or use a bounded cache that cannot break same-path operation serialization (for example active-entry refcounts plus bounded idle LRU). Churn more than the bound across session files, ACK all calls, and assert retained entries/active handles remain bounded while concurrent launches for one path still serialize.

### P2 — combined local/native pagination can duplicate or skip native tasks when the local list changes

**Source:** `job-service.ts:375-400` exposes one numeric aggregate cursor but recalculates native offset as `cursor - local.length` using the *current* local length. Local TaskManager retention/list membership can change between pages. If local count changes, a later aggregate page shifts the backend native cursor, duplicating or skipping native rows. The backend contract itself treats a cursor as potentially stale and validates it (candidate `DieTaskService.ts:265-267`). Root also discards backend `nextCursor` and synthesizes an aggregate offset.

**Reasoned reproducer:** page 1 with one local job and native A/B at count 2 returns local+A and cursor 2. Spawn a second local job before page 2 (TaskManager appends it). Root now computes native cursor `2 - local.length(2) = 0`, so page 2 returns A/B and duplicates A. Any future local eviction/removal would produce the inverse skip. This is not a fixture mismatch; it is root composition state.

**Fix/test:** use an opaque aggregate cursor encoding a stable local/native phase and backend cursor (bounded and validated), or document/list native and local separately. Add add/remove-local-between-pages cases. If TaskManager guarantees list membership never changes for the entire service lifetime, document and test that invariant; current code does not establish it here.

## Lower-severity correctness note

- `jobs.stop` adds `cancellationRequested: true` unconditionally (`job-service.ts:442-450`) even when the authoritative backend returns `status: "completed"` or `"failed"`. This can produce a contradictory projection. Prefer deriving the marker from status/result semantics, or omit it for already-terminal tasks. A cancel-completed fixture should pin expected behavior.

## Contract checks / non-findings

- Root tool names and launch/observe/cancel/list wire shapes match the current candidate contracts and `tests/fixtures/t3-native-task-contract.json`. Native async-only behavior is intentional; I did **not** flag removed foreground waiting semantics.
- The backend's fixed cancel shape is `{taskId}`; root matches it. I did not repeat the stale proposed cancel request-ID issue.
- Stable launch identity is derived from execute tool-call ID + bridge call ordinal + batch index, is committed before launch I/O, remains deterministic after ACK/ledger eviction/restart, and does not collapse concurrent identical prompts. The current focused tests cover those important cases.
- Native output is backend-capped (64k chars), transport-capped (1 MB), and inspect byte-paged UTF-8-safely. List count/result are capped at 100; SSE accumulation is transport-byte bounded and readers are cancelled. I found no unbounded output/parser accumulation in these paths apart from the ledger-object cache above.
- Native tasks are not inserted into TaskManager and launch output is omitted, so root does not create a second completion notifier. T3 remains terminal-delivery owner. Local shell/agent TaskManager behavior is otherwise kept on the local path.
- Typed backend failure messages are not reflected, redirects are rejected, response bodies are bounded/cancelled, and adapter close is attempted on both success and error. I did not repeat removed/stale resource-review code.

## In-progress distinction

The tree is actively modified, so these may be fixed before integration. However, the current root status note describes credential-safe scoped routing, commit/lost-response replay, and bounded bookkeeping as completed and focused tests passing. Findings P0/P1 above are therefore bugs in the currently claimed-complete root path, not merely missing live integration gates. Browser/live/server soak and package acceptance remain separately unfinished as already documented and are not re-reported here.
