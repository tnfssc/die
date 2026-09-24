# v0.11.0 combined release (2026-09-24)

Integration worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_9659e524`; branch `die/release-combined-voice-controls-transcri-9659e524`. Merged reviewed controls through e584b62 with diagnostics branch `die/trace-compiled-realtime-failure-5010a15e` through e91b2fd, retaining both extension edits. Remote develop was 95eae2c and latest stable v0.10.2 at preparation. Next stable is minor v0.11.0 for added scoped controls. No force push or tag overwrite.

Read values, scoped-execute-controls, realtime-production-transport-investigation, and exact-SHA release reuse. Release notes distinguish the proven dropped safe diagnostic UI fix from the unknown authenticated OpenAI failure, and disclose steering latency and detached-descendant uncertainty. No user jobs/devices/provider APIs/keys or local CLI installation used.

Local release-workflow regressions: 17 passed after installing locked workspace dependencies (initial run lacked node_modules). Formatter found one long line in controls extension; formatting-only fix applied. Combined offline regression evidence and hosted gate/publication results follow below. Full release gates run on develop; tag reuses only verified exact-SHA staged assets and repeats required packaged Mac updater/helper gate.

Values reviewed unchanged: existing whole-product proof, truthful observations, one-owner lifecycle, user-work safety and durable evidence cover this release; no new universal rule needed.

## Verified combined evidence

- Local combined suite: 134 passed, 0 failed across 9 files (stop-work, foreground-stop, local-agent-termination, live-extension terminal errors/self-stop, live-transcript, GPT-Live delegation/session, OpenAI session, audio lifecycle), fresh TMPDIR and SHELL=/bin/sh. Local format/typecheck passed; release regressions 17/17. Worker task_e734e9eb inspected merge but could not run Bun from PATH; its report is not test evidence. Parent used explicit Bun 1.4.2 tool path.
- Full develop release gates: https://github.com/tnfssc/die/actions/runs/36008226424 succeeded at cc2bde196c4f5dbe3d4daf6323876032c4dc62fd. Deterministic tests: 1031 passed, 17 skipped, 0 failed, including compiled live-execute-controls and stop-work. Backend 67, web cache 135, terminal client 38 tests passed. Formatting, lint, typechecks, native no-device tests, standalone smoke, all four cross-builds, notices, Linux and Mac actual v0.7.1 updater and packaged helper gates passed. Linux updater verified failed checksum preserves executable and successful replacement reports 0.11.0.
- Annotated v0.11.0 tag points to that exact tested commit; initial tag creation needed explicit message because configured editor cannot open a TTY. No existing tag was replaced. Tag publication workflow: https://github.com/tnfssc/die/actions/runs/36009470886.

## Published and verified

https://github.com/tnfssc/die/releases/tag/v0.11.0 is published, non-draft, non-prerelease, and returned by releases/latest. Tag workflow succeeded; exact-SHA reuse and staged checks passed, full build was correctly skipped, packaged Mac updater/helper and publication passed. All 12 expected assets are nonempty: four platform binaries/checksums plus LICENSE, SOURCE and both third-party notices/license files. Downloaded checksum manifests match GitHub binary digests for all four platforms. Downloaded SOURCE.txt identifies cc2bde196c4f5dbe3d4daf6323876032c4dc62fd, v0.11.0, embedded T3 revision b488c57f3f9f1688e31c53daee99e29dd1d0baa2 and embedded Mac helper hash 5debb891190dd1b296af57e4128a85598e97cb97904e49a2a803d01bd11216fd. No local product installation performed.

Update: `die update`, exit/restart die, `die --version` must report 0.11.0. Retry `/live provider openai`, `/live model gpt-realtime-2.1`, `/live status`, `/live start`. Keep saved key; report sanitized error/model only. User retry may incur API charges. UI diagnostic fix is proven; actual remote rejection cause remains unknown.
