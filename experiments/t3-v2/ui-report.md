# UI feasibility and isolated launch report

## Scope and result

Checked the experiment at upstream commit `a9b49a7df0a4261dcc438d4493cc3154a1d9819e` with `upstream.patch` SHA-256 `87c48ebfbc6e97bbf832b3e52031eecb06955a9248a4caa528b71de80720370f`. The patch currently changes the server integration test only. It does not add a new browser surface. Existing orchestration-v2 UI tests and a live server/UI asset smoke pass. We tried to take a rendered-browser screenshot. The available Firefox graphics setup blocked it, as described below.

## Reproduction

`setup.sh`:

- verifies the exact pinned commit is available;
- makes a detached local clone under ignored `.runtime/upstream`;
- applies `upstream.patch` when present and stamps its digest;
- uses the repository-declared pnpm 11.10.0 through Corepack (no global install);
- uses the frozen lockfile and puts source, dependencies, package store, cache, HOME/XDG paths, logs, and application state under `.runtime/`.

`run.sh dev` starts the unmodified upstream dev runner at fixed loopback endpoints:

- UI: `http://localhost:24733`
- backend: `http://127.0.0.1:32773`
- state: `.runtime/state/t3-home`

Override both ports with a non-negative `T3_V2_PORT_OFFSET` (web = 5733 + offset; server = 13773 + offset). Explicit port/dev-url flags make collisions fail instead of silently selecting another address. Other modes are `run.sh dry-run` and `run.sh test-ui [optional test paths...]`.

Typical use:

```sh
experiments/t3-v2/setup.sh
experiments/t3-v2/run.sh dry-run
experiments/t3-v2/run.sh test-ui
experiments/t3-v2/run.sh dev
```

Set `T3_V2_REQUIRE_PATCH=1` during setup when an unpatched baseline must be rejected. Setup may use another local object source through `T3_V2_UPSTREAM_REPO`.

## Evidence (2026-09-20)

Environment: Node v24.15.0, Corepack pnpm 11.10.0, Firefox 150.0.1, and `xvfb-run` available. No Chromium/Chrome executable or downloaded Electron runtime was available.

- Setup: **PASS**, 1,779 locked packages, about 2m12s on an empty isolated store. Upstream prepare scripts completed.
- Dry run: **PASS**. It resolved server 32773, web 24733, and the runtime-only T3 home.
- Live backend: **PASS**. Migrations through `54_OrchestrationV2` completed and the backend listened on `127.0.0.1:32773`.
- Authentication: **PASS/preserved**. Startup reported `Authentication required` and generated the normal pairing URL. No auth bypass or origin relaxation was given. The token is intentionally not recorded here.
- UI asset smoke: **PASS**. `GET http://localhost:24733/` returned HTTP 200 and a 20,378-byte page with title `T3 Code (Alpha)`.
- Narrow UI tests: **PASS**, 3 files / 16 tests in 2.75s:
  - `ThreadRelationshipsControl.agents.test.tsx`
  - `agentSpawnSummary.test.ts`
  - `orchestrationV2Timeline.test.ts`
- Isolation: **PASS**. Generated SQLite state and provider caches were observed only below `.runtime/state/t3-home`. Both listeners were loopback-only and were stopped after smoke.
- Script syntax and patch whitespace: **PASS** (`bash -n`, `git diff --check`).

Ignored raw logs and state remain under `.runtime/` for local diagnosis.

## Browser blocker and feasibility judgment

Two bounded Firefox screenshot attempts (plain headless and under Xvfb, fresh isolated profiles) timed out after 25/35 seconds without producing an image. Firefox reported `RenderCompositorSWGL failed mapping default framebuffer`. This is a host graphics/browser limit, not an HTTP startup failure. The same live endpoint returned valid HTML, and the focused component/timeline tests passed. No browser or system package was installed to work around it.

The UI/server stack can launch reproducibly in isolation. The existing task/agent relationship surfaces pass their focused tests. This run does **not** prove interactive delegated-child behavior in a rendered browser. It also does not prove any new UI from the patch, because the current patch has none. A machine with a working Chromium/Firefox headless renderer should repeat the pairing flow and inspect a real delegated child thread before claiming end-to-end browser UX.
