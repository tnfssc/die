# Maintainable full die web integration on T3 Code

Research/design only, inspected 2026-09-14. The T3 checkout was `/home/tnfssc/Code/die-research/t3code` at `01e05c15268dedb76da95f442fbf5201cd8e7a44` (clean, upstream `main`). No dependencies were installed, no services or model turns were run, and no production source was edited. T3 Code is MIT licensed; redistributed builds must retain its license notice.

## Decision

Build and maintain a **first-class die provider in a pinned T3 Code fork**, while retaining the T3 server, persistence, RPC API, and UI. Run die as a supervised local runtime sidecar speaking die/Pi RPC. Do not route die through Cursor's ACP adapter and do not replace T3's backend.

Pin the fork as a git submodule in the die repository and release tested fork commits, not a pristine checkout plus an ad-hoc patch at startup. Keep the provider implementation in new, narrowly named directories and keep the integration delta as a small ordered commit series. Updating will still require conflict resolution and compatibility testing; this design reduces the conflict surface but cannot make upstream upgrades conflict-free.

The product topology is:

`browser -> T3 /ws -> T3 orchestration + persistence -> DieProviderAdapter -> supervised die --mode rpc process`

One die RPC process owns each active root die session. Processes created by die's execute/jobs/subagent facilities remain children of that die runtime. The browser never starts die, receives provider credentials, or reads arbitrary session paths directly.

## Why this is the maintainable boundary

T3 already has the correct host responsibilities: static web serving and Effect RPC over `GET /ws` (`apps/server/src/ws.ts`), projects/worktrees, terminal and git operations, attachments, authentication, orchestration event persistence, projections, reconnect, and a mature task/agent UI. Replacing its server would require reimplementing those facilities and keeping a second frontend protocol compatible.

Its provider seam is real but is a **compile-time SPI, not a loadable plugin ABI**:

- `ProviderDriver<Config, R>` owns typed config, metadata, and scoped instance creation (`apps/server/src/provider/ProviderDriver.ts:112-184`). A created instance supplies snapshot/model inventory, adapter, text generation, and optional auth. Per-instance state must be isolated and released with its Effect scope.
- `ProviderAdapterShape` covers session start, turn send, interrupt, approval/input responses, stop/list/read/rollback, optional compaction/feedback, and a canonical `ProviderRuntimeEvent` stream (`apps/server/src/provider/Services/ProviderAdapter.ts:67-158`).
- Instance envelopes are deliberately extensible: driver is an open branded slug and config is unknown, with unknown drivers preserved during settings round trips (`packages/contracts/src/providerInstance.ts`).
- Runtime events are already source-neutral and include `task.started/progress/updated/completed`, agent/parent attribution, tools, hooks, requests, user input, files, warnings, usage, and turn/session lifecycle (`packages/contracts/src/providerRuntime.ts`). The client folds persisted task events into the Agents surface in `packages/client-runtime/src/state/subagentRuntime.ts`.

The remaining registration is static:

- Server drivers are imported and listed in `apps/server/src/provider/builtInDrivers.ts`.
- Browser metadata, icon, and settings schema are listed in `apps/web/src/components/settings/providerDriverMeta.ts`.
- Provider config schemas currently live in `packages/contracts/src/settings.ts`.

The web metadata file explicitly describes its shape as resembling a future provider-package client export. That is direction, not a current extension mechanism. A dynamically installed provider package would still need a trusted server module loader, a browser-safe metadata/field protocol, bundler support, version negotiation, and a security policy. Building all of that first is more core churn than adding one maintained provider.

## Repository and fork layout

Recommended die repository layout:

```
third_party/
  t3code/                         # git submodule -> our T3 fork, exact release commit
  licenses/T3CODE-LICENSE
web/
  t3-manifest.json                # upstream commit, fork commit, die protocol range, artifact hashes
  README.md                       # build/update/release runbook
scripts/
  t3-update-check                 # verifies ancestry/dirty tree/manifest; does not silently merge
  t3-compat                       # runs the pinned fixture and integration suites
src/web/
  launcher/                       # die web process ownership, ports, local pairing, shutdown
  distribution/                   # platform artifact resolution/signature verification
tests/web-compat/
  fixtures/die-rpc/               # sanitized, versioned wire transcripts
  fixtures/t3-runtime/            # expected normalized ProviderRuntimeEvents/projections
  scenarios/                      # crash, reconnect, resume, tasks, paths, auth
```

