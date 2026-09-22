# Rendered actual-child proof — final independent rerun

**PASS for durable real-engine state navigation and refresh. Not a simultaneous live-provider browser run.**

The final capture serves a copy of the **closed file-backed SQLite database actually written by integrated-process-proof.sh**. It does not synthesize/replay thread events. browser-live-seed.ts verifies all125 exported real event IDs already exist and adds only project-list metadata. The earlier replay-fixture screenshot is not used for this claim.

- Parent: thread:integrated-real-parent
- Exact successful child: thread:delegated-task:command%3Amcp%3A6c95953b-0422-497a-8545-8c36ed62ac78%3Adelegate-task%3Aintegrated-stable-success
- Native parent relationship click: INTEGRATED_SUCCESS_CHILD / completed.
- After navigation, page refresh retains that exact child route.
- Expanded real execute event displays INTEGRATED_CHILD_TOOL_EVENT; assistant transcript displays INTEGRATED_REAL_RESULT_7bde9d. Both occur **once** in rendered body before the evidence overlay.
- Captured IDs are asserted equal to integrated-process-proof.json's successful child, joining actual engine/process evidence to UI evidence.

Evidence: browser-live-parent.png, browser-live-child-navigation.png, browser-live-proof.json. Child screenshot SHA-256: b31fc814d771ff6722cf7f973f25ccabf00ff7b52a813641712d4a09b7d862e4.

Original engine database SHA-256: c4ebb6876912181fd7b593c1582214965be5a13d9f75cdf0bf9f48c1c844f073.
Original exported result SHA-256: 893bf90856603de69d37934af0ec9b8802c8423c4b5fb83a72b33508c569398d.

Chromium148 with an isolated profile/cache renders the actual T3 UI. The experiment-local TMPDIR avoids the host /tmp resource failure. Normal pairing stays scoped to the browser proof; no token is printed in evidence. Ports30733/38773 and all owned processes were stopped after capture.

## Reproduction

1. Run integrated-process-proof.sh (no paid model).
2. If necessary, install Chromium into .runtime/browser-cache using the command in browser-followthrough.md.
3. Run browser-live-prepare.sh. It refuses existing proof state instead of overwriting it; preserve/move aside browser-live-final-state and browser-live-profile-final for a different engine run.
4. Run browser-live-run.sh redirected to .runtime/browser-live-dev.log.
5. From experiments/t3-v2, run browser-live-followthrough.mjs with TMPDIR=$PWD/.runtime/browser-live-tmp and PLAYWRIGHT_BROWSERS_PATH=$PWD/.runtime/browser-cache. Stop the owned server afterward.

The script checks route/markers after refresh, writes sanitized evidence, and closes Chromium in finally even on failure. The screenshot explicitly labels the closed-engine/provider-stopped boundary.

No production state, root source/pins/binaries, private credentials, or upstream.patch were changed. This proves durable rendering/reconnect to the UI projection, not provider-session reconnection, server/worker-ACK failure windows, or nested real-adapter closure.
