# Followthrough completion — coordinator note source

Root notes remain coordinator-owned. Fold this into .agents/notes/t3-v2-experiment.md after explicit review; no root file was changed by this followthrough owner.

## Demonstrated

- Exact old reduced timeout: PiRpc SIGTERM then one-second uninterruptible grace on frozen TestClock. Real processes may already be gone. 999ms adjustment leaves scope pending, final1ms releases it; it.live fixes real prompt+teardown without longer timeout.
- Actual real-engine success/replay/status/cancel: real upstream orchestration/file-backed SQLite + production credential lifecycle + real MCP HTTP + PiAdapterV2 + unchanged Die + deterministic loopback model. Parent now completes naturally. Initial engine parent hang was a model-fixture classifier erroneously matching cancellation text in parent tool output; role/thread routing fixed it.
- Real successful child emits execute tool marker plus final result. Stable-ID retry leaves one success run; second intentional child is interrupted with disposed delivery. Clean result delivery acknowledged with one consumed successful transfer and one parent-tool marker.
- Real auth tests: anonymous401, stale inherited credentials ignored, distinct parent/child credentials, sibling read/cancel rejection, revoked initialized transport401. Middleware is a test-local bearer-resolution copy using production registry; not full app-server authentication-stack adoption.
- OS execve evidence: exactly3 provider RPC Die processes,2 execute workers,0 local subagents for this scenario. All provider PIDs reaped. General local helper remains callable; no runtime exclusivity claimed.
- Chromium navigates from this exact real-run parent to child, refreshes and renders tool/result markers once. UI reads a copy of the closed real engine SQLite database; only project metadata added. Exact child IDs/hash/process proof linked in browser-live-proof.json; screenshots checked visually. Not a simultaneous live-browser/provider claim.

## Reviewed fixes

Required MCP protocol header, response-ID-aware SSE parsing, DELETE cleanup for one-shot clients, shared fixture transport, activation argument dedup, leading-zero port validation, canonical setup fallback/independent new clone, explicit dirty-tree checks and binary hash metadata. Existing binary build provenance and clean no-binary bootstrap remain unverified. Production pins/binaries and installed state remain unchanged.

## Reruns

- Combined real adapter/mock MCP:2/2.
- Causal real-process clock:2/2, independently rerun.
- Real engine + OS process proof:1/1, repeatedly rerun; latest IDs in integrated-process-proof.json.
- Adapter/injection:51/51.
- UI unit:16/16.
- Earlier mock-provider service harness:1 passed,1 skipped.
- Bridge/client/launcher/isolation:15/15,58 assertions.
- Existing local CLI:65/65,252 assertions.
- Focused bridge/browser-seed TypeScript and shell syntax checks pass.
- Protected artifact hashes match. Owned experiment ports/processes stopped; only expected upstream.patch modification remains in the staged checkout.

## Still not full acceptance/adoption

No worker-ACK/network-disconnect failure-window matrix, live provider/server-restart resume, real-adapter nested closure, or arbitrary-model local-duplicate enforcement. These must not be inferred from the now-green integrated clean path. See RESULTS.md and individual reports. No paid model or private credential use was needed.

18:03 UTC final strengthening: cancellation waits for the child’s actual held model HTTP request rather than a300ms guessed delay; exactly one cancellation model request asserted. Real engine/process proof rerun passed with reaped-PID assertions. Browser independently recaptured from that exact new closed DB (125 verified stored events), parent→child+refresh, tool/result markers once, IDs match process proof. Prior browser-owned state/profile preserved aside rather than overwritten. All owned server/browser processes stopped again.
