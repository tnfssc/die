# Main-agent fresh-source recheck

Built current Go source independently at 2026-09-13T20:48Z to validation/artifacts/godie-session-review, SHA-256 3b83979eb07e6a0f2a95d24e7d9288b55469cc997f76b5c361acf1934318b291. This did not replace implementation bin/godie.

## Session replay

Command: `python3 godie/validation/session-replay-parity.py --candidate godie/validation/artifacts/godie-session-review --output artifacts/session-replay-main-recheck`

Actual manifest in root artifacts/session-replay-main-recheck: candidate persisted-tool-restart PASS; branch history PASS; incomplete-SSE failclosed PASS; print slash literal PASS (fix verified); native provider switching still BLOCKED by Anthropic thinking setup. Baseline incomplete-SSE scenario FAIL is retained as a discovered original behavior, not normalized away. No real credentials/provider calls.

## Full CLI/terminal/config comparison

Command: `python3 godie/validation/parity.py --baseline godie/bin/die-original --candidate godie/validation/artifacts/godie-session-review --output godie/validation/artifacts/main-source-compare`

Five exact disabled-tool/update refusal cases PASS. Unknown-option diagnostic, help/version, terminal layout and custom-model fixture differ. Custom provider makes zero requests and fails before transport. These findings remain open, despite independent completion ownership/runtime/session workflows passing through supported provider routes.

Both harnesses exit zero when evidence capture completes; scenario results, not harness exit codes, determine acceptance. No whole-app parity claim.