The fork should use `upstream` for `pingdotgg/t3code`, `origin` for the die-maintained fork, a protected integration branch, and immutable release tags. Keep a readable commit stack:

1. generic contract/SPI changes needed for task control or provider metadata;
2. die settings and protocol types;
3. server Die driver/adapter/runtime implementation;
4. browser registration and die-specific presentation;
5. packaging/default-profile changes, if any;
6. tests and fixtures adjacent to each layer.

Do not maintain one 8,000-line squash. Do not use generated `.patch` files as the source of truth: they fail late on changed context and are harder to review. Do not vendor a source snapshot without history. A subtree permits atomic die commits but duplicates T3 history and makes upstream synchronization and provenance less obvious. A submodule has real ergonomics costs (two-repository checkout, CI credentials, explicit pointer commits), but gives the clearest immutable pin, upstream ancestry, and independent fork CI.

For published integration branches, merge a selected upstream tag/commit and resolve conflicts, then tag and pin that result. A rebased topic stack may be used while preparing the update, but do not force-rewrite released pins. Record the upstream base and resolved fork commit in `t3-manifest.json` and release notes.

## Isolate the delta inside the T3 fork

Place the bulk under new paths such as:

```
apps/server/src/provider/Die/
  DieDriver.ts
  DieAdapter.ts
  DieRpcClient.ts
  DieProcessSupervisor.ts
  DieEventMapper.ts
  DieSessionCursor.ts
  DieTextGeneration.ts
  *.test.ts
apps/web/src/components/die/
  DieTaskDetails.tsx              # only if generic task UI cannot represent a field
  *.test.ts
```

Prefer T3's existing generic model descriptors, task events, settings renderer, and Agents panel. Die-specific UI should be limited to behavior that cannot be expressed by those contracts, such as a child-session link or job stdin/control menu.

A separate `packages/provider-die` workspace package looks attractive but is not clean today: `ProviderDriver`, adapter errors, process services, and text-generation contracts are server-internal imports, while the icon/settings definition is browser code. Moving those SPIs into a public package would increase upstream touchpoints and cycles. Start with isolated source directories. Extract a provider SDK only if T3 upstream accepts and owns the abstraction.

### Minimal baseline upstream touchpoints

For text/turn/session functionality, expect these deliberate edits outside the new Die directory:

1. Add `DieSettings` and its exports/patch form in `packages/contracts/src/settings.ts` (or a portable generic field schema if upstream introduces one). Do not add a legacy single-provider entry when `providerInstances` already supports open driver envelopes.
2. Import `DieDriver`, include its environment type, and append it in `apps/server/src/provider/builtInDrivers.ts`.
3. Add a browser-safe die definition and icon in `apps/web/src/components/settings/providerDriverMeta.ts` and the icon module.
4. Add any workspace/package dependency and lockfile change only if the adapter truly needs a new library. A small JSON-lines RPC client can likely use existing process/stream facilities.
5. Add die to model-default/readiness tests where generic behavior still contains Codex/Claude assumptions. Configure the die-only default from the `die web` launcher/settings seed where possible rather than globally changing T3 defaults.

Full interactive job control needs more than these baseline points. T3's event contract can display tasks, but `ProviderAdapterShape` has no list/inspect/input/stop/snooze/watch task commands. Add a source-neutral optional task-control capability and corresponding contracts/server RPC/client operations/UI actions. This is a legitimate generic upstream candidate, but until merged it remains a fork patch across contracts, orchestration service, WS exposure, client runtime, and task UI. Hiding these operations in fake prompts or Cursor ACP methods would be less maintainable and semantically wrong.

## Runtime and session ownership

### Sources of truth

- **die owns executable-agent truth:** canonical session JSONL, branching, model conversation state, extension state, TaskManager, child session files, job processes, queues, and provider credentials.
- **T3 owns product/UI truth:** project and worktree identity, user-facing thread ID, normalized orchestration event log/projections, pending UI requests, settings, browser sessions, terminal/git state, and attachment storage.
- **The adapter owns the mapping:** T3 thread ID to provider instance, canonical die session file, die session ID, cursor schema/protocol version, and current process generation.

