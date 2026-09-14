# Current die application inventory for a Go rewrite

> Scope: repository source as inspected on 2026-09-13. This describes the current tree, not only the last installed/released binary. The package reports **0.2.8** (`package.json`), while the README still warns that the locally installed binary discussed there is older; a port should use source and tests as authority rather than release prose alone (`README.md`, `package.json`). No web sources were used.

## Executive summary

Die is not a thin CLI around an LLM API. It is a Bun-compiled product shell around Pi 0.85.0 with one large hidden extension that owns model-facing tools, managed processes and subagents, persistence adapters, provider hooks, compaction, and most product UI. The model sees exactly one tool, `execute`; TypeScript submitted to it runs in an isolated child process and receives session-owned helper APIs over private IPC (`src/cli.ts`, `src/tasks/extension.ts`, `src/typescript/extension.ts`, `src/typescript/execution.ts`, `src/typescript/job-bridge.ts`).

A Go rewrite therefore has two possible scopes:

1. retain Pi/Bun as a subprocess/runtime and replace orchestration/UI incrementally; or
2. replace Pi as well, which requires reimplementing provider/auth behavior, session JSONL and branching, extension lifecycle hooks, compaction, the TUI, and the JavaScript/TypeScript execution contract.

The second is a product/runtime rewrite, not merely a language port.

## Implemented architecture

### 1. Bootstrap, packaging, and Pi host

- `src/cli.ts` is both the user CLI entry point and the internal execute-child entry point. It rejects Pi tool-selection flags, disables Pi update behavior, installs Die's system prompt, registers Bun OAuth flows, dynamically imports Pi after environment setup, and starts Pi with hidden Die task and Herdr extensions.
- The binary sets `AI_AGENT=die`, `PI_CODING_AGENT=true`, `PI_PACKAGE_DIR=~/.die/runtime/<version>`, and `PI_SKIP_VERSION_CHECK=1`. It materializes immutable embedded Pi themes, artwork, and HTML-export assets only when absent because Pi expects filesystem paths (`src/cli.ts`).
- `src/system-prompt.ts`, `src/prompts.ts`, and Markdown in `src/prompts/` assemble the Die-owned base prompt and dynamic role/collaboration guidance. Child role/delegation constraints are restored from session metadata, not only environment variables (`src/tasks/extension.ts`, `docs/system-instructions.md`).
- Quiet startup and dense conversation rendering are installed before Pi starts. These are runtime adaptations of Pi UI classes, including prototype wrapping rather than independent UI widgets (`src/ui/startup.ts`, `src/ui/conversation-density.ts`).

### 2. Central extension and lifecycle

`src/tasks/extension.ts` is the composition root. It registers diagnostics, native fast mode, cache countdown, instruction modes, manual shake, native and plaintext compaction, subagent settings, task monitor, resume safeguards, goal mode, project memory, history routing, compact footer/renderers, and the execute tool. On `session_start` it restores child identity, scopes instruction continuity, forces active tools to `["execute"]`, and installs UI. On shutdown it clears session-scoped state and awaits managed-job shutdown.

The central extension also:

- owns one lazy `TaskManager` and `JobService` per attached session;
- batches completion and attention messages into model-visible steering turns;
- keeps print/JSON sessions alive while owned background work is pending;
- routes `history.*` and `goal.*` locally and all other helper calls to `JobService`;
- injects root mode or child role guidance at `before_agent_start`; and
- emits job activity to the Herdr adapter (`src/tasks/extension.ts`).

### 3. Execute runtime

