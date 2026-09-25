# Web live release work — 2026-09-25

User asks for screenshots, push and release after web live + CLI cost implementation.
Root branch develop, origin git@github.com:tnfssc/die.git. Started from129d51f, package0.11.2. No push/tag/publication yet.

Screenshot task_31f162fb owns isolated worktree (see jobs metadata), captures actual packaged UI if possible or clearly labeled production-control fake-provider fixture. No private chats/keys/paid probes.
Read-only release audit task_9d6c9cdc determines remote/version/tag procedure. Parent owns publication after checks.

Parent found14 formatting errors and3 lint errors in new source/tests. Formatted own feature files; renamed test constructor parameter; changed browser gate cleanup to preserve primary and cleanup errors outside finally. Format/lint/typecheck now pass. Added canonical voice route/pipe and shipped controller/UI regression tests to shared CI and release workflow. This follows the shipped-copy lesson, not test weakening.

Full shared Linux CI job task_a0303882 running with process-local installed pnpm path and exact durable pinned checkout at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6394ca7b-a86675007a5e-task_86494437/.cache/die-t3code-b488c57f3f9f1688e31c53daee99e29dd1d0baa2. Log /tmp/die-live-release-ci.log, retained stage logs artifacts/ci. Do not use /tmp as source/release checkout. No trust settings changed.

Need integrate screenshot artifacts, choose correct unused version, commit, push develop, await remote CI/release dry-run at exact commit, then tag/publish through workflow. Follow wisdom/releases/release-verification-preference.md: do not re-download release binaries just to rehash them. Check workflow success and assets instead. Preserve real-device/provider limitations in release notes.

Read-only audit confirms remote latestv0.11.2, develop1d25174; recommendsv0.12.0 for feature release. Prepared support/release-v0.12.0.md with explicit PCM/performance and untested-device limits. Version bump waits until current preflight finishes so compiled-version tests do not race source version. Parent-only formatting/lint/CI changes above are intentional release work, not another user’s edits.

Release candidate version now0.12.0. Tag validator, release-note selector and frozen install pass. First full shared CI reached upstream backend267 pass/1 fail: integration test inferred compiled binary from external source checkout and hitENOENT. No product assertion failed. scripts/ci.sh now supplies its own just-built dist/die via existing T3_V2_DIE_BINARY contract, preserving explicit overrides. Rerun task_30110e6e underway after version bump. Parent will not tag until same-SHA remote CI/dry-run pass.

Screenshots integrated from31f3455 as1c4860d under docs/screenshots/web-live (sixPNG, evidence and capture script). They are clearly labeled canonical-control fixtures, not full packaged active UI; empty HOME packaged app had no usable model. Parent viewed desktop and narrow connected images and shared links. No paid calls/private data.

Second full CI passed upstream backend gates and reached root suite1146 pass/17 skips/1 fail: session-boundaries.test rejects direct agent-core import of live/web-ipc-bridge introduced by feature. Fix task_5b90db7c is in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5b90db7c, branch die/fix-web-voice-session-dependency-boundar-5b90db7c. Must restore feature ownership, not weaken boundary test. No push/tag yet.

Boundary fixd495b60 integrated as6e5dbb1: live extension owns private web IPC, agent core remains voice-neutral; targeted tests/compiled RPC smoke passed in worker. Screenshot request callback needed explicit structural type after full typecheck; fixed9b10107. Full shared CI rerun task_de3fc0b5. Remote fetch confirmed no divergence (0 remote-only,49 local-only at that point); authenticated gh available. Fetch emitted existing RSA-key warning but succeeded through configured auth; no auth settings changed.
