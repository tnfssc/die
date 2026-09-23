# Die web backend feasibility (T3 Code adapter)

**Research date:** 2026-09-14
**Scope:** current die backend only. Research only: no implementation, installs, production edits, model calls, or revival of the abandoned Go experiment.
**Inspected versions:** die 0.2.10 and @earendil-works/pi-* 0.85.0 (package.json, bun.lock).

## Bottom line

A local die-backed web UI is feasible without recreating die's runtime.
The smallest credible boundary is **one long-lived 'die --mode rpc' child process per open session, supervised by the T3 backend**, with an adapter translating Pi JSONL to the frontend protocol.

This is preferable to embedding the SDK initially and strongly preferable to Pi-server:

- The executable already boots the exact die prompt, extensions, task manager, execute sandbox, private job bridge, subagent process tree, compaction hooks, providers, and session persistence used by the CLI (src/cli.ts:84-155).
- Pi RPC already carries image prompts, streaming agent/tool events, steer/follow-up/abort, models, compaction, session operations, current-session costs, and serializable extension UI requests (installed Pi docs/rpc.md and dist/modes/rpc/rpc-types.d.ts).
- SDK embedding is possible, but die has no library export and subagents currently spawn process.execPath as if it were the die executable (src/tasks/job-service.ts:181-204).
  In a T3/Bun host that assumption is not safe.
- @earendil-works/pi-server is an experimental routing substrate, not a coding-agent web server.
  The application must provide services, session discovery, Session/Harness workers, lifecycle, and a browser gateway.
  Its shipped transport is Unix and peer auth remains application policy (pi-server README.md, package.json, dist/types.d.ts).

This preserves the real runtime, not full T3/TUI parity.
Missing surfaces include direct browser job control, session discovery/deletion, provider login/logout, descendant-session cost, generalized approval policy, durable live-job resume, and several TUI-only settings.

## Current runtime

### Bootstrap and distribution

- src/cli.ts is the only production entry.
  It sets AI_AGENT=die, PI_CODING_AGENT=true, PI_PACKAGE_DIR and PI_SKIP_VERSION_CHECK before dynamically loading Pi; registers Bun OAuth flows; injects die's system prompt; and supplies hidden die-tools and die-herdr-agent-state extension factories (lines 84-155).
- src/system-prompt.ts and src/prompts.ts build die identity and collaboration/subagent guidance.
  Pi still appends user additions, project context, skills and cwd (src/prompts.ts:63-69).
- package.json is private and exports only the dist/die bin.
  Build is a compiled Bun executable.
  The current release workflow emits one Linux x64 standalone binary plus checksums/notices (.github/workflows/release.yml).
  There is no supported JS backend package.
- The executable identity matters.
  Isolated TypeScript execution defaults to process.execPath plus an internal runner argument (src/typescript/execution.ts:48,81).
  Subagents run process.execPath with --session, --mode json and -p (src/tasks/job-service.ts:181-204).
  This works when the parent is compiled die.

**Distribution consequence:** use die as a versioned sidecar for the first backend.
Accept an explicit binary path/version and do not deep-import bundled internals or assume a global install.
Cross-platform distribution is not currently solved beyond Linux x64 releases.

### Execute, jobs, and subagents

- src/tasks/extension.ts assembles the runtime and makes execute the sole active model tool on session_start (lines 549-558).
  It dispatches history/goal methods or a session-scoped JobService (lines 397-440).
- src/typescript/extension.ts and execution.ts implement isolated JS/TS. The child accesses jobs through the private framed src/typescript/job-bridge.ts protocol.
- src/tasks/job-service.ts:129-288 implements shell, subagent, jobs.list, jobs.inspect, jobs.input, jobs.closeInput, jobs.stop, jobs.snooze and jobs.setWatch.
  Schemas/user guidance come from src/tool-schema.ts and execute prompts.
- src/tasks/task-manager.ts owns detached child process groups, bounded output, foreground/background handoff, stdin, timeout/kill escalation, event subscriptions and shutdown (especially lines 158-260 and 273-480).
- Subagents are separate die JSON-mode children with durable session files. src/tasks/agent-session.ts:5-23 persists the header and die-agent role metadata before launch.
  JobService enforces role/depth and resolves profiles (src/tasks/job-service.ts:153-204; src/tasks/subagent-profiles.ts).

**Boundary gap:** these jobs remain fully available to the model through execute, but jobs.* are **not Pi RPC commands**.
A browser cannot directly list/stop/input jobs via stock RPC.
The private job bridge is per execute invocation and is not a suitable public session API.
A web jobs panel needs a small die-owned control endpoint; an initial transcript-only UI can still preserve runtime behavior.

### Background notifications

