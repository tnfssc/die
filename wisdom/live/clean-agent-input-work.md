# Clean GPT client-delegation work

Integration branch: die/clean-gpt-live-coding-agent-input-7bbf3261. Base d9a2d32bd394faccb80da0c14e81d30eecebb1e3. Workspace /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7bbf3261.

Durable worker worktrees all use this prefix:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_7bbf3261-a86675007a5e-task_

- 499ed0a4, die/clean-live-model-input-implementation-499ed0a4: first production patch 7951c06. Integrated, then corrected; not sufficient alone.
- 0d9027e2, die/independent-live-semantics-review-0d9027e2: original read-only semantics review.
- ab6a9f1d, die/real-provider-capture-and-tui-clean-voic-ab6a9f1d: exact provider capture/tests 8e8e0e6, 06b6d0b, 30e10cd. The first TUI fixture and first after model assertion failed; no false pass claimed.
- cbf61d60, die/focused-consumption-and-replay-review-cbf61d60: read-only review found admission, reservation, legacy leakage and overlap defects; corrected in integration.
- 75b4f1e9, die/complete-metadata-replay-and-uncertainty-75b4f1e9: provenance/filter/reverse path patch b84347c, integrated with further minimal uncertainty and admission corrections.
- 76f9e21d, die/final-clean-input-semantic-review-76f9e21d: found pending-eviction false omission; integration now distinguishes admitted/rejected evictions and acknowledges omission counts monotonically.
- 73c6da26, die/fix-and-prove-actual-spoken-tui-capture-73c6da26: actual TUI proof 8a75c42. Root rerun also passes.
- 7ecbebe4, die/final-replay-projection-and-omission-fix-7ecbebe4: final read-only replay/omission review.

Integration revisions include cff57d2, 5e0f3fa, c71decd, 49bf6fb, eb29e1b, 12dba00, c2467cb, 3576574, 480da1e and ee73b61. Exact before/after artifacts and rationale are in clean-gpt-model-input-evidence.md. Source changes are frozen for final validation at ee73b61; later documentation may be added.

103 targeted tests passed across bridge, request rendering, reverse context, passive-history projection, extension, actual Pi integration, host access and paired runtime. A later host/passive check passed 21 tests. TypeScript check passed. Real tmux capture passed 1 test / 8 assertions. The first broad run was not a final gate: shared /tmp transcript snapshot quota caused three failures, an old host test still expected the removed sermon, and source changed during the run. Host expectation was corrected, isolated TMPDIR rerun passed the affected tests, and final full-suite validation uses a dedicated temporary root. No existing shared snapshots were deleted.

No push, release or install. Device/paid-provider/ASR-quality checks are not performed. Values stayed unchanged: existing values already cover honest bounded context, actual user/agent surfaces and whole-path proof. Input audit updated; no new global rule needed.

Final independent review task_7ecbebe4 accepted ee73b61 with no concrete blocker. Its isolated check passed 55 tests and TypeScript. The earlier pending-eviction finding is covered by admitted and rejected eviction regression cases.

Final frozen-source gate (ee73b61): matching CLI built with scripts/build.ts --reuse-web; isolated TMPDIR full offline suite **1175 pass, 17 skip, 0 fail**, 28,104 assertions across 164 files (116.27s). The 17 paid/device/provider tests are skipped, not passed. Reused unchanged web assets were copied privately from the main checkout; no install or release. git diff --check passed.
