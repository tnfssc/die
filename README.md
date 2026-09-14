# die

`die` is a Bun-compiled coding agent built on [Pi](https://pi.dev). It packages Pi as a standalone executable, provides asynchronous tasks and sub-agents, and replaces Pi's general-purpose file/shell tools with one code execution tool. See [`PRODUCT.md`](./PRODUCT.md) and the validated [`0.1.0` baseline](./docs/phase3-baseline.md).

## Getting started

Released binaries currently support **Linux x64 only**. They use Bun's `bun-linux-x64-baseline` target rather than the AVX2-optimized target, so AVX2 is not a release CPU requirement. Download `die-linux-x64` and
`die-linux-x64.sha256` from a GitHub release, verify it with `sha256sum -c`, make it
executable, and place it in a directory on your `PATH`. Release source links, the MIT
license, and third-party notices are published alongside each binary. Other platforms
have not been validated as release targets.

This README describes the current source tree. For a release, use the README at its corresponding tag.

To build from source, install Bun 1.4.1 (the version pinned in `mise.toml`), Node 24, and pnpm 11, then clone the repository and enter the checkout. Node and pnpm are build-time tools only; the compiled executable does not require an external JavaScript runtime.

## Build

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

The build first produces the pinned, patched T3 Code web bundle as an intermediate and then embeds it in `dist/die`. `bun run build:web` can produce only that intermediate for web-build debugging; it is not a separately distributed or installed artifact.

`@earendil-works/pi-server` is pinned alongside Pi because Pi 0.85.0's unbundled entry point imports it without declaring it as a dependency; the standalone build requires it.

Tool schemas use `zod/mini`. `src/tool-schema.ts` converts them to input JSON Schema for Pi, and tool handlers parse arguments with the same Zod schemas. TypeBox is not a direct dependency of `die`; Pi still depends on it transitively.

## Install locally

```sh
bun run install:local
```

This builds and atomically installs the single executable to `~/.local/bin/die`. The web application is embedded in that executable; no sidecar or external Node runtime is installed. If that directory is not already on `PATH`, the installer prints a reminder. Set `DIE_INSTALL_DIR` to override the destination.

```sh
die --help
die
```

The compiled executable includes its runtime and can be copied to another location on a compatible OS/architecture. API credentials and user configuration are still supplied at runtime as they are for Pi. `die` stores its configuration and persistent state under `~/.die` rather than `~/.pi`. Automatic update checks and the `die update` command are disabled until `die` has its own update channel.

## Command and interactive help

Run `die --help` for the complete command-line option list. Common entry points are:

```sh
die                         # Start the interactive TUI
die -p "Describe this tree" # Run one print-mode prompt
die -c                      # Continue the most recent session
die -r                      # Choose a saved session to resume
```

Inside the TUI, type `/` to browse all commands supplied by die, Pi, installed
extensions, prompt templates, and skills. Die's user-facing additions are:

| Command | Supported behavior |
| --- | --- |
| `/goal` | Show goal status, or `set`, `pause`, `resume`, and `clear` an opt-in durable goal. See [Goal mode](./docs/goals.md). |
| `/mode` | Show or select the main-agent mode. `fast` and `normal` add no mode-specific behavioral prose; `orchestrator` adds its coordination guidance. The selection changes neither model nor thinking level. |
| `/fast` | Show or explicitly set provider-native premium fast mode for the current session/model. Enabling requires cost acknowledgement; see [native fast mode](docs/native-fast-mode.md). |
| `/shake` | Locally remove completed thinking/tool-call/tool-result traces from active model context without a provider request. The append-only transcript and recorded costs remain unchanged; ambiguous or active tool batches are preserved/refused. |
| `/ps` | Open the interactive monitor for running jobs owned by this session; inspect bounded recent output or explicitly stop a selected job. TUI only. |
| `/subagents` | Configure model and thinking inheritance for fast, normal, and orchestrator sub-agents. |
| `/cache-ttl [duration]` | Show or set the local cache-expiry estimate (for example, `30m`, `1h`, or `1d`). It is informational, not a provider cache guarantee. |
| `/status` | Show the compact session status, including combined descendant cost estimates. |

### Local web UI

```sh
bun run build
./dist/die web
```

The normal build uses Node 24 and pnpm to build a pinned T3 Code frontend/server and embeds it in `dist/die`, with the real die runtime behind it and basic agent/task status in T3’s existing UI. Node and pnpm are not needed to run the compiled binary. It opens on localhost without web login or pairing and uses your existing die provider credentials. Cross-origin browser access is blocked; other local processes can access the app. `--no-browser` and `--port` are forwarded to T3. For Die/Pi, the composer’s Mode selector chooses Fast, Normal, or Orchestrator without changing the model or reasoning level.

The first `die web` start extracts embedded web/native files into a private, content-addressed cache at `${XDG_CACHE_HOME:-~/.cache}/die/web-runtime/`. Concurrent starts publish one complete cache directory atomically; CLI-only starts do not extract the web payload. No runtime download is performed. Standard system tools such as Git and a shell are still needed for their respective features.

The T3 source pin and reviewed integration patch live in `web/`. Updates are explicit builds, not automatic downloads at startup.

### Release downloads

Starting with v0.2.14, Linux x64 releases include one `die-linux-x64` executable with the web application embedded. Download the executable and `die-linux-x64.sha256`, verify the checksum, make the executable runnable, and run `./die-linux-x64 web`. It does not require an external Node or pnpm runtime. Source provenance, the project license, and third-party notices and licenses—including the embedded backend’s dependencies—are published beside it.

### Manual context shake

Run `/shake` only after the current turn and queued messages settle. It writes a bounded, branch-scoped projection marker and removes only unambiguous completed execution protocol from future model-facing context. User content, attachments, assistant prose, compaction summaries, and original JSONL usage/cost records remain intact. Upstream extension redactions are never replaced with raw history; if either side of a transformed tool call/result pair cannot be matched exactly, the whole pair is retained. Forked sessions inherit the projection, while branching before its marker does not. Opaque native Codex checkpoints are rejected. `/shake` never summarizes or makes a provider request.

Before native Codex or normal compaction, die also previews a shake. If the serialized active messages shrink by **at least 75% in character count** (`after × 4 ≤ before`), it applies the projection instead of compaction. Otherwise, or if the preview cannot safely be applied, the existing compaction path continues without changing context. This is a character-count heuristic, not a token estimate; the same checkpoint and tool-pair safety rules apply. A successful preview reports “Shake replaced compaction”; Pi may also report compaction as cancelled because no summary checkpoint was created.

Pi's session commands, including `/resume`, `/new`, `/session`, `/tree`, and
`/compact`, remain available. Resumed worker/orchestrator child sessions are labeled
and require confirmation in the TUI because their role and delegation limits persist.

## Tests

```sh
bun run test         # Build, CLI, configuration, and TUI harness tests
bun run smoke         # Standalone shell smoke test
bun run test:llm      # Authenticated GPT-5.6 Luna test (incurs an LLM request)
```

The automated suite verifies the compiled executable in an isolated home directory and uses a private tmux socket for TUI tests. LLM tests always use `openai-codex/gpt-5.6-luna` and are opt-in so ordinary local checks remain deterministic. They include event-level verification of recovery from an `execute` error. See [`docs/phase3-validation.md`](./docs/phase3-validation.md) for the authenticated and real-TUI validation results and remaining UX findings.

## Editing prompts

Start with [the prompt editing guide](docs/prompts.md). `bun run prompt:preview` shows an offline assembled request from the current source; `-- --project .` opts into project instruction files. See the guide for included/excluded context and review history.

## Unified execute helpers

The model now receives **execute only**. Shell commands, sub-agents, and job
management are async helpers inside its TypeScript environment:

~~~ts
console.log(await shell("bun test"));
console.log(await shell("bun run dev", { waitSeconds: 0 }));
console.log(await subagent({ type: "fast", prompt: "Research this module" }));
console.log(await jobs.list({ count: 20 }));
console.log(await jobs.inspect("task_id", { offset: 0, limit: 5000 }));
console.log(await history.search({ query: "exact phrase" }));
console.log(await history.read({ ref: "die-history-v1:…" }));
console.log(await goal.get());
await jobs.snooze("task_id", { minutes: 10 });
await jobs.setWatch("task_id", { enabled: false });
await jobs.input("task_id", "hello\n", { closeInput: true });
await jobs.closeInput("task_id");
await jobs.stop("task_id");
~~~

- Available globals are `shell`, `subagent`, `handoff`, `jobs`, `history`, and `goal`; helpers do not print automatically, so console.log the result fields you need. `history.search`/`history.read` retrieve [bounded original transcript evidence](docs/searchable-history.md), while `goal.get`/`set`/`update`/`clear` manage opt-in durable goal state.
- shell(command, options?) accepts waitSeconds, timeoutSeconds, and closeInput. Shell stdin is closed by default (`closeInput: true`). Set `closeInput: false` at launch to send input later with `jobs.input()`. `jobs.input()` leaves stdin open unless passed `{ closeInput: true }`; `jobs.closeInput()` sends EOF without stopping the job. Closed stdin cannot be reopened.
- subagent({type?, prompt, waitSeconds?, timeoutSeconds?}) selects a configured profile.
  prompts: string[] is supported instead of prompt and returns an array of jobs.
- Shell launches wait up to **3 seconds by default**; sub-agent launches wait up to
  **1 second by default**. A completed job returns background: false plus status,
  exitCode, and output, without a duplicate notification.
  Otherwise background: true returns its id and completion is delivered automatically later.
- waitSeconds: 0 backgrounds immediately. waitSeconds supports 0–86400;
  timeoutSeconds supports 0.1–86400 and independently limits job execution.
- A nonzero command exit returns a failed job; check status/exitCode. Invalid
  arguments, missing jobs, and permission errors reject the helper promise.
- Use Promise.all for concurrent work. Each launch waits independently.
- Job inspection returns at most 5,000 output bytes with nextOffset/hasMore cursors;
  output retention stays at 1 MB per job. jobs.list is paginated with cursor/count,
  defaulting to 20 entries (maximum 100); it includes completed jobs for this session.
- A private IPC channel connects execute workers to the session-owned job manager.
  Background jobs survive normal worker exit. Canceling/timing out execute stops
  the foreground wait, not the jobs; use jobs.stop to stop a job explicitly.
- An idle print/JSON session waits for pending jobs and automatically continues
  when results arrive. Session shutdown kills remaining managed process groups.
- Root agents may delegate to any profile; first-level orchestrators may spawn only
  fast/normal workers. Workers cannot delegate, and no fourth tier is allowed.
- Separate model-facing task and subagent tools are removed. The persisted task_
  IDs and task-complete notification type remain compatible with existing history.

### Cooperative handoff

`await handoff(message)` publishes a progress update and yields through the same
execute interface; it is not another model-facing tool. For example:

~~~ts
const job = await shell("bun test");
if (job.background) await handoff("Tests are running; I’ll report the result when they finish.");
console.log(job.output);
~~~

The helper unwinds the module (including JavaScript cleanup), releases foreground
waits without killing jobs, and returns a cooperative stop hint to Pi. A batch
pauses only when **all** its tool results yield, so a standalone handoff provides
a clear boundary. Ordinary text-only assistant responses remain valid handoffs.
Messages must contain 1–2,000 characters of nonblank progress text. Real execution
or cleanup errors remain errors rather than successful handoffs.

### Sub-agent profiles

Use **/subagents** in the TUI to configure each type's model and thinking level.
The panel shows all six settings directly. Enter on a model opens fuzzy search
by model ID/name or provider, using the currently available configured models.
Choose **Inherit from parent** to reset an override. Thinking has its own picker.
Returning from a picker keeps the settings row selected; Escape goes back, or
discards the draft from the main panel. Choose **Save** to apply changes.
No model IDs need to be typed manually; custom IDs can still be set in the file.

Or edit **~/.die/subagents.json** directly:

```json
{
  "fast": { "model": "provider/fast-model", "thinking": "low" },
  "normal": { "model": "provider/main-model", "thinking": "medium" },
  "orchestrator": { "model": "provider/planning-model", "thinking": "high" }
}
```

Replace these placeholder model IDs with provider/model IDs available to your account.
Omit a model or thinking field to inherit it from the calling agent. A missing file
means all profiles inherit; invalid settings fail explicitly rather than silently
falling back. Thinking values: off, minimal, low, medium, high, xhigh, max.
Settings are read for each spawn, so changes affect future agents without restarting;
running agents are unaffected. TUI saves replace the profile file atomically (last save wins).

The agent chooses `type: "fast"` for quick focused work, `"normal"` for implementation
or debugging, and `"orchestrator"` for coordinating delegated work. Omitted type means
normal. A batch of prompts uses the same type. Per-call model/thinking overrides
are not accepted: profiles control those choices. Only orchestrator
sub-agents may delegate, and the two-level depth limit still applies. This is a
tool policy, not a security sandbox: execute can still run arbitrary processes.

## Herdr integration

When launched in a Herdr root pane, die automatically reports its lifecycle over the inherited local socket. See [docs/herdr.md](docs/herdr.md) for activation, state, and compatibility details.

## Code execution

The model-facing `execute` tool replaces `read`, `edit`, `write`, `bash`, and `powershell`. It transpiles submitted TypeScript in memory using `Bun.Transpiler`, then executes it as a module in an isolated child process in the current working directory. It supports top-level await, static imports and exports, dynamic imports, CommonJS `require`, local modules, Bun APIs, Node built-ins, installed packages, and subprocesses. Results are returned through stdout and stderr; no temporary source file is created.

`execute` returns up to 4,000 characters of combined stdout/stderr directly. Longer output is saved in full to per-execution files, with a truncated preview and file paths returned for later reading or searching. Output already produced before spilling is preserved, including for failed or interrupted executions. Short output creates no log files. This changes only `execute` output: shell jobs retain their existing bounded in-memory output and `jobs.inspect()` behavior.

Long-output files live under `<session-file>.artifacts/execute-<timestamp>-<uuid>/`, as `stdout.log` and/or `stderr.log`. Standalone executions without a session file use a unique directory under the system temporary directory. Files remain available after completion; die does not automatically delete them. If saving fails, the result explicitly reports that error instead of claiming the file is complete.

Cancellation, timeouts, and nonzero exits are reported as tool errors. Session shutdown cancels active executions. On Unix, subprocesses remaining in the execution's process group are killed when its leader exits; use `shell()` for work that must continue in the background. This is process isolation, not a security sandbox; deliberately detached processes can escape group cleanup. Windows currently terminates only the direct child.

Dynamic imports support computed specifiers and resolve when called, so missing-module errors can be caught in submitted code. Installed package entry points respect import/require conditions, condition order, wildcard exports, and private subpaths.

### Image results

Inside `execute`, use `await showImage("screenshot.png")` to return a model-visible image. The helper also accepts `Uint8Array`/`Buffer`, `ArrayBuffer`, and `Blob`/`Bun.file(...)`. PNG, JPEG, and WebP are recognized from their headers. Inputs may be up to 25 MB; images over 5 MB are automatically resized using Pi’s resizer without modifying the original. Output limits remain 4 images, 5 MB each, and 10 MB total per execution. Resized results include original/output dimensions. Only successful executions return attachments. No temporary files are created, though normal session persistence can retain the images. See [`docs/execute-images.md`](./docs/execute-images.md).

All agents receive only `execute`. The session-owned `subagent()` helper enforces role and depth restrictions. Nested jobs use the same foreground/background behavior, and idle JSON sessions remain alive for their pending workers.

## Interactive TUI harness

The harness runs `die` in a detached tmux pseudo-terminal. It defaults LLM sessions to `openai-codex/gpt-5.6-luna` and records artifacts under `artifacts/tui/`.

```sh
bun run tui start demo
bun run tui frame demo
bun run tui send demo "Reply with a short greeting"
bun run tui followup demo "Now reply with one word"
bun run tui history demo
bun run tui record demo 5 250
bun run tui key demo Escape
bun run tui stop demo
```

Each session gets a continuous ANSI transcript plus initial/final frame captures. `record` saves timestamped ANSI frames at the requested interval, making intermediate TUI states inspectable. The session named `demo` is automatically killed after 60 minutes; other sessions have no automatic timeout. Use `bun run tui --help` for the command reference.

## Releases and contributing

Git tags of the form `v<package version>` trigger the release workflow. The workflow
rejects a tag that does not exactly match `package.json`; it does not rewrite source
versions. Releases build and smoke-test the current supported `bun-linux-x64-baseline` target
and publish the binary, SHA-256 checksum, generated full production-dependency license bundle, summary notices, and source revision.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for checkout, deterministic tests, opt-in
model tests, architecture, and pull-request guidance. Die is distributed under the
[`MIT License`](./LICENSE); bundled dependencies and runtime assets remain subject to
the terms summarized in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

See [`PRODUCT.md`](./PRODUCT.md) for the product direction and phase acceptance criteria.

### Sub-agent diagnostics and persistence

Sub-agents now run in JSON event mode with normal persisted Pi sessions rather than `--no-session`. Their session JSONL files live alongside the parent session (or in the normal session directory when the parent is ephemeral). Each file is created before launch, so startup stalls still have a durable identity. Metadata links the job ID, parent session, model, thinking level, type, and depth.

Session names begin with `[orchestrator agent]` or `[subagent · fast/normal]` for identification in `/resume`. Resumed child sessions restore their role/depth delegation restrictions. Standard session retention applies; no extra automatic cleanup is added.

Use `execute` with `jobs.inspect(id)` on unexpectedly slow agents to see the last observed event, current tool, quiet duration, recent output/errors, and the full session path. The activity log remains available after failure or cancellation for the rest of the parent session. Full completed messages/tool history remain on disk after that. Successful completion notifications return the answer rather than the event stream, with a session link for further inspection.

Progress keeps the last 1 MB per job; inspections return at most 5 KB of log output. Individual JSON events exceeding 1 MB are skipped with a diagnostic notice; the session file is the durable source. Progress is observational—not a heartbeat, CPU profile, or guaranteed indication of provider/network liveness. Session files and tool previews can contain sensitive workspace data; they receive the same care as normal agent history. `/ps` provides the interactive running-job monitor described above; see [`docs/task-monitor.md`](docs/task-monitor.md) for controls, bounds, and ownership limits.

### Compact tool and completion views

A collapsed `execute` call and its settled result share one physical summary row, including status and bounded diagnostics. Expanding it reveals retained input and output. Collapsed task-complete and task-attention notifications are likewise one summary row. Their expanded views use bounded head/tail detail and an ellipsis for hidden content. Limits apply after wrapping, so long single-line content stays compact even in narrow terminals.

Use the tool-output expansion shortcut (normally **Ctrl+O**) to reveal retained content. This changes only the terminal presentation, not what is sent to the model or retained in the session. Output already discarded by execute cannot be recovered by expanding. Images continue to use Pi's normal image display.

## Combined session cost

Both footer views include the current session plus all saved orchestrator/worker
descendants. `/status` labels the combined amount as `total`; token, cache, and
context statistics remain local to the current session. Costs refresh roughly
every second and are restored from normal JSONL history on resume. Each child’s
own usage is counted once, including partial billed usage from failed workers;
intermediate orchestrator totals are not counted again. Ordinary forks and
unrelated sessions are excluded. No separate cost ledger is written.

Amounts use provider-recorded cost estimates, not actual invoices or subscription
charges. Usage not yet recorded by a provider is not included. An ephemeral
`--no-session` parent can aggregate its children for that run but cannot restore
its own history later. Moving/deleting session files can break attribution.

## Background interaction

Short foreground budgets—three seconds by default for shell commands, one second
for sub-agents, or zero—preserve the user’s ability to redirect work. A longer wait deliberately holds the conversation even
if the script reads other files concurrently. `shell()` gives ordinary commands
session ownership so progress can continue after the current turn ends.

When a launch hands off to the session, execute adds a short model-facing handoff
notice: continue useful independent work or end the turn; completion will resume
the agent. This notice does not change stdout or make helpers print automatically.
Job IDs are local to their launching session. Inspecting a nested worker requires
its owning orchestrator, not the root session.

See [the natural-background UX audit](docs/background-ux-audit.md) for observed
failures, fixes, real-terminal evidence, and remaining limitations.

## Working values

Die’s own guidance emphasizes responsive collaboration, purposeful attention,
evidence-led communication, proportionate effort, and clear ownership. Precise
API facts are kept separate from those values. Role prompts describe an agent’s
contribution, while handoff notices explain how returning control preserves task
ownership. Edit [`src/prompts/system.md`](src/prompts/system.md) for the system
prompt; supporting prompts live beside it. `src/prompts.ts` imports those Markdown
sources. See [prompt design](docs/prompts.md).

The values-oriented workflow is validated with medium reasoning (the SDK default).
Minimal-reasoning stress probes still show intermittent polling. Validation details
and the unchanged responsiveness criteria are recorded in [prompt design](docs/prompts.md).

Startup is quiet by default: skill/resource inventories and the Pi self-help
promotion are hidden. Skills remain available as `/skill:…` commands; resource
warnings remain visible. `--verbose` can show diagnostic startup details. This
default does not rewrite user settings. The model’s default prompt also omits
Pi’s internal-documentation instructions.

Codex uses native opaque checkpoints. Other providers prepare the entire current
model-facing conversation through the normal prompt, context, tools, auth and
provider hooks, then append a summarization instruction with the same cache
identity. Pi deliberately replays its existing recent tail (about 20k tokens by
default) after the whole-conversation summary, so summary/tail overlap is expected.
An older request capture measures cache affinity; it no longer gates plaintext
compaction. If that current-context request cannot be prepared or fit, compaction
is cancelled instead of flattening unprocessed history through another summarizer.

Native Codex checkpoints currently require their original provider/model;
switching is blocked rather than silently losing context. Codex's existing
preflight fallback rules are unchanged. Cache reuse is not a guarantee of lower
cost. See [compaction implementation and evidence](docs/compaction-research.md).

## Project-local memory extension

The integrated opt-in [project-memory extension](docs/project-memory.md) supports filesystem topic notes and explicitly requested managed consolidation through `/memory consolidate fast|normal --constraints <text>`. Consolidation is manual only: automatic assignment-completion, turn, settled-event, job-completion, and shutdown triggers remain undecided and disabled.