T3 persists provider runtime metadata by canonical thread ID, including `providerInstanceId`, status, JSON `resumeCursor`, and runtime payload (`apps/server/src/persistence/ProviderSessionRuntime.ts`; table introduced by migration 004 and subsequently evolved). Orchestration events are append-only and replayed by sequence (`apps/server/src/persistence/Services/OrchestrationEventStore.ts`). Store a versioned opaque cursor, for example:

`{ schemaVersion, canonicalSessionFile, dieSessionId, dieProtocolVersion, dieVersion }`.

Canonicalize and authorize the path before launch, reject symlink/path escapes, and enforce one active writer per canonical file. Never reconstruct die model history from T3 projections and never write normalized T3 events back into the die transcript. On resume, die's session is authoritative for model continuation; T3's event store is authoritative for already displayed activities. Reconcile using stable entry/tool/task IDs and idempotent append rules rather than replaying everything as new.

A browser reconnect should reattach to the same T3 server-owned process generation and replay T3 projections. A T3 server restart may start a new die RPC process on the persisted session only after obtaining the session-file lease. It can recover settled transcript state, but must **not claim to resume** an in-flight model stream, queued UI prompt, or process-local job. Mark interrupted work explicitly and reconcile surviving OS children according to die's lifecycle journal; do not silently label it completed.

### Child sessions and tasks

Claude and Codex demonstrate the fidelity bar:

- Claude maps SDK `task_started/task_progress/task_completed`, `parent_tool_use_id`, nested agent ownership, assistant/tool traffic, model and usage into generic task events (`apps/server/src/provider/Layers/ClaudeAdapter.ts`, especially the task mapping around lines 3523-3677).
- Codex intercepts child conversation notifications so they cannot corrupt the parent turn, tracks early/unregistered child turns, synthesizes `collabAgent/*`, then maps those to generic task events (`CodexSessionRuntime.ts:932-1937`; `CodexAdapter.ts:1037-1304`). This is substantially more than showing a “subagent” tool row.

Die already owns shell/subagent processes in `TaskManager`. Its task extension binds a manager to a session attachment/generation, persists child session-file lineage, and emits lifecycle journal records. Completion/attention messages are batched custom messages with diagnostic details and are delivered as a steering turn (`src/tasks/extension.ts:226-260,293-368`). Those messages alone are insufficient for a full live Agents panel: they are terminal/attention notifications, not a replayable command-and-event API.

Define a versioned **die-native task protocol**, not ACP translation. It should expose structured lifecycle events and snapshots with at least:

- root task/job ID, kind (shell/subagent/batch/workflow/monitor), status, timestamps and process outcome;
- child die session ID/file token, model, effort/profile, parent task/agent ID and nesting depth;
- activity/progress summaries, token/cost usage, attention reason, unread/output cursor;
- list/inspect, stdin/close-input, stop, snooze, watch, and child-transcript-open operations;
- generation IDs and monotonically increasing event sequence so reconnect can snapshot then continue without races.

The adapter maps these to T3 `task.*`, tool, usage, and runtime-warning events. Nested child assistant/tool items must carry agent attribution so the client re-homes them out of the parent timeline. Child die sessions remain descendants of the root die session; they are not independent writable T3 threads. An optional read-only child detail route may show their transcript. Promoting/forking a child into a new top-level T3 thread is a separate feature with explicit ownership transfer.

Do not synthesize a second user steer when forwarding `task-complete`/`task-attention`: die already injects those into its model queue with `triggerTurn: true`. The web projection may display the notification, while continuation remains owned by die.

## Protocol implementation requirements

The adapter/supervisor must:

- launch an explicit, version-checked die binary with a controlled cwd/environment and `--mode rpc`; stdout is protocol only and stderr is bounded diagnostics;
- correlate requests, serialize writes, bound message sizes, reject malformed envelopes, and preserve unknown custom event payloads for forward compatibility;
- negotiate protocol/capability versions before creating a T3 session; fail visibly on an unsupported combination;
- normalize assistant text/thinking, tools, images, files, turns, model/effort descriptors, usage/cost, requests, task events, runtime diagnostics, and stop reasons;
- close process, streams, leases, pending requests, and subscriptions on scope exit; make stop/interrupt idempotent;
- service extension UI requests explicitly. Unsupported interactive calls must fail with a visible typed error, never hang waiting for a TUI;
- implement `readThread`, rollback/branch semantics, compaction and promptless continuation only when die can honor the declared capability;
- provide T3's required text-generation service for titles/commit/PR text through bounded, isolated die helper sessions, or disable each helper explicitly. Quietly borrowing Codex/Claude would violate a die-only configuration;
- read attachments through T3's validated storage and map supported image MIME/base64 to die. T3 remains upload owner.

