# Active execution-row UI cleanup

User wants original die TUI (Go experiment deleted):
- Execute success/handoff: ✓ executed · code preview
- Execute failure: ✗ execute failed · code preview
- Task completion: ✓ task_ID executed or ✗ task_ID failed; batches comma-separated individual outcomes
- One empty row before subsequent model prose, not thinking
- Follow-up: old ✓ Execution completed · exit0 · 1 preview truncated — 1 output file — con... becomes ✓ executed · truncated · con...; suppress output-file counts, plain truncated indicator, dot separators.

Workers: task_df929d67 owns src/ui/execution-previews.ts + focused tests, task_bea01c6c owns conversation-density.ts + tests. Both launched before truncation follow-up; main must incorporate follow-up during integration. No prompts/provider/session wire changes. Need real compiled PTY/fixture validation and relevant build/check tests; not installed unless explicitly chosen.

Integration: labels + spacing implemented, 50 focused tests and typecheck/build passed task_8e816d24. Final PTY task_2c455164 running (six loopback requests; prior run all product behaviors correct but probe had stale emdash expectation and tmux warning interfered with direct-prose boundary; fixed probe token and private tmux csi-u setting). dist/die rebuilt; ~/.local/bin/die NOT installed.
User interrupted to investigate native compaction coverage warning, task_fcbdec9c owns read-only investigation of exact current session event. Compaction entry a67410ef at 2026-09-14T07:09:13.397Z, firstKeptEntryId fe73662d, fallback strategy cache-affine-plaintext. No compaction source changes authorized/performed yet.

Final actual compiled TUI verification passed task_2c455164: six loopback requests; inspected plain terminal evidence confirms success/failure/truncation/handoff, comma-separated mixed task outcomes, one blank before direct prose, none before thinking, internal thinking→prose blank preserved. Evidence artifacts/ui-cleanup-final-{plain,ansi,requests,report}.*. Probe additionally exercises direct prose + toolcall after status; private tmux csi-u prevents unrelated warning from interrupting boundary. UI cleanup remains uninstalled/uncommitted.

Final combined verification COMPLETE task_c4974509:108tests584assertions passed across native/cache-affine SDK/UI suites; typecheck/build/diff and focused formatting passed. Actual final compiled CLI PTY six loopback requests, every assertion passed (labels/truncated/handoff/batch/prose/thinking). Owned validation temp cleaned. dist/die contains both fixes; installed ~/.local/bin/die unchanged. No commit/push/install.