- Pi registers one Zod-validated `execute` tool (`src/typescript/extension.ts`, `src/tool-schema.ts`).
- Each call launches the current executable with `--die-internal-execute` in a detached child/process group. The parent pipes source on stdin and captures stdout, stderr, an image channel, and an optional Node/Bun IPC job channel (`src/typescript/execution.ts`, `src/cli.ts`).
- The runner transpiles TypeScript in memory with `Bun.Transpiler`, evaluates it as a module, supports top-level await, ESM/CJS, Node built-ins, Bun/Web APIs, local modules and installed packages, and includes custom package import/export resolution (`src/typescript/runner.ts`).
- Helper globals are installed in the child: `shell`, `subagent`, `handoff`, `jobs`, `history`, and `goal`. Calls are framed across private IPC to the session owner; response acknowledgement protects the completion/worker-exit race (`src/typescript/job-bridge.ts`, `README.md`).
- Inline combined output is limited to 4,000 characters. Larger stdout/stderr spills to per-execution artifact files adjacent to the session artifact directory (or a unique temp directory without a session); failures to persist are explicit (`src/typescript/output-capture.ts`).
- `showImage` accepts path/Blob/buffer forms, recognizes PNG/JPEG/WebP, permits inputs up to 25 MB, resizes over-5 MB images with Photon, and returns at most four images, 5 MB each and 10 MB total (`src/typescript/images.ts`, `docs/execute-images.md`).

### 4. Session-owned jobs and subagents

- `TaskManager` owns command and agent child processes, bounded output, foreground waiting, list/inspection, stdin, stop, timeouts, and shutdown. Output retention is 1,000,000 bytes per job; inspection is capped at 5,000 bytes. Stop sends SIGTERM to the Unix process group, escalates to SIGKILL after five seconds, and shutdown has a ten-second watchdog (`src/tasks/task-manager.ts`).
- `JobService` validates helper calls and launches shell commands or Pi child sessions. Shell foreground wait defaults to three seconds; subagents to one second. A wait expiry backgrounds without killing the job. A nonzero command exit is a failed job result, not an IPC exception (`src/tasks/job-service.ts`, `README.md`).
- Jobs remain owned by the main session after an execute worker exits. Cancelling/timing out execute cancels only its foreground wait; explicit `jobs.stop` controls the job (`src/typescript/job-bridge.ts`, `src/tasks/job-service.ts`).
- `subagent` supports one prompt or a batch. Profiles `fast`, `normal`, and `orchestrator` resolve model/thinking settings from `~/.die/subagents.json`; invalid settings fail rather than silently falling back. Root may launch all profiles, first-level orchestrators may launch fast/normal only, workers cannot delegate, and no fourth tier is allowed (`src/tasks/subagent-profiles.ts`, `src/tasks/agent-session.ts`, `README.md`).
- Child sessions are persisted as Pi JSONL with Die parent/job/type metadata. Resume safeguards preserve child identity and ask for TUI confirmation; combined descendant cost scans those links without double counting (`src/tasks/agent-session.ts`, `src/tasks/resume-safeguards.ts`, `src/tasks/session-costs.ts`).
- Completion delivery is deduplicated around foreground/background boundaries and coalesced with attention notices. Quiet/review timers, snooze, and watch state drive automatic attention turns (`src/tasks/completion-batcher.ts`, `src/tasks/completion-notification.ts`, `src/tasks/job-attention.ts`).

### 5. State, retrieval, and optional workflows

- **Goals:** opt-in, branch-local durable custom JSONL records with objective, criteria, constraints, progress/status, bounded continuation, and runtime-owned waiting job IDs. `/goal` and execute helpers manage state; a successful handoff with running work is the only automatic transition to waiting (`src/goals/`, `docs/goals.md`).
- **History:** bounded, read-only retrieval from the original active-branch transcript. It excludes thinking, tool-call payloads, hidden messages, summaries, and execution results removed by shake. Cross-session access requires both an explicit path and per-call consent; stable refs and cursors are snapshot/scoping checked (`src/history/service.ts`, `docs/searchable-history.md`).
- **Project memory:** ordinary Markdown under `.agents/notes/`; direct `.pending/*.md` inputs can be consolidated only by explicit root `/memory consolidate fast|normal --constraints ...`. SHA-256 snapshots/receipts and content-addressed consumed markers prevent consuming changed or unsuccessfully saved inputs. There is no model-facing memory tool and no automatic trigger (`src/memory/store.ts`, `src/memory/extension.ts`, `docs/project-memory.md`). Current source/docs explicitly use ordinary filesystem writes **without a project-wide lock**, despite later PRODUCT narrative mentioning cooperative exclusion; verify intended direction before porting (`docs/project-memory.md`, `PRODUCT.md`).
- **Diagnostics:** best-effort bounded custom session entries, never correctness authority. Job lifecycle metadata is also written to `<session-file>.jobs.jsonl`, bounded to 2 MiB and protected on Linux x64 with Bun FFI advisory locking; historical jobs are not reattached (`src/diagnostics.ts`, `src/diagnostics-extension.ts`, `src/tasks/task-lifecycle.ts`, `docs/diagnostics.md`).

