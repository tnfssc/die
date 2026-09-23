# Evidence matrix — followthrough (2026-09-20)

**The tests now show real deterministic engine flow and a rendered durable child. They do NOT show full acceptance or adoption.**

| Requirement | Result | Evidence / boundary |
|---|---|---|
| Shipped pin, patch, dist binary preserved | PASS | audit-isolation.ts matches protected-baseline.json; no root product edits |
| Exact reduced timeout cause | PASS | clock-probe.sh: real processes exited, fake-clock finalizer pending at 999ms, completes at 1000ms; it.live contrast; 2 tests |
| PiAdapterV2 → Die prompt and teardown | PASS | combined-probe.sh: direct + launcher/grandchild, actual execute, terminal event, clean scope; 2 tests, explicitly mock MCP echo |
| Real T3-owned delegation | PASS, deterministic HTTP model | integrated-real-probe.sh: real orchestration + file-backed SQLite + Effect MCP + production scoped credential manager + PiAdapterV2 + actual Die; parent completes naturally |
| Stable request retry | PASS, real engine | same clientRequestId twice, one success child/run; one intentional cancellation child |
| Result delivered once, clean path | PASS | acknowledged delivery, one consumed success result transfer, one parent execute result marker, one final parent message; integrated-process-proof.json |
| Cancellation | PASS, real engine | waits for the cancellation child’s actual held model HTTP request, then two cancel calls; child interrupted, delivery disposed; parent completes; provider PIDs all reaped |
| Duplicate local spawn | PASS only for scripted scenario | strace: 3 provider RPC processes + 2 execute workers + 0 local subagents. General subagent() remains callable; **no runtime exclusivity policy** |
| Real scoped authorization | PASS, bounded cases | missing bearer401; stale inherited values ignored; distinct parent/child scope; sibling read/cancel task_not_found; revoked initialized transport401. Test-local middleware delegates to production registry |
| Rendered actual child navigation | PASS, durable snapshot | Chromium parent relationship → exact successful child; refresh; real child tool marker + result marker once each. browser-live-proof.json and screenshots; exact IDs match process proof |
| Single-server live browser/engine E2E | NOT CLAIMED | UI renders copy of closed real engine SQLite DB; only project metadata added, no synthesized thread events |
| ACK/network restart fault windows | NOT PROVEN | No Die worker-ACK disconnect injection or live provider reconnect/server-restart matrix |
| Nested child closure / nested auth | NOT PROVEN with real adapter | Earlier service/replay fixture only; do not infer real nested acceptance |
| Adapter/injection regressions | PASS | rerun 51 tests / 2 files |
| UI unit regressions | PASS | rerun 16 tests / 3 files |
| Existing service harness | PASS, mock providers | rerun 1 passed / 1 skipped; not the real-engine proof |
| Existing local CLI regression | PASS | rerun 65 tests / 252 assertions / 3 files |
| Bridge/client/launcher/isolation | PASS | 15 tests / 58 assertions; protocol header, DELETE, SSE IDs, runtime rejection, helper availability, launch dedup and isolation |
| Focused bridge TypeScript | PASS | noEmit focused bridge files; no production source changed |
| Reproducibility review | PARTIAL | new setup canonical fallback/dissociation, dirty-tree checks, decimal ports, recorded binary hash; clean no-binary build/provenance not established; setup-report.md |
| Paid model | NOT NEEDED / NOT RUN | all model traffic in proof is deterministic loopback; no private credentials read/modified |

Primary reports: integrated-real-report.md, combined-report.md, clock-report.md, browser-live-followthrough.md, bridge-followthrough.md. Earlier browser-followthrough.md is only a provider-replay fixture and is superseded for actual-child proof.

All owned experiment ports/processes were stopped after capture. Root progress-note updates remain coordinator-owned; followthrough-progress.md contains the reviewed-note source.