- TaskManager emits completion/activity; JobAttentionScheduler derives quiet/review notifications and watch/snooze behavior (src/tasks/job-attention.ts).
- src/tasks/extension.ts:203-259 batches completion/attention and sends a visible custom message with deliverAs=steer and triggerTurn=true.
  RPC subscribers receive resulting message/agent events without a TUI.
- The agent_end wait at src/tasks/extension.ts:442-527 is only for print/json, whose runtimes otherwise exit. RPC remains alive and retains its TaskManager.
- session_shutdown disposes attention and calls manager.shutdown(), terminating running jobs (src/tasks/extension.ts:561-577; task-manager.ts:431-480).

So the backend process must outlive browser disconnects to preserve background work.
A reconnect can resync conversation state, but if the RPC child dies, active jobs and in-flight model/UI operations do not resume.

### Sessions and resume

- Pi publicly exposes SessionManager.create/open/continueRecent/list/listAll/inMemory/forkFrom (installed dist/core/session-manager.d.ts).
- RPC exposes new_session, switch_session(path), fork, clone, get_fork_messages, get_entries, get_tree, get_messages, naming and state.
  Startup also supports --continue, --session path|id, --session-dir and --no-session (installed docs/rpc.md and docs/usage.md:190-205).
- RPC does not list/delete sessions.
  The adapter needs a read-side catalog, preferably a narrow helper/endpoint around SessionManager.list(cwd, sessionDir) and listAll(), not browser-supplied arbitrary paths.
- Persisted die-agent entries restore child identity and fail closed on malformed identity (src/tasks/extension.ts:100-180,529-555).
- Friendly child labels and confirmation before entering a child are TUI-only (src/tasks/resume-safeguards.ts:146-180).
  RPC restores restrictions but does not show that warning.
  A web catalog should mark/hide child sessions by default and require explicit entry.
- Switching emits shutdown and recreates session-scoped task state. Enforce one RPC writer per canonical session file.

### Authentication and providers

Two meanings of auth must remain separate:

1. **Local web app auth:** none is required by the product.
  Bind loopback by default.
  If exposed beyond loopback, no auth is a remote-code-execution risk because die runs shell/TypeScript; that must be an explicit secured deployment choice.
2. **Provider authentication:** still required.
  Pi ModelRuntime defaults to agentDir/auth.json plus models.json and handles environment keys, stored keys/OAuth credentials, custom providers, login/logout and refresh (installed dist/core/sdk.d.ts, model-runtime.d.ts, auth-storage.d.ts, docs/providers.md).

RPC lists/sets models and thinking levels but has no credential list/login/logout commands.
Minimum scope should reuse credentials configured via CLI/environment and report provider-sign-in failures clearly.
Web provider onboarding needs a separate backend API over ModelRuntime.login/logout and AuthInteraction.
Never send raw credentials to the browser.

The /subagents profile editor is TUI-only and tells non-TUI users to edit the profile file (src/tasks/subagent-settings-ui.ts:7-34).
Runtime profile selection is headless, but a web settings panel needs a dedicated file/API mapping.

**Project trust is a third, separate approval concept.** Pi non-interactive modes, including RPC, do not show the project-trust prompt.
Without a saved decision, the default ask/never behavior ignores project extensions, skills, prompts and context; --approve or --no-approve overrides one launch (installed docs/usage.md:126-132).
The adapter must choose and surface this deliberately.
It should not silently pass --approve for an arbitrary cwd.
Die's built-in hidden factories and base prompt still load from the executable, but user/project resources may differ from an already-trusted TUI launch.

### Compaction and costs

- RPC exposes compact(customInstructions), auto-compaction/retry controls and compaction/retry events.
  SDK exposes AgentSession.compact() and the same lifecycle (installed docs/rpc.md, docs/compaction.md, dist/core/agent-session.d.ts).
- Die registers cache-affine and native Codex compaction hooks in src/tasks/extension.ts:83-120; logic is in cache-affine-compaction.ts and native-compaction.ts.
  Core behavior is not TUI-bound; notices can travel over extension UI RPC.
- RPC get_session_stats / SDK getSessionStats() reports messages, tool usage, tokens, context and **current-session** cost; assistant messages also contain provider-reported usage/cost.
- Die's root-plus-descendant subagent cost is computed by SessionCostTracker (src/tasks/session-costs.ts) and only shown in the TUI footer (src/ui/footer.ts:286-382).
  It is absent from RPC.
  Full die-equivalent cost display needs a small endpoint/export; otherwise label the number current-session only.
- Provider billing is the source of truth, especially for OAuth/subscription surfaces (src/ui/footer.ts:139-143).

### TUI coupling