### 6. Provider/context behavior

- Provider-attempt hooks feed cache countdown and diagnostics; a local `~/.die/cache-settings.json` controls the informational TTL estimate (`src/tasks/provider-attempts.ts`, `src/tasks/cache-countdown.ts`, `docs/cache-countdown.md`).
- `/fast` is explicit and cost-acknowledged, allowlisted by provider/model, guarded at serialized request payloads, persisted in branch state, and does not claim billing confirmation. Compaction always uses the default tier (`src/tasks/native-fast-mode.ts`, `docs/native-fast-mode.md`).
- Codex uses provider-native opaque compaction checkpoints. Other providers receive a cache-affine plaintext summarization request built from the current model-facing pipeline; failure to prepare/fit cancels rather than flattening raw history (`src/tasks/native-compaction.ts`, `src/tasks/cache-affine-compaction.ts`, `docs/compaction-research.md`).
- `/shake` creates a branch-scoped projection that removes only completed execution protocol from future context while retaining append-only transcript and cost records. It refuses active/ambiguous batches and opaque native checkpoints (`src/tasks/manual-shake.ts`, `README.md`).

### 7. TUI and external integration

- Compact/detailed footer shows path, model/thinking, running jobs, cache countdown and combined descendant cost; `/status` exposes expanded state (`src/ui/footer.ts`).
- Tool calls/results and completions use compact foldable previews; conversation density wrappers suppress/reflow Pi components and translate mouse regions (`src/ui/execution-previews.ts`, `src/ui/conversation-density.ts`).
- `/ps` is a TUI-only, event-driven monitor for this session's running jobs: bounded inspection and confirmed stop only. It does not aggregate grandchildren or unrelated processes (`src/ui/task-monitor.ts`, `src/tasks/task-monitor.ts`, `docs/task-monitor.md`).
- `/subagents` provides model fuzzy-search and thinking pickers with atomic profile save (`src/ui/subagent-settings.ts`, `src/tasks/subagent-settings-ui.ts`).
- Root interactive sessions can report working/idle/blocked and session identity to Herdr over its inherited local socket. Child/non-UI sessions do not report; failures are bounded and nonfatal (`src/herdr-agent-state.ts`, `docs/herdr.md`).

## Behavior parity checklist

A compatible rewrite should preserve observable contracts before optimizing internals:

1. **CLI/config:** Pi-compatible main CLI modes and session commands; `~/.die` paths; fixed execute-only tool set; disabled self-update; Linux x64 baseline release behavior (`src/cli.ts`, `README.md`).
2. **Prompt precedence:** user custom root system prompts remain overrides, while children always retain role/delegation limits; dynamic goal/memory/continuation messages must not accidentally destabilize the base prefix (`src/system-prompt.ts`, `src/tasks/extension.ts`, `docs/system-instructions.md`).
3. **Execution semantics:** fresh isolated module per call; TypeScript, ESM/CJS and dynamic import behavior; cwd/env inheritance; exact error/cancellation signaling; process-group cleanup; output artifacts; image channels (`src/typescript/runner.ts`, `src/typescript/execution.ts`).
4. **Job ownership:** work survives execute-worker exit, has stable session-local IDs, bounded cursor inspection, writable/closable stdin, exactly-once completion at wait boundaries, explicit kill escalation, and awaited shutdown (`src/tasks/task-manager.ts`, `src/typescript/job-bridge.ts`).
5. **Conversation turn boundaries:** background completion/attention triggers a steer turn; idle print/JSON mode waits; handoff unwinds the execute module but leaves owned work alive; batch handoff stops only when every result yields (`src/tasks/extension.ts`, `src/typescript/job-bridge.ts`, `docs/background-ux-audit.md`).
6. **Delegation:** profile inheritance/failure behavior, depth/role policy, persistent child JSONL and resume restrictions, and descendant cost attribution (`src/tasks/subagent-profiles.ts`, `src/tasks/agent-session.ts`, `src/tasks/session-costs.ts`).
7. **Persistence compatibility:** Pi session tree/branch semantics and all Die custom entries (agent identity, goal, mode, fast, cache, shake, compaction, diagnostics), plus cross-session read-only behavior. Existing sessions should either migrate deterministically or be explicitly unsupported (`src/goals/store.ts`, `src/tasks/resume-safeguards.ts`, `src/history/service.ts`).
8. **Provider safety:** request identity captured before awaits, request-local retries counted separately, fast-tier payload guards, original-model native checkpoint restriction, and compaction refusal paths (`src/tasks/provider-attempts.ts`, `src/tasks/native-fast-mode.ts`, `src/tasks/native-compaction.ts`).
9. **Bounds/security posture:** preserve all byte/count/path/cursor limits and fail-closed exclusions. The runtime is process isolation and policy enforcement, **not** an adversarial sandbox (`src/typescript/images.ts`, `src/history/service.ts`, `src/memory/store.ts`, `README.md`).
10. **UI accessibility:** very short terminal behavior, draft/focus preservation, mouse mapping, sanitization of control sequences, confirmation before stop/resumed-child capability, and cleanup of subscriptions/timers (`src/ui/`, `docs/task-monitor.md`).

## Runtime dependencies, Pi integration, and vendor adaptations

### Direct/runtime dependencies

- Bun **1.4.1** is pinned and embedded into the compiled artifact; the local engine declaration is `>=1.4.1` (`mise.toml`, `package.json`).
- Four `@earendil-works` Pi packages are pinned to **0.85.0**: `pi-ai`, `pi-coding-agent`, `pi-server`, and `pi-tui`. `pi-server` is an explicit workaround because Pi's unbundled entry imports it without declaring it (`package.json`, `README.md`).
- Other direct runtime libraries are `es-module-lexer` (module analysis), `resolve.exports` (package resolution), and `zod`/`zod/mini` (schema validation). Pi transitively brings provider SDKs (Anthropic, OpenAI, Google, AWS Bedrock), TypeBox, terminal/rendering packages, and Photon image resizing (`package.json`, `node_modules/@earendil-works/pi-ai/package.json`, `node_modules/@earendil-works/pi-coding-agent/package.json`).
- Runtime assets copied from Pi include themes, Clankolas artwork, export HTML template, Highlight.js and Marked; Photon WASM is separately embedded (`scripts/prepare-assets.ts`, `runtime-assets/`).

### Patches/adaptations

There is no checked-in dependency patch set and no `patchedDependencies` entry. “Vendor patches” are behavioral wrappers in Die source:

- prototype override of Pi `SettingsManager.getQuietStartup` (`src/ui/startup.ts`);
- prototype/component wrapping of Pi TUI containers and message renderers (`src/ui/conversation-density.ts`);
- wrapping Pi request preparation and `AgentSession._checkCompaction/getContextUsage` for shake/accounting (`src/tasks/manual-shake.ts`);
- provider request/response hooks for compaction, fast mode and cache tracking (`src/tasks/native-compaction.ts`, `src/tasks/cache-affine-compaction.ts`, `src/tasks/native-fast-mode.ts`);
- a local typed adaptation of Herdr's managed Pi integration, using compatible agent identity `pi` because Herdr lacks native `die` identity (`src/herdr-agent-state.ts`, `docs/herdr.md`).

Licensing inputs pin Pi 0.85.0 and Bun 1.4.1 notices. Releases generate a bounded full production dependency attribution bundle; Linux artifacts use `bun-linux-x64-baseline` (`third_party/README.md`, `THIRD_PARTY_NOTICES.md`, `scripts/generate-third-party-notices.ts`, `.github/workflows/release.yml`).

