# Native compaction coverage warning investigation

User asked why warning occurred, then to find cause.
No compaction source edits made.
Worker task_fcbdec9c investigated main session 2026-09-13T19-33-27-590Z_01a09c42-a1a6-742e-bb42-a0a65af980bc.jsonl.

Finding: coversDiscardedMessages in src/tasks/native-compaction.ts:426 compares JSON.stringify of whole AgentMessages including timestamps.
Pi live custom messages use Date.now(); persistence appendCustomMessageEntry independently uses new Date().toISOString(); compaction reconstructs custom message timestamp from persisted entry.
A millisecond difference yields false missing-message coverage failure.

Event: fallback compaction a67410ef at 2026-09-14T07:09:13.397Z, firstKeptEntryId fe73662d, strategy cache-affine-plaintext, priorPayloadAffine false.
Required572 messages +3 turn prefix.
Identified suspect is required[572], first turn-prefix custom task-complete message 2a1463ed (line954), task_1f86111b.
Persisted timestamp 1789368711432 (06:51:51.432Z); surrounding runtime/tool evidence points to live1789368711431.
Native capture leaf a5edb0d5 line1034 beyond boundary line958, so boundary guard passes.
No manual-shake/goal projection in branch.

Epistemic limit: live native capture is memory-only, not persisted.
The exact captured timestamp cannot be independently retrieved; 1ms live value is inferred, not directly proven.
Worker reports timestamp reconstruction as cause; final should preserve this caveat instead of claiming unseen value is certain.
Concrete timestamp comparison defect confirmed by source path.
Initial explanation about newer messages was only a guess and this investigation points elsewhere.
No native request dispatched; plaintext fallback succeeded.
Next if asked: narrowly fix stable coverage matching without ignoring content/order or weakening genuine missing-message guard, add regression live vs reconstructed custom timestamps.

User authorized continuing/fixing.
Worker task_28d68b5f owns src/tasks/native-compaction.ts + focused tests, narrow custom-message timestamp normalization only; preserve content/details/type/order/multiplicity and boundary guards.
Main to review patch and run combined native/cache-affine SDK/UI checks with owned home-filesystem TMPDIR (/tmp full), build final binary, no install/commit requested.

Fix implemented/reviewed: coverageMessageKey strips only top-level timestamp on role custom, all other messages unchanged.
Worker35 native tests passed.
Parent added changed customType/display/details rejection tests;35tests144assertions passed.
Combined108test first run107pass1fail because TUI fixture under home TMPDIR hit trust prompt (not compaction regression).
Added explicit --no-approve to offline saved-session TUI fixture, which loads no project code.
Final combined check/build/tests/actual CLI PTY task_c4974509 running.
Owned temporary directory /home/tnfssc/.cache/die-validation-JXCduo may be removed after job completes.
Still not installed/committed.

Final combined verification COMPLETE task_c4974509:108tests584assertions passed across native/cache-affine SDK/UI suites; typecheck/build/diff and focused formatting passed.
Actual final compiled CLI PTY six loopback requests, every assertion passed (labels/truncated/handoff/batch/prose/thinking).
Owned validation temp cleaned. dist/die contains both fixes; installed ~/.local/bin/die unchanged.
No commit/push/install.
