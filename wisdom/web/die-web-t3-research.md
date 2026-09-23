# T3 Code architecture for a temporary `die web` bridge

Research only, inspected 2026-09-14.
No T3/die production files were changed, no dependencies were installed, no server was launched, no model turn was made, and no commit was created.
I read the existing clone plus the saved main-agent evidence in `artifacts/web-feasibility/`.
A temp clone attempt for one stale fork failed for disk space and was removed; fork/PR facts below come from GitHub metadata and saved extracts, not an executed checkout.

## Checkout provenance

- Repository: `pingdotgg/t3code`, clone at `/home/tnfssc/Code/die-research/t3code`.
- HEAD: `01e05c15268dedb76da95f442fbf5201cd8e7a44` (main, clean), commit timestamp `2026-09-14T12:39:57+05:30`, subject `docs(claude): clarify OpenRouter model selection (#11369)`.
- Clone/inspection snapshot date: 2026-09-14 (the checkout itself does not record an authoritative clone timestamp, so this is the verified snapshot date).
- License: MIT, copyright 2026 T3 Tools Inc. (`LICENSE:1-21`).
  This permits a fork/modified distribution provided the copyright and permission notice are retained.
  Dependencies/assets still need their own notices; T3 has an existing license-notice pipeline.

## Bottom line

A frontend-only T3 fork cannot make the UI run real die.
The browser speaks T3's authenticated HTTP/WebSocket contracts to the T3 server; the T3 server owns projects, threads, persistence, terminals, git, and agent processes.
The correct extension seam is the **server-side ProviderDriver + ProviderAdapter SPI**, with a small amount of client metadata/settings wiring.
It should translate die/Pi JSONL RPC into T3 canonical provider events rather than replace T3's backend.

For a temporary bridge, the least-bad shape is a **pinned upstream T3 build plus a maintained Pi/die provider patch stack**.
It is not a runtime plugin: drivers are statically imported into `BUILT_IN_DRIVERS`, and browser-safe provider definitions are also static.
So some source fork/rebuild is unavoidable until upstream ships Pi.
Keep the patch isolated and disposable; do not fork/rewrite the frontend or invent a second T3 protocol.

The current official checkout has no Pi implementation (no Pi driver/adapter/RPC source and no `pi` entry in the built-in lists).
Issue #402 being closed is not shipped support: it was converted to a discussion on 2026-08-15, and all four referenced Pi PRs were closed unmerged.

## Actual process architecture

### CLI/server/web distribution

- `apps/server/package.json` names package `t3` and exposes `t3 -> ./dist/bin.mjs`; `apps/server/src/bin.ts:55-76` defines one CLI with default server behavior plus `start` and `serve`.
- `apps/server/src/cli/server.ts:8-35`: default/`start` run the server; `serve` is headless, does not open a browser, and prints pairing details.
- Web-mode defaults are already OpenCode-like: mode defaults to `web`, an available port is selected starting at the default, and a browser startup is selected (`apps/server/src/cli/config.ts:265-287,315-325`).
  Explicit `--host`, `--port`, and `--no-browser` exist (`apps/server/src/cli/config.ts:21-48,194-212`).
- The HTTP listener defaults to loopback even though the config's host is undefined: `config.host ?? "127.0.0.1"` (`apps/server/src/server.ts:223-229`).
  This is the desired safe local default.
- The normal web startup computes a local/bind URL, creates a one-time pairing URL, and opens it in the default browser (`apps/server/src/serverRuntimeStartup.ts:302-333,934-948`).
  Web mode also auto-creates a project/thread for cwd, but currently chooses the Codex instance/model (`apps/server/src/serverRuntimeStartup.ts:174-177,203-257`).
- The production CLI archive is already self-contained: executable, built web client, resource monitor, and native runtime externals (`scripts/build-cli-archive.ts:1-16`).
  Staging copies `apps/server/dist/client` beside the executable (`scripts/build-cli-archive.ts:470-518`).
  NPM distribution wraps per-platform archives in optional platform packages and a tiny `t3` launcher (`scripts/build-npm-platform-packages.ts:1-20,128-152`).
  Thus a `die web` launcher could invoke a pinned T3 binary/build; it does not need to create a new web bundling system.
- Static SPA serving and the WebSocket API live in the same server.
  The RPC endpoint is `GET /ws` and uses Effect RPC JSON serialization (`apps/server/src/ws.ts:3426-3463`).
  Client state is layered over environment-scoped RPC connections; see `packages/client-runtime/src/rpc/client.ts` and `packages/client-runtime/src/connection/registry.ts`.

### Backend/provider layers

T3's own provider guidance is explicit: orchestration is provider-neutral, while protocols, permissions and capabilities normalize at the adapter boundary (`docs/internals/providers.md:1-10`).
The concrete seams are:

