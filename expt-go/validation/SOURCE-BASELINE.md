# Source-built original baseline

Executed 2026-09-13T20:03Z by the main agent with:

`python3 godie/validation/parity.py --baseline ./godie/bin/die-original --output godie/validation/artifacts/source-baseline`

Binary was compiled from the current original TypeScript entry point by the implementation orchestrator without overwriting root dist. Source HEAD: 14981b44d68988261dbe056227c952671963c838. Binary SHA-256: 9db13b557954004a3b3e6f8cde3ce8a18ade8e99376b730e9be88f635e900c39.

Harness exit status: 0. Version/help returned 0; six invalid/disabled CLI cases returned 1 on stderr. Real 100x30 PTY editor/quit scenario exited 0 without timeout. Loopback fake-provider execute/background-shell/inspect scenario exited 0, made three requests, and produced no stderr. These are observations, not an assertion that Go matches them.

Raw streams, terminal frames, per-scenario status and hashes are under the artifact path above. No candidate was run and manifest explicitly records parity_claimed=false. No live endpoint or real user credentials/state were used.
