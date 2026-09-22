# Rendered-browser follow-through

Date: 2026-09-20. Scope: isolated T3-v2 experiment only.

## Result

**PASS for rendered parent → durable child navigation using upstream's deterministic replay fixture.** This is **not** a live-provider, Die-adapter, MCP-auth, or full combined-chain pass. The fixture was materialized by the real upstream `subagent_v2_nested/codex` orchestration replay harness (1 test passed, 72 skipped), written into only the experiment's durable SQLite state, and truthfully labeled in the screenshot.

Chromium 148.0.7778.96 (Playwright build 1223) rendered the full T3 web app with a fresh isolated profile. Normal one-time pairing succeeded; the token is not recorded. The run used private offset 23000: UI 28733, backend 36773. Both were stopped afterward.

## Browser evidence

- [browser-parent.png](browser-parent.png), SHA-256 `932034c501d2fb6934769fcff992fadab76985fcdf179b9d1a111c5ccbd4a95a`: rendered parent transcript and native **Previous agents → Hello Agent** relationship entry.
- [browser-child-navigation.png](browser-child-navigation.png), SHA-256 `e6c38535a018a8470a25fa9f24b3b2232a4ade3772e4b479fef2b0c268c2afbb`: rendered child after clicking that parent entry. It visibly contains **Subagent of · Replay fixture: subagent_v2_nested**, **Ran 1 subagent**, marker **Subagent says: “Hello.”**, lineage back to the parent, and a yellow evidence banner identifying the fixture boundary and exact child ID.
- Browser assertion checked the post-click URL decodes to the exact expected child ID and checked the marker in rendered body text before taking the screenshot.

Observed IDs/state:

- parent thread: `thread:fixture:subagent_v2_nested:project:project%3Afixture%3Asubagent_v2_nested%3Af2604e9d-55b7-45de-a716-838867faae7e:0f2eb5a3-17c3-45d8-831a-e78b17f6c3d7`
- parent run: `run:thread:thread%3Afixture%3Asubagent_v2_nested%3Aproject%3Aproject%253Afixture%253Asubagent_v2_nested%253Af2604e9d-55b7-45de-a716-838867faae7e%3A0f2eb5a3-17c3-45d8-831a-e78b17f6c3d7:ordinal:1` (completed)
- selected child: `thread:provider:codex:native-thread:native-v2-nested-child-thread`
- subagent origin/status: `provider_native` / `completed`
- subagent result and child assistant item: `Subagent says: “Hello.”` (one occurrence in child projection)
- fixture command marker: `command:fixture:subagent_v2_nested:thread-create:ea50ea93-b0ab-4c77-a9e4-4fcde38dabb3`
- materialized stream: 88 events, four thread projections, three nested subagent projections
- parent browser URL and child browser URL are retained in ignored `.runtime/browser-followthrough.log`; no credential is present.

## Reproduce

After normal `setup.sh`:

```sh
# Download stays under ignored experiment runtime.
HOME="$PWD/experiments/t3-v2/.runtime/browser-home" \
PLAYWRIGHT_BROWSERS_PATH="$PWD/experiments/t3-v2/.runtime/browser-cache" \
node experiments/t3-v2/.runtime/upstream/apps/desktop/node_modules/playwright-core/cli.js install chromium

experiments/t3-v2/capture-browser-fixture.sh
# Stop the dev server before seeding.
bun experiments/t3-v2/seed-browser-fixture.ts
T3_V2_PORT_OFFSET=23000 experiments/t3-v2/run.sh dev

# In another shell after pairing has initialized the isolated profile:
cd experiments/t3-v2
mkdir -p .runtime/browser-tmp
TMPDIR="$PWD/.runtime/browser-tmp" \
PLAYWRIGHT_BROWSERS_PATH="$PWD/.runtime/browser-cache" \
node browser-followthrough.mjs
```

`capture-browser-fixture.sh` temporarily instruments the replay integration test, always restores it with a trap, and emits the ignored JSON snapshot. `seed-browser-fixture.ts` refuses missing inputs/database and targets the experiment state by default. `browser-followthrough.mjs` uses the server's normal pairing link without printing it, an isolated persistent profile, clicks parent → relationship child, asserts target and marker, and captures both images.

The host `/tmp` was 99% full and initially caused Chromium `ERR_INSUFFICIENT_RESOURCES`; setting `TMPDIR` to the experiment runtime fixed it. Firefox's prior SWGL blocker is therefore bypassed by an actual Chromium renderer.

## Explicit non-claims / blockers

This proves acceptance scenario 4's **rendered navigation surface** against a durable upstream replay-derived child, not the main agent's changing adapter/engine integration. There was no live provider process spawn, no active model tool list, no T3 MCP scoped bearer exercise, no clientRequestId, and no delivery/ACK/reconnect fault injection in this browser run. Codex is visibly unauthenticated, as expected for replay data. Those observables cannot truthfully be supplied from this fixture and remain required for a full combined acceptance claim.

No root README/RESULTS, pins, dist, shared state, credentials, or `upstream.patch` were changed. `upstream.patch` remained SHA-256 `87c48ebfbc6e97bbf832b3e52031eecb06955a9248a4caa528b71de80720370f`.