## Key tests and validation surfaces

The suite is behavior-heavy; port tests by contract rather than mechanically translating TypeScript.

- **Compiled product/packaging:** `tests/cli.test.ts`, `tests/prepare-assets.test.ts`, `tests/release-workflows.test.ts`, `scripts/smoke.sh`.
- **Execute language/runtime:** `tests/typescript-execution.test.ts`, `tests/typescript-runner.test.ts`, `tests/error-diagnostic.test.ts`, `tests/execute-output-capture.test.ts`, `tests/typescript-images.test.ts`, `tests/offline-process-isolation.test.ts`.
- **IPC/jobs/races:** `tests/job-bridge-protocol.test.ts`, `tests/job-bridge.test.ts`, `tests/job-service.test.ts`, `tests/task-manager.test.ts`, `tests/turn-boundaries.test.ts`, `tests/worker-handoff.test.ts`, `tests/cooperative-handoff.test.ts`, `tests/execute-handoff.test.ts`.
- **Background UX and TUI:** `tests/background-ux.test.ts`, `tests/background-ux-tui.test.ts`, `tests/background-interrupt-tui.test.ts`, `tests/task-monitor.test.ts`, `tests/task-monitor-tui.test.ts`, `tests/execution-previews-tui.test.ts`, `tests/tui-harness.test.ts`.
- **Subagents/persistence/cost:** `tests/agent-session.test.ts`, `tests/subagent-extension.test.ts`, `tests/subagent-profiles.test.ts`, `tests/resume-safeguards.test.ts`, `tests/session-costs.test.ts`, `tests/session-costs-tui.test.ts`, `tests/phase2-native-sdk.test.ts`.
- **Prompt/context/provider:** `tests/system-prompt.test.ts`, `tests/provider-prompt.test.ts`, `tests/prompt-delivery.test.ts`, `tests/instruction-continuity-sdk.test.ts`, `tests/manual-shake.test.ts`, `tests/cache-affine-compaction-sdk.test.ts`, `tests/native-compaction.test.ts`, `tests/native-fast-mode.test.ts`, `tests/cache-countdown-sdk.test.ts`.
- **Durable features:** `tests/goals.test.ts`, `tests/goals-sdk.test.ts`, `tests/goals-tui.test.ts`, `tests/history.test.ts`, `tests/memory-store.test.ts`, `tests/memory-extension.test.ts`, `tests/memory-extension-integration.test.ts`, `tests/diagnostics.test.ts`, `tests/task-lifecycle.test.ts`.
- **Live/authenticated gates:** files named `*-live.test.ts` and `tests/llm.test.ts` exercise real SDK/provider paths and are opt-in where credentials/cost are involved; deterministic tests do not prove provider wire compatibility (`README.md`, `docs/phase3-validation.md`).

## Porting risks

