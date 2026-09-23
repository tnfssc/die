# Memory/resource audit — 2026-09-18

## Completed investigation

User-facing integrated report: [wisdom/resources/memory-resource-audit.md](./memory-resource-audit.md).
All audit agents completed or explicitly stopped when target was found stale.
No product source edits, commit, install, or release.
Durable probes and instructions: scripts/leak-audit/README.md.

Current-web final report: [current web](./leak-audit-current-web.md).
Actual bundled Bun run: [bundled web](./leak-audit-bundled-web.md).
Current web 728 targeted tests/probes passed.
Bundled v0.3.4 600 cycles+64 held subscriptions released all held FDs.
Final RSS below warm baseline, stable21 threads, no descendants.
Exact owned processes stopped.

Priorities: terminal/preview upstream backlog bounds (source-confirmed overload risk, not socket-saturation reproduced).
Aggregate completed-job RAM budget.
Provider log-sink retirement (reproduced aggregate quota bypass).
Web launcher process-tree fallback.
Unnecessary execute RPC retained listeners.
Failed desktop recording registration.
Small cache/lock cleanup.
Journal compaction preserves RAM history by design.
Normal CLI/web connection/resource teardown passed stress, but no universal leak-free claim.
Mixed CLI RSS drift and successful native-compaction/browser/full-saturation/multi-day cases remain unproven.

Important corrected nonfinding: stale preview timeout backlog claim is invalid at current pin, which disconnects host and shuts queue down on timeout.
Historical stale notes clearly marked.
Do not reuse their conclusions blindly.

## Chronological work log
User requests super-deep source + runtime investigation across CLI/web.
Do NOT kill our own die session.
Read-only product audit, isolated temp fixtures and exact owned PID cleanup only.
Base commit f9d3e5c, die 0.3.4, Bun 1.4.1.
No fix/release requested.

Workers: server source task_b584056f -> leak-audit-web-server.md.
CLI jobs task_10db421a -> leak-audit-cli.md.
Frontend task_bb58cbf6 -> leak-audit-web-client.md.
Execute runtime task_693ee42f -> leak-audit-execution.md.
Web runtime task_2764abf3 -> leak-audit-web-runtime.md.
CLI RPC soak task_6c4439dd -> leak-audit-cli-runtime.md.
Durable repro scripts under scripts/leak-audit/.
Main must review findings and integrate report, check scripts/types and avoid treating RSS as leak.