Do not advertise generalized approvals unless die supplies a real execution policy. Die currently has project-resource trust and selected confirmations, not T3-style per-shell/edit approval. A full release must either implement a die-side async policy gate (including nested execute and subagents) or clearly declare the provider's approval capability unsupported. Mapping T3's “ask” setting to unconditional execution is unacceptable.

## Update strategy and compatibility gates

Treat both T3 and die as independently versioned dependencies. Every released artifact pins:

- upstream T3 commit/tag;
- fork commit and patch-series version;
- supported die semantic/protocol range;
- web/server artifact hash and platform;
- fixture schema version.

For each candidate T3 update:

1. Read upstream release notes and diffs in contracts, provider driver/adapter, orchestration persistence/projections, WS RPC, client task state, settings metadata, auth, packaging, and migrations.
2. Merge the chosen upstream commit into a temporary integration branch. Resolve by intent, not mechanically.
3. Run upstream's own affected tests unchanged, then the die compatibility suite.
4. Build the actual server+web artifact and run clean-profile migration, local launch, browser reconnect, shutdown, and rollback-to-previous-artifact smoke tests.
5. Review the fork diff against upstream; unexpected edits or generated-file churn block release.
6. Tag the fork, update the submodule pointer/manifest, retain the previous artifact, and publish migration/recovery notes.

Compatibility CI should use deterministic fake die peers and captured sanitized RPC fixtures; it must not require a model call. Required matrices:

- protocol negotiation: minimum/current/next-unknown versions and unknown notifications;
- new session, first turn, multi-turn, interrupt, steer/follow-up, compaction, branch/rollback and settled resume;
- crash before/after cursor persistence, malformed/truncated output, stderr flood, duplicate/out-of-order events, server restart and browser reconnect;
- one-writer lease, same session opened twice, symlink/cwd escape and stale process generation;
- text/thinking/tool/image/file/request normalization and stable-ID deduplication;
- individual/batch/nested subagents, child tools, background shell, input, cancellation, attention, watch/snooze, process failure, usage/cost, and child transcript link;
- T3 event-store replay/projection rebuild and database migration from the previous supported release;
- settings decode/round-trip, unavailable unknown driver, dynamic model inventory, default model selection and helper text generation;
- loopback transparent pairing, remote unauthenticated rejection, credential revocation, WS origin enforcement, and redaction of paths/secrets.

Even with isolation, normal updates may take roughly 1-3 engineer-days when touched seams are unchanged. Provider/orchestration/auth migrations can take a week or more; major event or UI rewrites can require redesign. Budget regular ownership for upstream monitoring, security patches, fixture refresh, cross-platform artifacts, and user-session migration. “Zero-conflict upgrades” is not a credible goal.

## Security and deployment modes

“No login” should mean **no interactive login on the same machine**, not no authorization.

### Local mode (default and first release)

- Bind T3 to `127.0.0.1`/`::1` only.
- Let `die web` create or consume T3's short-lived pairing/bootstrap credential and open the browser. Keep the resulting T3 session/cookie protection; do not compile auth out.
- Bind no die RPC listener. The T3 server spawns die over stdio.
- Use a private T3 data directory and restrictive file permissions. Browser APIs receive opaque session/attachment IDs, never arbitrary filesystem paths.

This provides a no-prompt local experience while retaining protection against unrelated web origins and accidental rebinding.

### Remote mode (later, explicit opt-in)

Any non-loopback bind, reverse proxy, LAN, tunnel, or Tailscale exposure requires T3 authentication/pairing, TLS at the trusted edge, strict allowed origins/forwarded-host configuration, expiry/revocation, rate and connection limits, and audit logs. Do not place bearer credentials in URLs or logs. Provider login remains a separate server-side concern; die/provider secrets never transit to the browser.

A remotely authenticated die web session is effectively remote code execution as the server user: tools can read/write the workspace and spawn processes. Therefore authorization must scope accessible project roots and high-impact task controls, and deployment documentation must state that risk. A public “no-auth” flag is out of scope and should be rejected.