Core behavior is substantially headless.
SDK tests create AgentSession, load die factories, bind mode=print, and exercise runtime behavior without a TUI (for example tests/auto-shake-sdk.test.ts, current-pipeline-sdk.test.ts, manual-shake-sdk.test.ts and native-fast-mode.test.ts).
AgentSession.bindExtensions accepts uiContext, mode, command actions, abort/shutdown and error hooks (installed dist/core/agent-session.d.ts).

Presentation coupling remains:

- Footer/editor/conversation density/task monitor/subagent settings/resume picker are TUI-only or mode-guarded (src/ui/* and relevant src/tasks files).
  Replace them with web views rather than emulating terminal components.
- notify/status/widget/select/confirm/input/editor are transportable.
  RPC emits extension_ui_request and accepts correlated extension_ui_response.
  Component factories/custom overlays are unsupported (installed docs/rpc.md:1160-1374 and rpc-types.d.ts).
- Native fast premium-cost confirmation is explicitly TUI-only; non-TUI requires startup --accept-cost (src/tasks/native-fast-mode.ts:555-577).
  A web backend must not silently pass this flag.

## Option comparison

| Option | Benefits | Gaps/risks | Verdict |
|---|---|---|---|
| Spawn die --mode rpc | Exact shipped bootstrap; standalone isolation; preserves prompts/tools/jobs/subagents/providers/sessions/compaction; typed JSONL; images and extension UI | One process/session; supervision; no direct jobs/session-list/provider-auth/descendant-cost API; live operations die with process | **Start here** |
| Embed Pi SDK + die factory | Direct AgentSession and subscriptions; custom UI/control plane | Die is private/no exports; bootstrap not reusable; process.execPath breaks subagents/runner in host; requires asset/env/OAuth extraction | Possible later after intentional refactor |
| Pi-server | Multi-presentation/session routing primitives | Experimental; Unix only; no peer auth; host/services/repo/Harness/workers/browser transport are application-owned; no die integration | Not first backend |
| Reimplement in T3 | UI-native API | Duplicates hardest semantics and drifts | Reject |

## RPC surface useful to T3

From installed rpc-types.d.ts and docs/rpc.md:

- Input: prompt, steer, follow_up (all accept base64 images), abort, clear_queue.
- State/model: get_state/messages, set/cycle/list models, thinking levels, steering/follow-up modes.
- Compaction/retry: compact, set_auto_compaction, set_auto_retry, abort_retry.
- Sessions: new/switch/fork/clone, fork messages, entries/tree, session name.
- Misc: direct bash/abort, current-session stats, HTML export, slash commands.
- Events: message/thinking/tool deltas; tool start/update/end; turn/agent lifecycle; queue; compaction/retry; bash updates; extension errors.
- UI: correlated select/confirm/input/editor and fire-and-forget notify/status/widget/title/editor text.

Use request IDs and one ordered stdin writer.
Parse only LF records; Pi warns that generic line splitting may incorrectly split U+2028/U+2029 inside JSON strings (docs/rpc.md).
Treat stdout as protocol and stderr as diagnostics.
Preserve unknown custom message types.

## Required gaps and limits

### Multimodal

- Input images work now through prompt/steer/follow_up.
- Die execute can emit validated PNG/JPEG/WebP through a bounded image channel; images become tool-result content (src/typescript/images.ts:1-215; execution.ts:166-213).
  The adapter must map MIME/base64 and size limits to T3 attachments.
- T3 owns upload reading/storage/validation before encoding RPC input. There is no die upload API.

### Approvals

- Pi/die has **no generalized shell/edit/execute permission popup policy**.
  Project-resource trust (above) is separate and does not approve individual tool executions.
  Pi documentation explicitly says permission popups are not included (installed docs/usage.md:309).
  Die activates execute and runs its operations directly.
- RPC supplies confirmation mechanics, not approval policy. The only relevant die confirmation found is premium fast-mode consent, and it is TUI-only.
- Full T3 approval parity so cannot be promised by forwarding RPC.
  It requires a die policy/gate, probably async tool_call interception plus RPC confirm, with semantics for nested execute operations, timeouts/cancel, remembered choices and subagents.
  Approving only outer execute may be too coarse because one call can issue many shell/job operations.

### Notifications, steering and reconnect

- Forward die task-complete/task-attention custom messages; do not synthesize another steer, or model continuations can duplicate.
- User steer and follow-up are first-class. For Esc-like cancellation, Pi recommends clear_queue before abort if queued text should be restored.
- Keep the child alive for a bounded period across browser disconnects. There is no durable live-job registry or notification replay beyond persisted session/custom messages.

### Resume

- Start with --session PATH --mode rpc, or switch while idle. On attach/reconnect fetch get_state plus entries/messages before consuming new events.
- Do not claim active-operation resume after backend restart. LLM streams, queued UI prompts and TaskManager children are process-local.
- Catalog and deletion need a narrow backend API. Canonicalize cwd/session paths and enforce one writer.

### Costs

- Initially show get_session_stats as current-session provider-reported cost.
- Descendant cost must come from SessionCostTracker's lineage scan; do not naïvely sum files.
- Costs are estimates, not billing promises.

## Smallest architecture

1. **Process registry:** T3 backend keys an RPC child by canonical session path (or temporary new-session key), enforces one writer, and launches an explicit versioned die binary with cwd and --mode rpc.
2. **RPC supervisor:** response correlation, ordered writes, event forwarding, extension UI servicing, stderr diagnostics, exit detection and frontend reconnect/resync.
3. **Protocol mapper:** Pi assistant/tool/session structures to T3 structures. Preserve entry IDs, tool-call IDs and unknown custom messages such as task-complete/task-attention.
4. **Read-only session catalog:** narrow helper around SessionManager.list/listAll or a new die endpoint; mark child sessions and reject arbitrary browser paths.
5. **Provider status:** reuse local credentials first. Keep provider login and secrets as separate backend scope.
6. **Optional die control API:** add only when browser job controls, descendant cost, profiles or approval policy are required.
  Keep it in die so it reaches the live session objects rather than scraping transcript output.
7. **Loopback default:** no local web login; explicitly reject/secure non-loopback deployment.

Bound concurrency: each root RPC child may itself create multiple shell/subagent processes.
Resource limits are product policy and should not silently change die delegation semantics.

## Rough scope (not a parity promise)

Assuming T3 already has an adapter interface and local WebSocket/SSE route:

- **2-4 engineering days:** RPC supervisor/codec; prompt, streaming, steer/abort; basic current-session state; stderr/exit; one platform; existing provider credentials.
- **3-6 more days:** robust session catalog/open/new ownership; reconnect/resync; multimodal mapping; extension UI; model/thinking/compaction/current cost; offline/mock lifecycle tests.
- **2-5 more days:** die-owned job control, descendant cost and profile endpoints plus frontend panels, if required.
- **3-7+ more days:** generalized approval policy; highly dependent on operation granularity and persistence/inheritance rules.
- **1-2+ weeks before adapter work for SDK embedding:** reusable bootstrap/library exports, explicit die executable injection into runner and JobService, lifecycle/UI ownership and packaging.
- **Several weeks/research project for Pi-server:** service contracts, Harness/session host, workers, browser gateway and die integration against an experimental API.

The 2-4 day item is a feasibility spike, not shippable parity.
A useful safe local product with sessions is more realistically **about 1-2 engineering weeks**, excluding generalized approvals, provider onboarding, cross-platform binaries and frontend-specific work.

## Recommendation and acceptance boundary

Proceed with a **sidecar RPC spike**, not SDK extraction or Pi-server.

Validate with offline/mock streams only: prompt/event mapping, execute tool events, custom background messages, steering, image serialization, compaction events, session reopen and shutdown.
Define initial acceptance as real die prompts/tools/subagents/jobs internally, current-session persistence/resume, existing provider credentials, current-session costs, multimodal transcript and browser reconnect while the backend process lives.

Explicitly defer or separately scope direct web job controls, durable job resume, descendant aggregate costs, web provider login, TUI-only settings and generalized approvals.
Do not claim full TUI parity.

## Primary sources inspected

Die:

- package.json, bun.lock, .github/workflows/release.yml
- src/cli.ts, src/system-prompt.ts, src/prompts.ts
- src/tasks/extension.ts, job-service.ts, task-manager.ts, agent-session.ts, job-attention.ts, resume-safeguards.ts, session-costs.ts, session-cost-root.ts, native-compaction.ts, cache-affine-compaction.ts, native-fast-mode.ts, subagent-profiles.ts, subagent-settings-ui.ts
- src/typescript/extension.ts, execution.ts, job-bridge.ts, images.ts
- src/ui/footer.ts, startup.ts, conversation-density.ts
- SDK/headless/background/job/session-cost tests (inspection only; not run)

Installed Pi 0.85.0:

- pi-coding-agent/docs/rpc.md, sdk.md, sessions.md, providers.md, compaction.md, usage.md
- pi-coding-agent/dist/core/sdk.d.ts, agent-session.d.ts, session-manager.d.ts, model-runtime.d.ts, auth-storage.d.ts
- pi-coding-agent/dist/modes/rpc/rpc-types.d.ts, rpc-mode.d.ts, rpc-client.d.ts
- pi-coding-agent/dist/main.js and rpc-entry.js
- pi-server/package.json, README.md, dist/types.d.ts, server.d.ts and session-router.d.ts