1. **ProviderDriver** — open branded driver slug, typed config schema/default, scoped per-instance construction (`packages/contracts/src/providerInstance.ts:58-83,115-138`; `apps/server/src/provider/ProviderDriver.ts:121-184`).
  A materialized instance owns snapshot/health, adapter, text-generation service and optional auth (`apps/server/src/provider/ProviderDriver.ts:58-89`).
2. **ProviderAdapter** — provider-native session operations normalized to start/send/interrupt, approval and user-input responses, read/rollback, stop, capabilities, and a stream of canonical `ProviderRuntimeEvent` values (`apps/server/src/provider/Services/ProviderAdapter.ts:1-8,28-55,67-158`).
3. **ProviderInstanceRegistry/adapter facade** — dynamic instance lookup/hot reload from settings, while adapter construction remains inside each driver's scoped `create` (`apps/server/src/provider/Layers/ProviderAdapterRegistry.ts:1-14,29-75`).
4. **Static registration** — official drivers are Codex, Claude, Cursor, Grok, OpenCode and Antigravity; a new driver must be imported into `BUILT_IN_DRIVERS` (`apps/server/src/provider/builtInDrivers.ts:1-19,23-56`).
  This is an internal SPI, not an externally loadable plugin seam.
5. **Browser metadata/settings** — the settings UI is mostly schema-driven, but its driver definitions and icons are static (`apps/web/src/components/settings/providerDriverMeta.ts:21-46,46-85`; `apps/web/src/components/chat/providerIconUtils.ts:1-19`).
  Unknown drivers round-trip and can render a generic card, but users cannot fully configure/select a useful die driver without adding client metadata/schema.
6. **Generic model options** — model capability descriptors are generic select/boolean records (`packages/contracts/src/model.ts:7-44,90-128`).
  A die adapter can expose real model-specific reasoning choices instead of adding a Pi-only picker. `TraitsPicker` consumes descriptors generically, with only cosmetic Codex/Claude special cases (for example `apps/web/src/components/chat/TraitsPicker.tsx:490-520,585-625`).

This means “replace backend with die” is the wrong cut.
Keep T3 server/orchestration and implement a die driver whose adapter owns one or more `die --mode rpc` children, converts RPC events, and presents snapshots/models/options through the existing contracts.

## Pi/die RPC evidence and extension seam

