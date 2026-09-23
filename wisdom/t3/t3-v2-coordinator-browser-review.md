# T3 v2 coordinator browser verification follow-up

Date: 2026-09-20 (UTC)

## Scope and result

This pass only refreshed the independent UI evidence. I did **not** rerun `integrated-process-proof.sh`, change feature or production code, or use a paid model. I ran the current browser-live scripts against the new, closed real-engine SQLite database. Result: **PASS**.

## Procedure

1. Confirmed no pre-existing experiment browser-live listener/process was active.
2. Preserved the preceding browser state/profile by moving experiment-owned runtime directories to:
   - `experiments/t3-v2/.runtime/browser-live-final-state.previous-20260920T180553Z/`
   - `experiments/t3-v2/.runtime/browser-live-profile-final.previous-20260920T180553Z/`
3. Preserved the preceding JSON proof as:
   - `experiments/t3-v2/browser-live-proof.previous-20260920T180553Z.json`
4. Ran `experiments/t3-v2/browser-live-prepare.sh`.
5. Started `browser-live-run.sh` on its owned ports (UI 30733, backend 38773), then ran `browser-live-followthrough.mjs` with the experiment-local Chromium cache/profile.
6. The capture exited 0. I stopped the owned server with SIGTERM and verified no listeners remained on 30733/38773 and no owned Chromium/browser-live processes remained.

No pairing/auth value is recorded here.

## Verified current IDs and markers

- Parent thread: `thread:integrated-real-parent`
- Exact success child thread: `thread:delegated-task:command%3Amcp%3A6be5ccee-7bfb-4def-857f-81387fb1a1a2%3Adelegate-task%3Aintegrated-stable-success`
- Cancel sibling thread present in the snapshot: `thread:delegated-task:command%3Amcp%3A6be5ccee-7bfb-4def-857f-81387fb1a1a2%3Adelegate-task%3Aintegrated-stable-cancel`
- Rendered child markers, each observed once after refresh:
  - `INTEGRATED_CHILD_TOOL_EVENT`
  - `INTEGRATED_REAL_RESULT_7bde9d`
- Direct child count: 2
- `refreshed`: true

The browser proof child ID exactly equals `integrated-process-proof.json.engine.successThreadId`. The capture navigated from the rendered parent relationship entry to that exact child route, refreshed the page, and revalidated both transcript markers. Visual inspection of the resulting screenshots also confirms the parent view and the exact-child banner with the refreshed-transcript marker.

## Current evidence

- Machine-readable proof: `experiments/t3-v2/browser-live-proof.json`
- Parent screenshot: `experiments/t3-v2/browser-live-parent.png`
- Exact child navigation/refresh screenshot: `experiments/t3-v2/browser-live-child-navigation.png`
- Capture log: `experiments/t3-v2/.runtime/browser-live-followthrough.log`
- Dev server log: `experiments/t3-v2/.runtime/browser-live-dev.log`

Source hashes recorded by the refreshed proof and independently rechecked after cleanup:

- `.runtime/integrated-real-state.sqlite`: `ffe4d964bd08445ca0ee402aa9ddbc7a540e55457ea9d5ac0ee5f03077b35f1e`
- `.runtime/integrated-real-result.json`: `6845fa9acadd1ddd5f484a7b16eaa28b7d8f976afba81e4efa77836e7b6355bd`

These backend artifacts were not overwritten during this follow-up. The timestamped JSON above is historical and references the preceding run; the un-suffixed browser proof/screenshots are the current matching evidence.
