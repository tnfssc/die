# Internal work coordination

- setup/UI worker owns setup/run scripts and dependency installation. Harness worker should reuse its experiment .runtime checkout/dependencies where possible.
- harness worker owns all upstream edits and upstream.patch capture.
- bridge worker owns bridge extension/launcher/tests.
- coordinator owns README, audit-isolation.ts, protected-baseline.json, final evidence and notes.

2026-09-20 16:47 UTC: upstream checkout initially has no node_modules. All installed deps/output/state MUST remain experiment .runtime or tmp (not tracked build artifacts). Shell helper is fish: wrap POSIX snippets with bash. Coordinator running local unchanged CLI regression tests (subagent-extension, typescript-execution, typescript-runner).

Please prioritize a combined real PiAdapterV2 -> actual Die executable -> execute bridge -> session-scoped real MCP -> real v2 engine lifecycle with deterministic provider if practical. Separate component passes are not combined E2E proof. State that boundary clearly.

16:54 UTC: First engine harness PASSES and standalone Die RPC visibility probe PASSES. Coordinator requested two followups: combined worker task_6f600d38 for actual PiAdapterV2+Die+real MCP path. Bridge worker task_0aabba89 to replace activation-only with delegation FROM execute (importable client helper, no root edits). Bridge worker owns all bridge*. Combined worker reads launcher, owns combined* and patch. Final README must not call independent component tests end-to-end.
16:59 UTC bridge followup COMPLETE: `bridge-client.ts` now exports execute-importable `delegateTask`. Launcher guidance gives its absolute path, only `execute` is model-visible, and deterministic actual Die execute proof observes exactly one `delegate_task` call/result. `bridge-report.md` updated. The old activation-only “execute + MCP tools” result is superseded. Call it an incomplete alternative, not current evidence. PiAdapterV2 injected extension arguments remain loaded for approval hooks. Coordinator: update README evidence/PENDING wording after combined task_6f600d38 reports its boundary.

2026-09-20 17:03 UTC: combined worker ran upstream Pi/injection suite (51/51 pass), attempted real PiAdapterV2 -> dist/die fixture. openSession+ensureThread reached. Full prompt/lifecycle and child scope did not settle. Added only combined* experiment files/report. Removed runtime test and did not touch upstream.patch to avoid harness-owner race.

## IMPORTANT coordinator review findings — 17:14 UTC
Independent review is done: READ .agents/notes/t3-v2-experiment-code-review.md before claiming combined real-server pass. bridge-client.ts AND bridge-extension.ts omit mcp-protocol-version header required post-init by real upstream Effect MCP (upstream piT3McpExtensionSource.ts:136-140). The mock accepts it by mistake. Fix this with a protocol validation test or real server. Local subagent remains callable: no duplicate local launch is only scripted guidance, not enforced. Keep results honest or gate local delegation in explicit experiment mode. One-shot helper sessions need cleanup. Clean setup/binary selection reproducibility findings too. Main not editing your owned implementation, please incorporate review fixes.

17:15 UTC followthrough: real combined direct+bridge prompt/scope tests now pass (it.live fixes TestClock frozen grace finalizer). Coordinator review read. Active bridge-client now sends protocol header, matches SSE request IDs, DELETE-closes one-shot sessions (integrated worker please reuse current). Runtime mock rejection test also proves local subagent helper remains callable, no policy enforcement claimed. The detailed causal worker and real-engine/browser workers are active.

2026-09-20 17:58 UTC final followthrough: real engine + production credential manager + HTTP MCP + PiAdapterV2 + Die now passes. Parent completes naturally, child success/cancel/retry/auth/OS-spawn evidence in integrated-process-proof.json. Actual closed engine SQLite snapshot renders in Chromium, native parent→exact-child click + refresh + tool/result markers once. IDs match OS/engine evidence. All worker jobs and owned ports stopped. README/RESULTS/reports updated. Root notes remain coordinator-owned. Fold followthrough-progress.md after review. Still no runtime local-helper exclusivity or ACK-fault/nested/live-provider-reconnect acceptance claim.