Upstream issue [#402](https://github.com/pingdotgg/t3code/issues/402), captured in `artifacts/web-feasibility/upstream-extract.json`, explicitly proposed this same direction: Pi RPC mode, dynamic model discovery, real reasoning levels, cleanup on launch/send/model-switch failures, and no Pi-only frontend.
The saved GraphQL status (`pi-issue-status.json`) says CLOSED at `2026-08-15T09:41:10Z`; timeline shows conversion to discussion, not merge (current discussion surfaced as https://github.com/pingdotgg/t3code/discussions/6685).

There is substantial reference code, but none is current official code:

- PR #3947: closed/unmerged, 5,018 additions / 139 deletions / 39 files.
- PR #4355: closed/unmerged, 5,981 / 41 / 34 files; timeline records maintainer context that new providers were not then being accepted.
- PR #5688: closed/unmerged, 5,519 / 11 / 33 files.
- PR #5882 (`PJalv/t3code:feature/pi-provider`): closed/unmerged, 8,024 / 19 / 36 files.
  Its last Pi-branch commit found was `191b3de07b6e2d7975530f20f5b5b847b2a73d0b` on 2026-08-10; the owner's `main` moved to 2026-09-08, but the Pi branch did not.
  It is a useful reference, not a maintained current adapter.

PR #5882's file list confirms the real scope: `PiDriver`, `PiAdapter`, `PiProvider`, JSONL schema/client, model/session-file handling, text generation, contracts, web/mobile metadata, and tests.
Its implementation has the right executable seam:

- `packages/contracts/src/settings.ts` on that branch defines `PiSettings.binaryPath`, default `pi`.
- `apps/server/src/provider/pi/PiRpcClient.ts:353-379` spawns the configured command with `--mode rpc`.
- `apps/server/src/provider/Layers/PiAdapter.ts:1780-1799` passes the configured binary plus `--session <file>` and `--offline`.
- `apps/server/src/provider/Layers/PiProvider.ts:99-174` probes via `get_state`, `get_available_models`, and `get_commands`, with no static fallback model list.

Those branch refs are source snapshots at PR #5882, not lines in current HEAD.
The saved `artifacts/web-feasibility/die-rpc-handshake.json` shows a no-turn probe of the real local die executable successfully answered `get_state` and emitted `extension_ui_request` events.
That is good evidence that a configurable Pi adapter can point at **die**, not just stock `pi`.
It is not proof of full compatibility: no prompt/model call was made, and send/stream/tool/approval/resume/compaction behavior remains unverified.

Die-specific compatibility points to verify before implementation:

- CLI parity for `--mode rpc --offline --session <file>` and session header/path semantics.
- Exact schemas/order for assistant text, thinking, tool start/update/end, usage, retry, compaction, steering/follow-up, errors and shutdown.
- Extension UI requests at startup and during turns.
  The reference Pi adapter includes an `extension_ui_request` path and subagent projections, but die extensions may add request/event payloads unknown to that month-old branch.
- Preserve die's extensions/config/home, rather than probing or launching a stock `pi` by accident.
  Every availability/model/session spawn must use the configured executable.
  Do not install or auto-update Pi from T3 for this bridge.
- Pi MCP assumptions are optional and potentially wrong for die.
  PR #5882 detects `pi-mcp-adapter`, creates a private MCP config and injects flags/env; validate whether die already supplies equivalent extensions before carrying that machinery.

## Remaining Codex/Claude assumptions

The provider core is now meaningfully generic, but the product is not assumption-free. Relevant examples in current HEAD:

- Initial cwd thread hardcodes Codex/default model (`apps/server/src/serverRuntimeStartup.ts:174-177`).
  A die-only launch needs an explicit die default selection or delayed selection after provider discovery.
- Provider registry has special model-retention behavior for Codex/Antigravity/OpenCode (`apps/server/src/provider/Layers/ProviderRegistry.ts:103-126`).
  New die behavior must be chosen deliberately.
- Imported external histories/session scanning are Codex/Claude-specific (`apps/server/src/project/AgentSessionImporter.ts:177-234`, `AgentSessionScanner.ts:305-398,1128-1170`).
  This need not block fresh die threads, but means existing die session import is separate work.
- Terminal environment setup special-cases Codex and Claude (`apps/server/src/terminal/Manager.ts:1365-1380`).
  Usage transcript/account integrations are also Codex/Claude-oriented (`apps/server/src/usage/UsageService.ts:257-282`).
  These are optional feature gaps, not reasons to bypass ProviderAdapter.
- Codex feedback slash handling remains explicitly Codex-only (`apps/web/src/components/ChatView.tsx:7056-7064`), appropriately irrelevant to die.
- Provider settings/onboarding search labels and readiness logic enumerate known drivers (`apps/web/src/components/settings/providerDriverMeta.ts:46-85`, `apps/web/src/onboarding/providerReadiness.logic.ts:112-127`).
  Add only the minimal die entry/readiness rules.
- T3 expects each ProviderInstance to supply a text-generation service (`ProviderDriver.ts:86-88`); PR #5882 needed `PiTextGeneration` for titles/commit/PR text.
  A minimal adapter must either implement this honestly through RPC or explicitly choose another existing provider for those helper jobs.

## Authentication and origin behavior

There are two separate auth systems:

1. **T3 Connect/cloud account auth (Clerk)** is optional.
  The web entry dynamically loads Clerk only when complete cloud public config exists; cloudless local mode renders the app directly and downloads no Clerk runtime (`apps/web/src/main.tsx:27-28,41-52,63-77`; `apps/web/src/cloud/publicConfig.ts:40-75`).
  A local bridge build should omit the Clerk/relay build variables.
  This satisfies “no web login/account”.
2. **Local environment authorization** is mandatory in current T3.
  Loopback web mode uses policy `loopback-browser` and a one-time bootstrap credential, then browser cookie/bearer/DPoP sessions; remote-reachable binds use `remote-reachable` (`apps/server/src/auth/EnvironmentAuthPolicy.ts:18-50`).
  The startup browser gets a `/pair#token=...` URL (`EnvironmentAuth.ts:1045-1055`) and exchanges it into a session, so normal local launch is seamless rather than a username/password page.
  Every WebSocket upgrade authenticates (`apps/server/src/ws.ts:3426-3447`), and every RPC has a declared scope (`apps/server/src/auth/RpcAuthorization.ts:166-174`).

So:

- If “no login/auth” means **no Clerk/cloud login and no visible prompt**, upstream local startup already supports it safely via automatic one-time pairing.
- If it literally means **unauthenticated HTTP/WebSocket**, there is no supported flag.
  Removing it would be a security-sensitive backend fork, especially because RPC can operate terminals/files/git and read outside a project under the server account (`docs/internals/environment-auth.md:59-65`).
  Do not do that.
  Keep loopback binding and transparent local pairing.
- Explicit non-loopback hosts are classified remote-reachable (`apps/server/src/auth/utils.ts:66-79`) and should retain pairing/auth.
  Browser API CORS allows explicit dev origins only when a dev URL is configured; packaged same-origin web needs no CORS (`apps/server/src/http.ts:231-252`).
  CORS is not the authorization control.
- Agent-produced HTML is sandboxed to an opaque origin so it cannot reach same-origin cookies/storage/API (`apps/server/src/http.ts:51-58`). Preserve this protection.

## Fork decision

### Recommended temporary shape

**Maintained provider-adapter patch/fork, pinned to one T3 commit**, not a frontend-only fork and not a replacement backend.

Keep the delta about:

- server: Die/Pi RPC schema/client, scoped runtime/session owner, Driver, Adapter, Provider snapshot/model probe, text-generation adapter;
- contracts: die settings schema only where browser configuration needs it; current driver kind itself is already an open slug;
- registration: one entry in `BUILT_IN_DRIVERS`;
- web: one browser-safe driver definition/icon, generic settings/model options, and die default selection/readiness;
- launcher: `die web` resolves the pinned T3 artifact and configures `binaryPath` to the current die executable, loopback, cwd, and cloudless mode; retain transparent pairing.

Avoid carrying mobile, Connect, provider installer/updater, imported Pi history, Pi-only UI, or all stock-Pi MCP conveniences unless the temporary use case actually needs them.
Keep tests around event normalization and failure cleanup because that is where corruption/orphan processes occur.

### Existing forks

- The Reddit/TVLY result says an OMP-specific fork was “heavily modified” around `omp --mode rpc` and stripped to OMP-only.
  That description implies a full backend integration, not a frontend skin, but the extract did not expose source/commit details.
- Saved metadata identified `MajesteitBart/t3code`, but its default branch was 1,593 commits behind upstream and 0 ahead at inspection, last pushed 2026-08-08.
  It provides no current maintained adapter delta and should not be adopted on this evidence.
- The best inspectable reference is PR #5882/PJalv, but its Pi branch stopped 2026-08-10 and is thousands of lines across 36 files.
  Treat it as protocol/test research to selectively port onto current HEAD, not as a dependency or “almost merged” implementation.

A frontend-only fork could show a Pi badge/model, but the browser would still send T3 orchestration RPC to a server with no registered adapter and get unavailable/unsupported behavior.
It cannot safely proxy raw die RPC without reimplementing T3's server-side persistence, worktrees, terminal/git operations and auth in the browser, which defeats the goal.

## Real blockers and rough scope

Blockers before a usable bridge:

1. No Pi/die driver is merged or dynamically loadable; source patch + custom T3 build/distribution is required.
2. Full die RPC-to-`ProviderRuntimeEvent` normalization is not yet verified. A successful `get_state` handshake is only the first gate.
3. Session lifecycle/resume and exact file semantics must be proven with die; failures must close process/scope and not persist poisoned cursors.
4. Model inventory and model-specific reasoning descriptors must come from the configured die process and work before first-thread default selection.
5. Extension UI/tool/subagent events and approval/user-input mappings need compatibility tests against die's extensions.
6. Current Codex auto-bootstrap default must be removed/overridden for a die-only experience.
7. A pinned, license-compliant T3 artifact must be built and updated intentionally; upstream churn makes an unpinned branch fragile.
8. Literal auth removal is rejected as unsafe; clarify that transparent loopback pairing meets the product wording.

Rough engineering scope, not a promise:

- **Narrow proof-of-concept** (one local die executable, one thread, text/thinking/basic tools, dynamic models, loopback launch, no resume/approvals/subagents): roughly 4-8 focused engineering days after protocol fixtures are available.
- **Usable temporary bridge** (cleanup, persisted resume, interrupt/steer, input/approval, extension events, helper text generation, settings/defaults, packaging and focused tests): roughly 2-4 engineer-weeks.
  PR #5882's 8k-line/36-file footprint is evidence that full Pi behavior is not a weekend frontend patch.
- **Near feature parity/hardened cross-platform fork** (MCP/browser injection, imported history, usage, mobile, updater/install ownership, broad failure matrix): 1-2+ engineer-months and ongoing upstream rebase cost; this is contrary to the disposable-bridge goal.

The POC estimate should not be used as a release estimate. Protocol mismatches in die extensions/session persistence are the largest uncertainty.

## Evidence inventory

- Local source authority: `/home/tnfssc/Code/die-research/t3code` at the commit above.
- Saved web evidence: `artifacts/web-feasibility/upstream-extract.json`, `pi-issue-status.json`, `pi-issue-timeline.json`, `pi-pr5882.json`, `pi-fork.json`, `t3-search.json`, `t3-omp-search.json`, `acp-search.json`, and `die-rpc-handshake.json`.
- Issue: https://github.com/pingdotgg/t3code/issues/402 (now closed/converted discussion).
- Reference PR: https://github.com/pingdotgg/t3code/pull/5882 and branch snapshot `PJalv/t3code@191b3de07b6e2d7975530f20f5b5b847b2a73d0b`.