## Delivery phases and acceptance

### Phase 0 — contracts and wire evidence

Freeze a die RPC/task protocol version, record fixtures, define cursor and stable-ID rules, and write the capability matrix. Acceptance: deterministic fake-peer tests prove handshake, snapshot/event ordering, unknown-event tolerance, and cleanup; no UI demo is counted as protocol acceptance.

### Phase 1 — durable local provider core

Implement scoped process supervision, dynamic models/options, text/thinking/tools/files/images, multi-turn, interrupt/steer, helper text generation, T3 persistence mapping, settled resume, launcher, and transparent loopback pairing. Acceptance: clean-profile end-to-end local use, browser reconnect, T3 restart recovery with honest interruption state, one-writer enforcement, and no orphan process in failure tests.

### Phase 2 — complete die jobs/subagents

Add the die task snapshot/event protocol, generic T3 task-control commands, nested attribution, Agents panel details, child transcript view, stdin/stop/snooze/watch, usage/cost, and completion/attention semantics. Acceptance: individual, batch, nested, background and waiting tasks survive UI reconnect without duplicate rows or parent-turn corruption; controls reach the correct process generation; server restart reports non-resumable live work honestly.

### Phase 3 — conversation parity and policy

Complete branch/rollback, compaction, promptless continuation, attachments, extension UI calls, session catalog/import if desired, and an explicit approval policy or explicit unsupported state. Acceptance is per advertised capability; no setting may appear to enforce a policy that die bypasses.

### Phase 4 — remote and release hardening

Add authenticated remote mode, project-root authorization, artifact signing/hash verification, cross-platform packaging, migration/rollback runbooks, and update automation that opens reviewable changes rather than auto-deploying. Acceptance includes an external security review/threat model and upgrade from the previous pinned release.

A realistic initial full local integration (Phases 0-3) is several engineer-weeks, plausibly 6-10 depending on how much task protocol and approval work die needs. Remote/cross-platform hardening can add 2-4+ weeks. Extracting and upstreaming a general provider SDK is a separate multi-week effort and should not block the product. These are planning ranges, not commitments; task recovery and upstream orchestration churn are the main uncertainties.

## Explicit non-goals and later options

- No Cursor ACP bridge or generic lowest-common-denominator translation.
- No browser-to-die direct socket and no second replacement backend.
- No promise that live LLM streams or process-local jobs survive a server/runtime crash.
- No automatic arbitrary session-path browsing.
- No stock-provider credentials or fallback model hidden behind a die label.
- No mobile/desktop parity in the first local web release unless separately accepted.

After the integration is proven, propose upstream changes that are genuinely generic: provider client-definition exports, a trusted provider registration API, and task-control capabilities. If accepted, delete corresponding fork patches. Until then, the pinned fork remains the honest production dependency rather than pretending an unstable internal SPI is a plugin ABI.

## Inspected source anchors

- T3 provider SPI and registration: `apps/server/src/provider/ProviderDriver.ts`, `Services/ProviderAdapter.ts`, `builtInDrivers.ts`, `Layers/ProviderInstanceRegistryLive.ts`.
- Existing high-fidelity adapters: `Layers/ClaudeAdapter.ts`, `Layers/CodexAdapter.ts`, `Layers/CodexSessionRuntime.ts`.
- Contracts and UI: `packages/contracts/src/provider.ts`, `providerInstance.ts`, `providerRuntime.ts`, `settings.ts`; `packages/client-runtime/src/state/subagentRuntime.ts`; `apps/web/src/components/settings/providerDriverMeta.ts`; task rendering in `MessagesTimeline.tsx` and `ChatView.tsx`.
- Persistence/auth: `apps/server/src/persistence/ProviderSessionRuntime.ts`, `Services/OrchestrationEventStore.ts`, auth migrations/services, and `apps/server/src/ws.ts`.
- Die ownership/task behavior: `src/tasks/extension.ts`, `src/tasks/job-service.ts`, TaskManager/lifecycle modules, and the RPC/session sources cited in `die-web-backend-research.md`.
- Prior research context: `.agents/notes/die-web-feasibility.md`, `die-web-t3-research.md`, and `die-web-backend-research.md`. Their temporary recommendation was not used as a constraint here.
