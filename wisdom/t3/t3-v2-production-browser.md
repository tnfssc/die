# T3-v2 production same-live-server browser acceptance

**Owner:** browser acceptance worker.  
**Status:** UNEXECUTED SCAFFOLDING — candidate is not coherent as of 2026-09-21.

## Owned output

- `scripts/t3-v2-production/browser-acceptance.ts`
- `scripts/t3-v2-production/README.md`
- this coordination note

No root `src/**`, `web/**`, historical experiment assertion, release, install, or
shared process/state was changed.

## Candidate readiness observed

- Candidate checkout exists at `.cache/die-t3code-v2-production` at upstream
  HEAD `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`.
- At first inspection it was clean and had no bridge injection. During harness work,
  the concurrent web worker populated a 20-path dirty migration including
  `T3_MCP_URL` injection, while root task files also appeared. This is active
  coordination, not evidence that the two sides are protocol-compatible or complete.
- Candidate `node_modules` is absent and no reviewed candidate executable/hash was
  published. An already installed playwright-core may instead be selected explicitly.
- Root bridge changes from task `taskaa90e5c7` and web migration changes from
  task `task22bbfa03` were not available as one reviewed runnable executable +
  checkout. No browser acceptance was run and no PASS is claimed.

## Harness contract for the two upstream workers

The fixture configures a deterministic local HTTP model as the candidate's Pi provider.
The parent model calls only the native execute tool. Its execute code launches
`subagent({type: "orchestrator", waitSeconds: 0})`; it does not call T3 MCP directly,
seed a database, or fake projection rows. The candidate backend must inject its scoped
`T3_MCP_URL`/bearer pair into that provider and map the native helper to a T3-owned
child thread. Credentials must remain out of transcript, logs, errors, and proof.

The UI/backend must expose:

1. a navigable relationship for the child while its execute call is running;
2. child terminal completion and completion-driven parent wake;
3. `Stop generation` on a running child, with a rendered terminal status such as
   `Stopped`/`Cancelled`/`Interrupted`; and
4. durable exact-child routing/transcript/status after page refresh.

If final labels differ semantically, update selectors only after inspecting the coherent
candidate; do not weaken the live-state assertions or use seeded state.

## What the eventual run must report

A pass artifact reports the resolved candidate executable and SHA-256, checkout path, HEAD and content-sensitive worktree SHA-256, spawned backend PID/origin, exact parent and both child URLs, deterministic
model request classes, and screenshots for running-child navigation and stopped-child
refresh. All browser URLs are asserted to have the one backend origin. State starts in
a newly created mode-0700 temporary home and is deleted after owned processes stop.

## Static checks completed

- `bun build scripts/t3-v2-production/browser-acceptance.ts --target=bun` succeeds.
- The fail-closed candidate gate was reviewed; the current upstream checkout would be
  rejected before allocating temp state or spawning processes.

## Run gate

The coordinator should set the explicit candidate/hash variables documented in
`scripts/t3-v2-production/README.md` only after both workers publish compatible
protocol/model-profile semantics and a reviewed executable built from the migrated
checkout. The harness performs no install/build itself.
