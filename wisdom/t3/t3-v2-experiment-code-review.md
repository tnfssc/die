# T3 v2 experiment — independent code review

Date: 2026-09-20

Scope: read-only review of the experiment bridge, launcher/activation, setup/run isolation, tests, and reproducibility against `wisdom/t3/t3-v2-experiment-acceptance.md`. I did not edit product/experiment implementation and did not start or stop a shared server. The coordinator's five passing bridge-client/isolation tests are mock/guard tests and do not change the findings below.

## Findings

### P0 — execute bridge omits a header required by the real upstream MCP server

**Sources:** `experiments/t3-v2/bridge-client.ts:52-69`, especially headers at 56-60. The same omission exists in `bridge-extension.ts:27-44`. Upstream's generated client explicitly sends `mcp-protocol-version: 2025-06-18` and says Effect HTTP MCP rejects post-initialize requests without it: `experiments/t3-v2/.runtime/upstream/apps/server/src/orchestration-v2/Adapters/piT3McpExtensionSource.ts:136-140`. Upstream's real-server client/tests also send it (for example `apps/server/src/mcp/toolkits/worktree/registration.test.ts:106-117`).

The bridge can initialize, record the returned session ID, and then receive HTTP 400 on `tools/call`. Thus the central execute-to-real-T3 route is now incompatible with the pinned real server even though the mock tests pass. `bridge-client.test.ts:8-14` and the mock MCP in `bridge.test.ts` accept post-initialize calls without validating the protocol header. So they cannot detect this.

**Minimal fix:** send the negotiated protocol in `mcp-protocol-version` on post-initialize requests (matching the pinned generated client), and preferably send `notifications/initialized`. Consolidate the two tiny clients rather than allowing their protocol behavior to drift.

**Minimal test:** run `T3ExecuteBridgeClient` against an in-process instance of the pinned Effect `McpServer.layerHttp` (with fixture auth, no external credentials), initialize, then call a harmless tool. At minimum, make the mock reject a post-initialize call missing the header. Assert session-ID replay and the protocol header.

### P0 — single child ownership is guidance-only; one execute call can launch both children

**Sources:** `bridge-activation.ts:14-17` keeps `execute` visible and just tells the model not to call `subagent()`. `bridge-client.ts:99-110` is a separate importable helper, not a replacement/interceptor for execute's built-in subagent helper. `README.md:57` admits that local `subagent()` is still available. In contrast, `RESULTS.md:8` calls no duplicate local spawn a PASS and `bridge-report.md` says duplicate delegation is excluded by “architecture and explicit guidance.”

A single execute program can call `delegateTask(...)` and `subagent(...)` for the same prompt. That creates one T3-owned child plus one Die-local child, with two completion paths into the parent. The deterministic fixture in `bridge.test.ts` only proves that an obedient scripted model chose one path. It does not meet acceptance sections 1-2, which need process-spawn evidence and zero local fallback/grandchildren.

**Minimal fix:** in T3 mode, enforce one routing surface at the execute/job bridge (reject or remove local `subagent` while the scoped T3 bridge is active), or make the existing delegate operation route to T3 rather than adding a parallel helper. Do not describe prompt compliance as structural exclusion.

**Minimal test:** have execute deliberately invoke both APIs for the same marker. Require exactly one T3 task/provider turn, zero local child process/session, and an explicit rejection for the local attempt. Repeat for a nested child and after resume/reload.

### P1 — every exported helper leaves a real HTTP MCP session behind

**Sources:** each top-level helper constructs a fresh `T3ExecuteBridgeClient` (`bridge-client.ts:100-109`). Initialization stores the server session (66, 72-80). But there is no HTTP DELETE/close path. The pinned real server creates stateful sessions and exposes DELETE termination. See `apps/server/src/mcp/McpHttpServer.test.ts:573-623`.

Every delegate/status/cancel helper call initializes a new server-side MCP session. Because execute subprocesses are short-lived and no client is reused across invocations, those sessions cannot later be closed by this implementation. Polling status can accumulate sessions until server cleanup/restart.

**Minimal fix:** add a `close()` that DELETEs with the session ID and call it in `finally` for one-shot helpers, or use a deliberately stateless supported transport. Keep task durability separate from transport-session lifetime.

**Minimal test:** instrument the real in-process server's session registry. Repeated fresh `taskStatus` calls must leave no live transport sessions while the durable task is still queryable.

### P1 — acceptance-critical ACK/delivery failure window is not tested

**Sources:** the acceptance note, section 5, needs disconnects after response bytes but before worker ACK and warns that a task read acknowledges T3 delivery. The bridge resolves the fetch directly into an execute result (`bridge-client.ts:67-69`, `bridge-activation.ts:17`), while current tests only verify a clean mock continuation (`bridge.test.ts`) or direct status/cancel responses (`bridge-client.test.ts:5-21`).

There is no evidence for the concrete failure window where upstream has returned/acknowledged a terminal status but execute or the Pi RPC process dies before the result is committed to the parent turn. Nor is there evidence that reconnecting with the known task/client request ID produces one parent-visible completion rather than loss or a second continuation. This is a proof gap, not a claim that upstream persistence itself is broken.

**Minimal test:** fault-inject immediately after the real MCP response is received and before execute tool completion is emitted. Reconnect, query the same task ID, and assert one durable summary/transfer and one parent continuation. Capture both T3 delivery state and Die worker completion state as required by acceptance.

