# T3-v2 packaged candidate smoke — preservation

**Run:** 2026-09-21 08:12 UTC  
**Result:** PASS for the black-box packaged-runtime scope below.  
**Production edits:** none. The browser worker-owned candidate/build outputs were read only.

## Exact reviewed package

- Executable: `dist/die-t3-v2-candidate`
- Size: `165348832` bytes
- SHA-256: `cabdbde32f5bd527c4307907bf3ac1dd0e33077501ad9cb036350315eb880217`
- Build manifest: `dist/t3-v2-candidate-build.json`
- Build-manifest SHA-256: `9ea76bb3fac4e65a3828955ff895e340ff5d92512093c4a5c470848d7c69435d`
- Candidate checkout revision: `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`
- Candidate patch hash: `4f1126e3edf672e464f2d9f691b1c91f9724fbe703422bfa38439ece22911121`
- Manifest itself records `typecheckVerified: false`; this smoke does not upgrade that claim.
- Extracted runtime directory/content ID: `5b868e6071cbe1de68f344617de28bd06b39786bd6c6c21b39f16276a4d72d9b`
- Extracted `bootstrap.mjs` SHA-256: `154fc94a56be176ef6f4e6591f594a5834fd81bc2afe101442cc0b8d6364ebc2`

The candidate was refreshed while this task was beginning. The harness correctly rejected the earlier expected hash `3f6dc9…`; all PASS evidence is for the final hash above.

## Rerun

```sh
T3_V2_EXPECT_BINARY_SHA256=cabdbde32f5bd527c4307907bf3ac1dd0e33077501ad9cb036350315eb880217 \
TMPDIR=/var/tmp bun scripts/t3-v2-production/packaged-smoke.ts
```

Machine-readable evidence: `artifacts/t3-v2-packaged-smoke.json`.

## What passed

- Copied the package to a mode-0700 private temporary tree, renamed it, and launched it from a path containing spaces.
- Candidate and embedded backend ran as the relocated executable with an intentionally nonexistent `PATH`; no runtime `node`, `npm`, `npx`, or `bun` process was present.
- Embedded web assets extracted and the no-auth server printed the plain loopback URL without a pairing/token URL.
- HTTP auth session accepted exact same-origin and headerless local requests. Cross-origin, opaque-origin, wrong-port, alternate-host, DNS-rebinding-style Host, and cross-site requests all returned `authenticated:false`.
- WebSocket protocol v2 accepted exact same-origin and headerless local upgrades (101). Cross-origin, wrong-port, alternate-host, and rebinding Host upgrades were rejected (401).
- Existing nested settings, provider metadata, and custom model selection survived launcher seeding; only Pi `binaryPath` became the relocated executable as required.
- Observed exactly the launcher and embedded-backend package processes. SIGTERM produced launcher exit 143 and both recorded owned PIDs disappeared before cleanup.
- HOME, XDG cache/config/state, TMPDIR, T3 base state, and package copy were isolated and removed. No live user state, install, version mutation, or publication was used.

## Deliberate boundary

No actual browser was launched because the browser worker owns browser/candidate acceptance. Therefore this run does **not** claim browser-rendered shell cards/liveness, interactive model or instruction-mode switching, populated session history/token accounting, or terminal delayed-input/resize behavior. Those remain the same-live-server browser/native harness gates; this result only establishes that their packaged server/runtime substrate, no-auth boundary, configuration preservation, and shutdown work from the exact artifact.