| Risk | Why it is high | Relevant sources |
| --- | --- | --- |
| Pi replacement scope | Pi currently supplies CLI parsing, auth/model registry, provider SDK abstraction, session tree/JSONL, compaction hooks, extension API and TUI. No Go equivalent is selected in this repository. | `src/cli.ts`, `package.json`, `docs/system-instructions.md` |
| TypeScript contract | `execute` explicitly promises Bun/Node/ESM/CJS/package semantics. A typical embedded Go JS VM does not provide Bun.Transpiler or Node package resolution; requiring external Bun changes the “Go rewrite” deployment story. | `src/typescript/runner.ts`, `README.md` |
| Private Pi seams | Prototype and quasi-private method wrapping is version-sensitive. A rewrite must derive intended behavior from tests, not preserve these implementation hooks blindly. | `src/ui/conversation-density.ts`, `src/tasks/manual-shake.ts` |
| Concurrency/exactly-once delivery | Foreground deadline, child exit, IPC acknowledgement, cancellation, completion batching, attention, and session shutdown race. Duplicate or lost continuation is user-visible. | `src/typescript/job-bridge.ts`, `src/tasks/task-manager.ts`, `src/tasks/extension.ts` |
| Process portability | Unix process groups and signals are core cleanup semantics; Windows is already weaker. Linux-only FFI locking also blocks a naive cross-platform promise. | `src/typescript/execution.ts`, `src/tasks/task-manager.ts`, `src/tasks/task-lifecycle.ts` |
| Session compatibility | Branch-aware custom records, stable entry IDs, child metadata, shake exclusions, compaction checkpoints and cost attribution are coupled to Pi JSONL behavior. | `src/history/service.ts`, `src/goals/store.ts`, `src/tasks/session-costs.ts` |
| Provider wire behavior | Native Codex compaction and fast tiers depend on endpoint/payload/auth details and request-local identity. Generic LLM interfaces may erase required controls. | `src/tasks/native-compaction.ts`, `src/tasks/native-fast-mode.ts`, `docs/compaction-research.md` |
| Prompt/cache regressions | Small ordering changes can alter system-prefix caching, child safety framing, compaction input, or goal continuation. | `src/system-prompt.ts`, `src/tasks/instruction-continuity.ts`, `tests/provider-prompt.test.ts` |
| Bounded-data safety | History, memory, diagnostics, output and images intentionally have different limits and fail-closed rules. Consolidating them into one generic storage abstraction may weaken semantics. | `src/history/service.ts`, `src/memory/store.ts`, `src/typescript/output-capture.ts` |
| Documentation drift | `PRODUCT.md` is chronological and mixes old plans, implemented milestones, ideas and stale claims; README release notes also lag current package version. | `PRODUCT.md`, `README.md`, `package.json` |

## Implemented versus PRODUCT-planned

`PRODUCT.md` is a historical/product notebook, not a clean future specification. Treat items as implemented only when current source and tests support them.

### Implemented in current source

- compiled standalone CLI; asynchronous jobs/subagents; execute-only model tool; unified helpers and session-owned IPC jobs (`PRODUCT.md` “Phases 1–3” and “Unified execute API”; `src/cli.ts`, `src/typescript/`, `src/tasks/`);
- profile-based three-tier delegation, persistent child sessions, task monitor phase 1, combined descendant cost, compact previews, images, attention checkpoints/cache countdown, goal mode, manual shake, compaction, searchable history, explicit project-memory consolidation, diagnostics, and Herdr lifecycle reporting (corresponding source modules and tests listed above).

### Planned, deferred, or idea-only

- **Persistent/reusable execute context:** explicitly ideation; current calls are isolated (`PRODUCT.md` “Ideation — Persistent execution context”, `src/typescript/execution.ts`).
- **Task monitor phase 2:** richer monitor interaction is deferred. Note that execute-level `jobs.input/closeInput` exists; what is absent is that interaction in `/ps` (`PRODUCT.md` “Monitor phase 2”, `docs/task-monitor.md`).
- **Automatic memory consolidation / persistent profile-cost consent:** disabled; only explicit per-invocation consolidation exists (`PRODUCT.md` “Conditional memory consolidation”, `docs/project-memory.md`).
- **Ask-user form/helper and TUI:** recorded direction only; correlation, cancellation and blocking semantics are unsettled (`PRODUCT.md` “Recorded idea — Ask-user form”).
- **Generated `api.d.ts` and `help()`:** recorded direction only (`PRODUCT.md` “Discoverable execute API reference”).
- **Cross-platform releases:** deferred; only Linux x64 baseline is validated (`PRODUCT.md` “Explicitly deferred”, `README.md`, `.github/workflows/release.yml`).
- **Self-update channel:** absent and explicitly disabled (`src/cli.ts`, `README.md`).
- **Automatic assignment-completion detection:** no authoritative signal exists; `agent_end`, settled events and shutdown are intentionally not treated as assignment completion (`docs/project-memory.md`).

Do not mistake superseded Phase 2 requirements for future parity. In particular, the old separate task/subagent model-facing tools were intentionally replaced by the single `execute` tool and helper bridge (`PRODUCT.md` “Historical Phase 2 tool selection (superseded)” and “Unified execute API”; `src/tasks/extension.ts`).