## Main verified: full journal retained despite compaction (by design, not orphan leak)
Repro: bun scripts/leak-audit/session-journal.ts.
Real upstream SessionManager.inMemory, random unique 64 KiB messages, 4 batches of 128, compaction each batch retaining 2 context messages.
Forced-GC JS heap 16.92 -> 25.01 -> 33.08 -> 41.11 -> 49.16 MiB.
Entries 0 -> 130 -> 260 -> 390 -> 520 while model context stays 2. newSession resets entries.
Allow asynchronous GC settling (~1 sec) before interpreting freed memory: heap returns 17.02 MiB.
This is intended original-history retention.
Long sessions can grow despite context compaction.
Source node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:593 (fileEntries), 770 (_appendEntry), 818 (appendCompaction adds, doesn't evict), 645 (newSession clears). Tests/history.test.ts explicitly relies on retrieving original text after compaction.
Fix cannot simply discard history.
Use lazy disk-backed journal/index if bounding process RAM is needed.

Other reviewed controls: conversation-density uses WeakMap/WeakRef/FinalizationRegistry (not strong component retention).
UI footer/task monitor teardown unsubscribes and clears clocks.
Diagnostics ring and durable dedup bounded.
History cross-session scans bounded and file handles closed.
Session-cost tracker removes missing files, but intentionally retains IDs for historical descendant sessions while files exist.

## Progress
68 focused tests passed (output-buffer, task-monitor, conversation-density, diagnostics, session-costs, history), 0 failed.
Frontend source report complete.
Medium small-entry unbounded syntax-language cache, PR handoff prompt map, lower navigation caches.
Follow-up task_accb920d is obtaining runtime proof and validating Markdown reachability.
No browser socket/terminal teardown leak confirmed in source review.

## IMPORTANT target correction at 18:44Z
`.cache/die-t3code` is STALE at 6f00d388.
Current pin is 719a76ca1dbf5490f1aa33ffb9966301e02be9a9.
Correct patched tree `.cache/die-t3code-v0042` matches pin and passes canonical patch reverse check.
Initial frontend/server source reports must be considered stale unless revalidated.
Started orchestrator task_e0f6b310 to redo current web source/runtime checks and integrate `wisdom/resources/leak-audit-current-web.md`.
Stopped stale frontend follow-up task_accb920d.
CLI results unaffected.
Real compiled dist/die current-version runtime probes may still be valid.
Inspect each.

## Main independent CLI bridge reproduction
Durable `bun scripts/leak-audit/bridge-retention.ts` uses real bridge + cancellation composition over owned in-memory Duplex streams.
After settled GC baseline 0 listeners / 0.86 MiB heap.
Every 2k sequential ACKed calls: 2k/2.34, 4k/3.11, 6k/4.34, 8k/5.10, 10k/5.87.
On clean bridge close: 0 listeners / 1.41 MiB.
Confirms scope-lifetime unbounded retained cancellation state, not permanent process leak.
Each actual execute uses this bridge.
Full source refs in leak-audit-cli.md.
Windows descendant-kill issue is source-only, and project currently ships Linux/macOS, so do not overstate relevance to current host.

Execution runtime audit complete: 83 focused tests pass.
Hundreds of execute lifecycles stable 8 FDs, 0/10 surviving descendants, last 120 executions RSS +48 KiB.
Wrapper mock-backend reproduces missing web process-group/escalation orphan path.
CLI runtime: 2k mixed turns (no FD/child drift, RSS still drifts so inconclusive heap) and 2k new-session cycles (sawtooth/plateau, 9 FDs).
Source bridge script TS overload fixed by main, full `bun x tsc --noEmit` now clean as of 18:47Z.
Stale web source worker stopped task_b584056f.
Report exists but clearly marked stale.

## Current-version web progress at 18:55Z
Current-provider note completed (leak-audit-current-web-provider.md).
Real current PiAdapter instrumentation repro confirms thread-lock Map growth across rejected or stopped sessions, small entries.
Extension compatibility task records grow during session.
Default die task projection cap=50, do not conflate.
Current web-server 3k subscription/reconnect JSON has pin+patch provenance, no errors, JS heap ~81.07MB baseline /83.39MB after1500 /83.60MB after3000 /83.40MB settled.
FD39->34, threads12, no child processes, watchers3.
Normal reconnect cleanup healthy.
Orchestrator task_e0f6b310 still gathering frontend/backpressure reproduction and report.

## Final integration checkpoint 18:58Z
Draft user-facing report: wisdom/resources/memory-resource-audit.md (CLI/execute findings integrated.
Web sections still pending).
Await current web orchestrator task_e0f6b310 and final actual Bun binary web gap probe task_65448d53 (new).
Original stale web runtime task_2764abf3 completed.
Its note clearly marked stale, excluded from current conclusions.
Current source Node instrumentation is good but cannot stand in for shipped Bun allocator.
Final gap test uses compiled dist/die web.
Main formatted 5 TS probes and started typecheck + bridge/journal rerun task_2ea71efc.
No product code edits.

Final validation: full root `tsc --noEmit`, `git diff --check`, canonical current web patch reverse check. Node parse checks for all audit MJS probes passed.
Re-ran all 12 focused core files together: **151 pass, 0 fail, 1,141 expectations, 18.55s**.
Main bridge and journal durable probes reran successfully after formatting.
Current-web suites independently total728 passing tests/probes.
Full project test suite was not run.