### P1 — setup is not reproducible from a clean checkout and the launched Die binary is mutable/unrecorded

**Sources:** `setup.sh:7,14` defaults to a pre-existing untracked local repository at `.agents/research-t3-v2-pr2829`. It has no canonical remote/fetch/bootstrap path. `setup.sh:23` uses a shared clone, tying object availability to that local source repository. Separately, `bridge-launcher.ts:9-13` defaults to ignored `dist/die`, and `bridge.test.ts:82` exercises that ambient binary. README only says to build or select an already-built binary (lines 44-46). Setup metadata (`setup.sh:39`) records neither Die commit nor binary hash.

A clean checkout cannot run setup as documented, and two runs at the same upstream pin/patch can exercise different Die binaries. Deleting/moving the shared source repository can also invalidate the runtime clone's alternates. So `RESULTS.md:6-7` overstates reproducibility.

**Minimal fix:** document/fetch a canonical upstream URL at the pin (or need an explicit source argument and copy/dissociate it), and build/copy the Die executable into the ignored experiment runtime with source commit + SHA-256 in `setup-info.txt`. Make launcher/tests consume that recorded artifact.

**Minimal test:** from a clean clone with no `.agents/research-*` and no `dist/die`, run the documented setup and tests twice. Assert identical pin, patch hash, Die source revision, and binary hash.

### P1 — large research checkouts are unignored and are already visible to Git

**Sources:** root `.gitignore` does not ignore `.agents/research-*`. Current `git status --short --untracked-files=all` reports `.agents/research-t3-v2/`, `-pr2829/`, and `-pr4779/`. Measured sizes are about 474 MB, 310 MB, and 237 MB. The experiment runtime is correctly ignored by `experiments/t3-v2/.gitignore:1`. But the source research trees are not.

A routine `git add .` can stage about 1 GB of nested checkout/object data. The reports' “no commit/push” wording does not prevent this ownership/repository hygiene failure.

**Minimal fix:** ignore the exact research checkout paths (or move them outside the repository) and document staging the reviewed `experiments/t3-v2` and note files by explicit pathspec only.

**Minimal test:** materialize the documented research/setup layout, then assert `git status --short --untracked-files=all` contains no research checkout content and `git add --dry-run .` lists only intended experiment artifacts.

### P2 — setup/run accept a silently dirty runtime checkout

**Sources:** source reuse is based only on stamp, directory existence, and HEAD (`setup.sh:19-20,33`). `run.sh:15` likewise checks only HEAD. Neither checks/reset tracked or untracked changes after the patch. Tests and diagnostics stage files into the checkout, and an interrupted/manual run can leave modifications while later runs still report the pinned source.

**Minimal fix:** verify the expected patched tree/index (plus an explicit allowlist for generated files), or rematerialize/reset before every evidence run. Record the resulting tree hash/status.

**Minimal test:** alter one tracked upstream source after setup. Both setup reuse and run must reject or restore it before executing tests.

### P2 — leading-zero port offsets pass validation but can fail before decimal normalization

**Sources:** `run.sh:8` permits values such as `09000`. Line 9 performs arithmetic before line 10's `10#` normalization. Bash treats the first value as octal and errors on 8/9. The isolation test (`isolation.test.ts:8-13`) does not cover a valid-looking leading-zero offset.

**Minimal fix/test:** remove the duplicate pre-normalization arithmetic at line 9. Add `09000` and assert dry-run reaches the normal setup precondition rather than an arithmetic error.

### P2 — launcher can append the activation extension twice

**Sources:** `bridge-launcher.ts:19-21` recognizes a separate extension path argument but not the supported `--extension=/path/to/bridge-activation.ts` or `-e=/path` forms. In those forms it appends another activation, registering duplicate `before_agent_start` handlers and duplicating policy text. No launcher argument-shape test exists.

This does not itself launch two children. But it undermines the claimed “one routing surface” and makes reload/activation evidence ambiguous.

**Minimal fix/test:** parse both split and equals extension forms (prefer canonical paths), and assert exactly one activation for each accepted CLI spelling.

## Additional protocol observations

- The experiment clients' SSE parser returns the first nonempty `data:` JSON without checking for a JSON-RPC response shape or matching request ID (`bridge-client.ts:25-32`, `bridge-extension.ts:12-19`). The pinned generated client at least skips SSE data lacking `id/result/error` (upstream source 74 onward), handles an empty body, paginates `tools/list`, and sends initialized notification. These differences should be removed by reuse/conformance tests rather than maintaining a second protocol implementation.
- Redirect rejection in `bridge-client.ts:55` is a useful credential safeguard and its focused test is sound. Bearer scope is supplied only in the header, and the bridge does not expose a client-side thread/scope override. Authorization correctness still needs the real cross-parent/revocation tests required by acceptance sections 3 and 7.
- `bridge-extension.ts` is documented as a mock stand-in rather than launcher production input. Keeping it adjacent to the active bridge with divergent transport behavior is nevertheless a maintenance trap. Clearly relocate/name it as a fixture or share the client.

## Bottom line

The strongest immediate blocker is not the known combined timeout/browser gap: the active execute client cannot call the pinned real Effect MCP server after initialization because it omits the protocol-version header. Even after that is fixed, duplicate ownership is still policy-only, and the required ACK/reconnect/scoping evidence is not supplied by the green mock tests. Reproducibility and Git hygiene also need correction before another developer can safely recreate or stage this experiment.
