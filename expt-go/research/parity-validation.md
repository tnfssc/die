# Differential parity validation plan

> Research/design only, 2026-09-13. This document defines acceptance work for the Go rewrite described in `godie/CONSTRAINTS.md`: Go owns the product, sessions, providers, and jobs; a bundled Bun child preserves `execute`. Unless listed under **Experiments actually executed**, checks below are proposed and have **not** been run. No live provider call was made during this research.

## Decision rule and scope

“Parity” means the current source-built Die and the Go candidate have the same user-observable contract, not merely that translated unit tests pass. The comparison baseline must be an immutable build from the exact commit under test; the installed `die` and README may be older than the source. Linux x64 baseline is required. Cross-platform behavior remains out of scope unless separately promised.

A release candidate passes only when:

1. every **P0** row below passes on both programs and its differential oracle passes;
2. every applicable **P1** row passes, with any intentional difference approved and recorded as a product change rather than normalized away;
3. the current deterministic Bun suite passes against the frozen baseline, equivalent contract tests pass against Go, and the cross-implementation scenarios pass;
4. at least one explicitly authorized live check passes for every provider/auth path claimed as supported; and
5. evidence proves process, home-directory, session, credential, and network isolation.

Tests may normalize volatile timestamps, random IDs, temporary absolute paths, terminal title sequences, and provider prose where a row says so. They must **not** normalize exit status, ordering, role/depth, job state, branch shape, tool schema, limits, signal cause, persisted custom-entry meaning, request options, token/cost accounting, or visible confirmation/refusal text.

### Result vocabulary

- **PASS**: both sides satisfy the stated contract and the normalized differential is equal.
- **COMPAT-PASS**: different bytes, same explicitly defined semantic projection.
- **BLOCKED**: prerequisite unavailable (for example no authorized provider); never counts as pass.
- **EXPECTED-DIFFERENCE**: approved product change with owner and migration/release-note requirement; never silently treated as parity.
- **FAIL**: contract or differential mismatch, unexplained crash/hang, evidence leak, or isolation breach.

## Frozen subjects and runner interface

The future parity runner should require explicit binaries and never resolve `die` from `PATH`:

```bash
export BASE_REV=<full-current-source-commit>
export BASE_BIN="$PWD/.parity/subjects/current-die"   # copied after bun run build
export GO_BIN="$PWD/.parity/subjects/go-die"
sha256sum "$BASE_BIN" "$GO_BIN" > .parity/subjects/SHA256SUMS
"$BASE_BIN" --version
"$GO_BIN" --version
```

Build subjects once, copy them read-only, and run scenarios from a clean checkout/worktree. Record compiler/runtime versions and the exact source revisions. Do not compare a newly built Go program to an unknown local installation.

Each scenario receives a newly created root with separate `base/` and `go/` trees containing:

- isolated `HOME`, `DIE_CODING_AGENT_DIR`, `DIE_CODING_AGENT_SESSION_DIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, and `TMPDIR`;
- identical copied workspace fixtures (including spaces, Unicode, symlinks, and a read-only fixture where relevant);
- `HERDR_ENV=0` with `HERDR_SOCKET_PATH` and `HERDR_PANE_ID` removed, except the dedicated fake-Herdr scenario;
- a minimal allowlisted `PATH`, fixed `TERM=xterm-256color`, `COLORTERM`, `LANG=C.UTF-8`, timezone, terminal dimensions, and umask; and
- no provider variables or auth in offline scenarios.

A suggested invocation shape is:

```bash
./parity-run scenario <id> --baseline "$BASE_BIN" --candidate "$GO_BIN" \
  --evidence "$PWD/.parity/runs/$(date -u +%Y%m%dT%H%M%SZ)-<id>"
```

The runner does not exist yet. It should be implemented as a non-model harness with PTY support, JSONL parsing, child PID tracking, deterministic fake provider endpoints, and secret-aware evidence writing. Existing Bun tests are useful oracles, but are not the differential runner.

## Differential acceptance matrix

### A. Packaging, CLI, configuration, and startup

| ID | Pri | Scenario and drive | Acceptance oracle | Required evidence |
|---|---:|---|---|---|
| A01 | P0 | Fresh isolated home: `--version`, `--help`, no usable `PATH`. | Exit 0; product version matches the subject; branded help and supported modes/options agree; removed generic tool-selection flags and self-update are absent. Fresh startup touches only the isolated home. | argv, status, stdout/stderr, before/after file manifest. |
| A02 | P0 | Invoke each of `--no-tools`, `--no-builtin-tools`, `--tools=read`, `--exclude-tools=bash`, and `update`. | Nonzero status and Die-specific refusal; no session/provider request. | streams, status, fake-network request count. |
| A03 | P0 | Interactive, print, JSON/event, initial-message, `--continue`, `--resume`, named session, `--session-dir`, `--offline`, model/provider selection, and `--` parsing. | Mode, argument precedence, output channel, persistence, and exit lifecycle match. The model-facing tool set is exactly `execute`. | semantic CLI/event transcript and session manifest. |
| A04 | P0 | First launch, second launch, 16 concurrent first launches, interrupted extraction, corrupt/truncated cache entry, read-only existing cache. | Assets and bundled Bun are extracted atomically into versioned isolated storage; no partial executable is observed; valid immutable files are not rewritten; corruption has deterministic recovery/refusal; permissions are not broader than needed. | file hashes/modes/mtimes, per-process results, extraction trace. |
| A05 | P0 | Launch copied binary with repository, Bun, and node modules unavailable and `PATH` empty. | Standalone startup/help works. Execute scenarios use the bundled, pinned Bun rather than host Bun. | process executable map and opened-file trace limited to scenario root/system libraries. |
| A06 | P1 | Malformed/unreadable settings, auth, model store, cache settings, and subagent profiles; unknown flags; unwritable home/session directory. | Same warning/error/fallback policy and exit status; no destructive rewrite of malformed input unless baseline does so. Invalid delegation settings fail rather than silently downgrade. | pre/post hashes, streams. |
| A07 | P1 | SIGINT/SIGTERM at startup, idle TUI, active foreground request, and shutdown with jobs. stdin EOF and non-TTY invocation. | Terminal is restored, shutdown is bounded, output is not duplicated, and owned-job behavior matches the relevant job row. | signal timeline, tty settings before/after, child topology. |

### B. Bundled Bun and `execute`

Drive B rows first through a model-independent execute protocol fixture in each implementation; then sample B01/B04/B07 through one live model tool call to prove integration.

| ID | Pri | Scenario and drive | Acceptance oracle | Required evidence |
|---|---:|---|---|---|
| B01 | P0 | Type annotations, JSX-free TS syntax, top-level await, thrown primitive/Error, rejected promise, syntax error. | Fresh isolated module per call; success/error classification, diagnostic location, cancellation, and visible result match semantically. | submitted code, runner protocol, status/result. |
| B02 | P0 | ESM and CJS local modules; dynamic import; Node built-ins; Web and Bun APIs; installed package with `exports`; cwd containing spaces/Unicode and symlink. | Resolution and cwd/env inheritance match current runner. Candidate must not accidentally use repository dependencies. | module fixture hashes and resolution trace. |
| B03 | P0 | Module-level mutation then a second execute; concurrent executes. | No JS global/module state leaks between calls; independently cancelled calls do not interfere. | per-call PID/runtime identity and outputs. |
| B04 | P0 | Interleaved stdout/stderr at 3,999, 4,000, 4,001 chars and much larger; invalid UTF-8/control sequences; artifact write failure. | Inline combined output boundary, ordering policy, head/tail preview, spill location, full artifact bytes, explicit persistence failure, and TUI sanitization match. | raw streams, displayed frame, artifact hashes. |
| B05 | P0 | `showImage` with path, Blob, Uint8Array, Buffer, ArrayBuffer; PNG/JPEG/WebP; invalid type; 4/5 images; 5 MB and aggregate 10 MB boundaries; input over 25 MB. | Type/format/count/input/output limits and resize behavior match; image bytes are on the image channel, not silently dumped to text. | dimensions/MIME/size/hash and structured result. |
| B06 | P0 | Cancel/timeout execute while its child creates descendants; runner crashes or IPC closes mid-call. | Execute runner and only its owned transient descendants are reaped. Jobs already handed to Go ownership survive. Error/cancel result is emitted once. | PID/PGID/start-time timeline and job state. |
| B07 | P0 | In one execute call invoke `shell`, `subagent`, `handoff`, `jobs.*`, `history.*`, and `goal.*`; malformed request frames, duplicate response/ack, oversized frame. | Global API shape, defaults, validation text/class, acknowledgement race handling, and handoff unwind match. No legacy model-facing tools appear. | schema snapshot and IPC frame log with content redaction. |
| B08 | P1 | `console.log` objects, circular data, bigint, undefined, binary, very long lines, import-time output, late output after result. | Serialization, ordering, truncation, and failure are user-equivalent and bounded. | raw and normalized output. |

### C. Shell jobs, ownership, races, and turn boundaries

| ID | Pri | Scenario and drive | Acceptance oracle | Required evidence |
|---|---:|---|---|---|
| C01 | P0 | Foreground shell finishes before, at, and after default 3 s wait; explicit 0/custom wait; exit 0/nonzero; timeout. | Wait expiry backgrounds without killing; nonzero exit is a failed job result, not helper transport failure; fields/defaults agree. | monotonic timeline and structured results. |
| C02 | P0 | Background command emits >1 MB, alternating streams, and no output. Inspect with offset/limit and pagination before/after completion. | Stable session-local ID; retention 1,000,000 bytes, inspect max 5,000 bytes, cursor/lost-output behavior and terminal status agree. | generated byte sequence and all inspect pages. |
| C03 | P0 | Child reads two stdin writes, then `jobs.closeInput`; write after close; launch with `closeInput` true/false. | Bytes and close semantics match; closed input cannot reopen; errors are stable and bounded. | child echo and helper results. |
| C04 | P0 | Race completion against foreground wait expiry, execute exit, handoff, attention, and parent idle boundary in TUI/print/JSON. | Exactly one completion delivery; attention plus completion is deduplicated/coalesced correctly; print/JSON stays alive while owned work is pending; model wake/steer boundary matches. | event sequence with monotonic timestamps. |
| C05 | P0 | Stop a process tree that traps TERM; observe escalation after 5 s. Separately cancel execute after handing off another job. | TERM then KILL targets only the verified owned group; handed-off job survives runner cancellation; final cause and output agree. | signal audit plus sentinel proof described below. |
| C06 | P0 | Exit app with running shell/agent jobs; normal shutdown, crash, and 10 s watchdog edge. | Awaited shutdown policy and lifecycle records match; historical jobs are not falsely reattached after restart. | jobs sidecar, process census, restart inspect result. |
| C07 | P1 | `jobs.list` pagination, unknown/stale IDs, stop-after-exit, concurrent stop/input/inspect, snooze/watch toggles and 5/10 minute attention using fake clock where possible. | Validation, idempotency, watch state, and bounded evidence match. | API transcript and timer trace. |

### D. Delegation, prompts, provider/context behavior

| ID | Pri | Scenario and drive | Acceptance oracle | Required evidence |
|---|---:|---|---|---|
| D01 | P0 | Root launches fast/normal/orchestrator; orchestrator launches workers; worker attempts delegation; attempt fourth tier; batch prompt with mixed completion. | Profile resolution and model/thinking inheritance match; workers cannot delegate, orchestrators cannot launch orchestrators, and depth fails closed. Batch handoff waits for every yielded result. | child metadata, prompts, results, session links. |
| D02 | P0 | Root custom system prompt, default prompt, resumed child with custom prompt, malformed/unreadable child marker. | Root override precedence matches; child role/safety/delegation constraints always remain; unreadable/ambiguous identity never restores root authority. | provider-bound prompt blocks hashed plus allowlisted structural excerpts. |
| D03 | P0 | Deterministic fake providers exercise retries, overlapping requests, pre-fetch rejection, unsuccessful HTTP response, transport without HTTP hook, and model switch. | Request identity is captured before awaits; attempt/retry attribution, cache countdown, and diagnostics are request-local and nonfatal. | redacted request/event chronology. |
| D04 | P0 | Fast mode eligibility, TUI cost confirmation accept/decline, non-TTY `--accept-cost`, persisted branch state, retry, then compaction. | Allowlist and exact payload tier guards match; no unacknowledged premium mode; compaction always uses default tier; UI does not claim billing proof. | redacted serialized request projections and branch entries. |
| D05 | P0 | Codex native compaction success/failure/wrong original model/opaque checkpoint; non-Codex cache-affine compaction fit/refusal/failure. | Wire payload projection and refusal rules match. Plaintext failure never falls back to flattening raw history. | fake-server requests with headers/bodies secret-redacted, resulting context/checkpoint. |
| D06 | P1 | Cache TTL settings and provider attempt, resume, descendant request, shake invalidation, clock boundary. | Per-agent/exact-model state, coarse display, persistence, and descendant isolation match. | fake-clock state and footer/status frames. |
| D07 | P1 | Completion and attention payloads containing prompt injection/control bytes/huge output. | Safety framing and bounded mixed evidence survive; UI controls are sanitized; base system-prefix stability is preserved where promised. | provider input segmentation hashes and frames. |

### E. Sessions, branches, retrieval, goals, memory, diagnostics

| ID | Pri | Scenario and drive | Acceptance oracle | Required evidence |
|---|---:|---|---|---|
| E01 | P0 | Create multi-branch baseline session with messages, execute, costs, child links, goal/mode/fast/cache/shake/compaction/diagnostic custom records. Resume every leaf in each implementation. | Active-branch context and visible transcript match; stable entry/parent semantics and custom records retain meaning. Existing current-app sessions open read-only or migrate deterministically without overwriting the source fixture. | source/copy hashes, normalized tree, provider-bound context. |
| E02 | P0 | Reopen a current-app child session directly, accept/decline TUI capability confirmation, then attempt forbidden delegation. | Child identity is visibly disclosed and cannot become root through resume; decline is non-destructive. | PTY frames and metadata. |
| E03 | P0 | Descendant tree with duplicate links, missing/corrupt child, branches, and known synthetic costs. | Combined cost includes descendants exactly once and remains branch/session scoped; corruption is bounded and reported. | tree fixture and computed totals. |
| E04 | P0 | History search/read over branches, hidden/thinking/tool entries, summaries, shaken execution, Unicode and limit boundaries; stale/wrong cursor/ref. Cross-session omit/deny/allow consent. | Only documented model-visible original transcript is returned; bounds, snapshots, refs and explicit cross-session consent match; operation is read-only. | pre/post hashes and pages. |
| E05 | P0 | Goal create/update/show/clear, max criteria/progress/evidence, handoff with zero/one/multiple running jobs, attention and resume. | Branch-local records, legal transitions, bounded continuation and waiting IDs match. Only successful handoff with running work automatically enters waiting. | branch entries and event/frame chronology. |
| E06 | P0 | Manual shake with completed, active, ambiguous, failed, and multiple execute batches; branch before/after; native checkpoint present. | Only completed execution protocol is projected out of future context; transcript and costs remain append-only; unsafe/native cases refuse. | pre/post JSONL hash/tree and provider context diff. |
| E07 | P1 | Explicit root memory consolidation over unchanged/changed pending files, save failure, child invocation, malformed receipt, symlink/path escape. | No automatic/model-facing memory feature appears; snapshots/receipts/consumed markers are content-addressed; changed or unsaved input is not consumed; paths stay under project notes. | isolated project manifest and result. |
| E08 | P1 | Fill diagnostics ring/durable budget and 2 MiB job sidecar; malformed entries; append failure; session switch/shutdown. | Allowlisted metadata only, documented 100/128/10,000/2 MiB bounds, best-effort non-authority behavior, owner attachment, and no job reattachment match. | schema/key audit, sizes, health counters. |
| E09 | P1 | Two app processes target same/copy session and notes concurrently; abrupt death during append. | No silent truncation or cross-session ownership. Any baseline limitation is documented; Go must not create a worse user-visible outcome. | fs trace, parse results, hashes. |

### F. Real PTY/TUI and external integration

These are true PTY checks, not renderer unit tests. Use a unique tmux socket per run, e.g. `tmux -L "die-parity-$RUN_ID-$SIDE"`, fixed 120x40 initially, and capture raw ANSI plus `capture-pane -p`. The current `scripts/tui-harness.ts` hardcodes `dist/die`, a model, and inherited home, so do **not** use its `start` command for parity until it accepts explicit binary/config roots. Drive tmux directly or add a dedicated isolated runner later.

| ID | Pri | Scenario and drive | Acceptance oracle | Required evidence |
|---|---:|---|---|---|
| F01 | P0 | Offline startup at 120x40, type an unsent draft; exercise `/status`, `/ps`, `/subagents`, `/mode`, `/goal`, `/cache-ttl`, `/fast`, `/shake`, `/memory`, and `/diagnostics` including cancel/refusal paths; then submit/cancel. | Quiet startup, focus, draft, cursor and footer survive overlays/cancel; no network. | timestamped ANSI frames and plain captures. |
| F02 | P0 | Resize through 120x40, 40x8, 20x4, then restore; Unicode wide/combining/emoji content and long unbroken line. | No panic/hang; layout remains usable at very short heights; restored frame, wrapping and cursor placement are equivalent. | size/event/frame sequence. |
| F03 | P0 | Execute preview while running/success/failure/cancelled, expand/collapse with Ctrl+O, completion and attention previews. | One compact physical summary row when collapsed; bounded head/tail detail and correct status when expanded; discarded output is not resurrected. | raw and stripped frames. |
| F04 | P0 | `/ps` with two noisy jobs, navigate, inspect, decline then confirm stop. | Selection/focus/draft retained; explicit confirmation; only chosen session-owned job stops; bounded output updates event-driven. | PTY recording and all process identities. |
| F05 | P0 | Background completion while editing and while assistant streams; Escape/Ctrl-C; follow-up (Alt-Enter); rapid keys during redraw. | No lost draft, duplicated turn, interleaved corrupt frame, or stuck input; turn boundaries match. | input log and event/frame timeline. |
| F06 | P1 | `/subagents` fuzzy model and thinking pickers, cancel/save, malformed settings. | Current selection, keyboard navigation, cancel semantics, and atomic persisted profile agree. | frames and pre/post config hashes. |
| F07 | P1 | Inject ANSI CSI/OSC, tabs, bidi/control text, terminal-title/clipboard-like sequences through job and model output; mouse on wrapped previews. | Untrusted output cannot execute terminal controls beyond baseline-safe rendering; visible sanitization and mouse hit mapping match. Any baseline security bug is a release blocker, not desired parity. | escaped-byte frame and terminal-emulator events. |
| F08 | P1 | Fake local Herdr socket with root interactive, child, print/JSON, missing/slow/malformed socket, inherited real-looking pane vars. | Only root interactive reports bounded working/idle/blocked/session identity; failures nonfatal; isolated tests never contact inherited socket. | fake-server method/field names only, no content secrets. |
| F09 | P1 | TTY EOF, SIGHUP, tmux pane kill, app crash, normal exit. | Alternate screen, cursor, echo and mouse modes restore; no orphan tmux/app/runner process. | `stty` snapshots and child census. |

### G. Live provider checks (explicit opt-in, paid/networked)

Live tests are acceptance checks, but none were executed for this research. They require `DIE_PARITY_LIVE=1`, a named provider/model allowlist, a human-approved maximum request and cost budget, and separate authorization to spend. Run baseline and candidate against the same provider/model near in time, but compare structure rather than generated wording.

| ID | Pri | Live scenario | Acceptance oracle |
|---|---:|---|---|
| G01 | P0 for each claimed path | One minimal print-mode response with no tool. | Both authenticate from isolated copies, stream/finalize, persist usage/cost, and exit without exposing credentials. |
| G02 | P0 | Prompt the model to call `execute` exactly once with deterministic TS that prints a nonce and uses a local module. | Exactly one `execute`; nonce/result and tool transcript structure match; bundled Bun is used. |
| G03 | P0 | Prompt one short background `shell` and `handoff`; await completion. | Job survives execute return, parent waits/wakes, completion appears once, process exits cleanly. |
| G04 | P0 if supported | One worker subagent call with a deterministic question. | Child profile/model/thinking, role restriction, persistent session link, and descendant cost are correct. |
| G05 | P0 if claimed | Accepted fast request and a tiny compaction fixture where provider supports it. | Redacted wire projection proves tier/checkpoint behavior; request count stays within budget. |
| G06 | P1 | Interactive PTY streaming, cancel once, resume the resulting session. | Terminal lifecycle, cancellation accounting, and resumed context are user-equivalent. |

Do not demand identical prose, token counts, latency, or price between sequential live calls. Require event ordering, finish/error class, tool calls, provider/model identity, request options, session shape, and internally consistent usage/cost. A provider outage is BLOCKED, not PASS.

## Concrete baseline scenario commands

These commands illustrate executable probes against the frozen current binary. The future runner should encode them rather than relying on manual shell state.

### Read-only CLI probe

```bash
set -euo pipefail
ROOT=$(mktemp -d)
trap 'rm -rf -- "$ROOT"' EXIT
mkdir -p "$ROOT/home" "$ROOT/tmp"
env -i HOME="$ROOT/home" TMPDIR="$ROOT/tmp" PATH=/nonexistent \
  "$BASE_BIN" --version >"$ROOT/version.out" 2>"$ROOT/version.err"
env -i HOME="$ROOT/home" TMPDIR="$ROOT/tmp" PATH=/nonexistent \
  "$BASE_BIN" --help >"$ROOT/help.out" 2>"$ROOT/help.err"
find "$ROOT/home" -mindepth 1 -printf '%P\t%y\t%m\n' | LC_ALL=C sort >"$ROOT/files.tsv"
```

Repeat with `GO_BIN`; compare status and output, then semantic file manifests. Keep the run root when collecting evidence; remove it only after redaction and archive creation.

### Offline real PTY skeleton

```bash
set -euo pipefail
SIDE=base                         # repeat with SIDE=go
BIN=$BASE_BIN
ROOT=$(mktemp -d)
SOCK="die-parity-${USER:-u}-$$-$SIDE"
SESSION="parity-$SIDE"
cleanup() { tmux -L "$SOCK" kill-server 2>/dev/null || true; rm -rf -- "$ROOT"; }
trap cleanup EXIT INT TERM
mkdir -p "$ROOT/home" "$ROOT/config" "$ROOT/sessions" "$ROOT/tmp" "$ROOT/work"
# The only server killed is the uniquely named one created here.
tmux -L "$SOCK" -f scripts/tmux.conf new-session -d -s "$SESSION" -x 120 -y 40 -c "$ROOT/work" \
  env -i HOME="$ROOT/home" TMPDIR="$ROOT/tmp" LANG=C.UTF-8 TERM=xterm-256color \
  HERDR_ENV=0 DIE_CODING_AGENT_DIR="$ROOT/config" \
  DIE_CODING_AGENT_SESSION_DIR="$ROOT/sessions" \
  "$BIN" --offline --no-session --provider openai --model gpt-4o
tmux -L "$SOCK" capture-pane -p -e -t "$SESSION:0.0" >"$ROOT/start.ansi"
tmux -L "$SOCK" send-keys -t "$SESSION:0.0" -l 'draft-not-submitted'
tmux -L "$SOCK" resize-window -t "$SESSION:0" -x 40 -y 8
tmux -L "$SOCK" capture-pane -p -e -t "$SESSION:0.0" >"$ROOT/small.ansi"
tmux -L "$SOCK" resize-window -t "$SESSION:0" -x 120 -y 40
tmux -L "$SOCK" send-keys -t "$SESSION:0.0" C-c
```

The model/key names here reproduce existing offline fixtures and do not cause a request under `--offline` unless a message is submitted. The final harness must poll for a semantic ready marker rather than sleep a fixed duration.

### Live auth preparation without mutating real auth

```bash
# Run only after explicit live/cost authorization.
test "${DIE_PARITY_LIVE:-0}" = 1
umask 077
ROOT=$(mktemp -d)
trap 'rm -rf -- "$ROOT"' EXIT
mkdir -p "$ROOT/config" "$ROOT/sessions" "$ROOT/home" "$ROOT/tmp"
cp -- "$HOME/.die/agent/auth.json" "$ROOT/config/auth.json"  # OAuth refresh writes only this copy
chmod 600 "$ROOT/config/auth.json"
env -i HOME="$ROOT/home" TMPDIR="$ROOT/tmp" LANG=C.UTF-8 \
  DIE_CODING_AGENT_DIR="$ROOT/config" DIE_CODING_AGENT_SESSION_DIR="$ROOT/sessions" \
  DIE_PARITY_LIVE=1 "$BASE_BIN" -p --provider <approved-provider> --model <approved-model> \
  '<approved minimal prompt>'
```

Repeat with a fresh auth copy for Go so refresh/order does not couple subjects. Never archive auth, environment values, raw HTTP headers, bearer tokens, signed URLs, or complete provider error bodies. Merely finding an auth entry does not establish that it is valid or authorize a call.

## Process and filesystem isolation requirements

### Never signal unrelated processes

1. Every spawned command must start in a new process group/session and be registered with PID, PGID, parent PID, executable, and Linux `/proc/<pid>/stat` start time (or pidfd). A numeric PID alone is unsafe because it can be reused.
2. Signal a group only after proving its leader is a recorded child, its start identity still matches, and every target belongs to the scenario. Never use `pkill`, `killall`, name matching, `kill 0`, an unverified negative PGID, or a shared tmux server.
3. Prefer pidfds in the Go harness. Cleanup walks the recorded ownership tree. If ownership cannot be proved, mark the run FAIL and leave the process for explicit operator handling rather than broad-killing.
4. Start an unrelated sentinel in a distinct session with TERM/HUP/INT traps writing to a sentinel-only file. Exercise execute cancellation, `jobs.stop`, `/ps`, app shutdown, and timeout. Acceptance requires the sentinel alive, unchanged start identity, and an empty signal log. Stop it only through its separately recorded pidfd after evidence capture.
5. Use unique tmux socket and session names. Cleanup may kill only that socket's server. Assert no scenario-owned descendants remain; do not assert that the host has no other `die`, Bun, shell, or tmux processes.

### Never mutate real sessions, auth, or projects

- Refuse to run if any resolved config/session/temp/work path is outside the scenario root. Resolve symlinks and inspect parent ownership before launch.
- Set both `HOME` and Die-specific directories. Isolate XDG directories and cwd. Do not rely on `HOME` alone.
- Offline runs use no copied credentials, unset proxy/provider variables, and a network namespace or deny-by-default loopback fake server where available. `--offline` is necessary but not the only network guard.
- Session compatibility fixtures are copies. Make source fixtures read-only and hash before/after. Migration output goes to another directory.
- Live runs copy the minimum auth file with mode 0600 into a fresh config root. OAuth refresh is expected only in the copy. A cleanup trap deletes it; crash-recovery cleanup finds only parity roots by an unpredictable recorded path, not by wildcard deletion.
- Evidence collection excludes auth/config secret files and workspace secrets by default. Tests use synthetic canary strings and fail if they occur in any archive.
- Use a fake Herdr Unix socket inside the scenario root. Remove inherited Herdr variables in all other scenarios.

## Differential oracles and evidence

Each run archive should contain:

- `manifest.json`: scenario ID/version, side, binary SHA-256, source revision, OS/arch/kernel, terminal settings, locale, dependency/tool availability, start/end monotonic and wall times, and statuses;
- redacted argv/environment **names and set/unset state only**, never values;
- raw stdout/stderr and PTY ANSI, plus stripped fixed-width frames;
- structured provider/tool/job events and fake-server request projections after schema-based redaction;
- isolated file tree with type/mode/size/hash and selected JSONL copies; never credentials;
- PID/PPID/PGID/start-time/executable timeline and signals sent; and
- `diff.json` naming normalization rules, field-level mismatches, PASS/COMPAT-PASS/BLOCKED/FAIL, and reviewer.

Use schema-aware comparison:

- CLI: exact status/channel and text except version/path placeholders explicitly named by the scenario.
- JSON/event streams: parse and compare event types, order and stable fields; map generated IDs consistently by first occurrence.
- sessions: compare parent/branch graph and typed custom-entry projections; normalize timestamps and generated IDs only. Preserve message/context ordering, costs and status.
- PTY: retain raw bytes, but compare semantic frames at event checkpoints after removing known terminal title and color variation. Also assert no forbidden control sequence.
- timings: compare ordering and documented thresholds with tolerance, not exact milliseconds.
- live providers: compare structural invariants, never prose.

A baseline snapshot is evidence of current behavior, not automatically the desired oracle. Security failures (credential disclosure, path escape, unrelated signal, unsafe terminal control) fail both implementations and block release rather than requiring Go to reproduce them.

## Source anchors for the contract

The matrix was derived primarily from:

- bootstrap/CLI/assets: `src/cli.ts`, `tests/cli.test.ts`, `scripts/smoke.sh`, `scripts/prepare-assets.ts`;
- Bun execution and media: `src/typescript/runner.ts`, `src/typescript/execution.ts`, `src/typescript/output-capture.ts`, `src/typescript/images.ts`, and the `typescript-*`/execute tests;
- IPC and process ownership: `src/typescript/job-bridge.ts`, `src/tasks/task-manager.ts`, `src/tasks/job-service.ts`, `src/tasks/task-lifecycle.ts`, plus job/race/handoff tests;
- delegation and persistence: `src/tasks/agent-session.ts`, `src/tasks/subagent-profiles.ts`, `src/tasks/resume-safeguards.ts`, `src/tasks/session-costs.ts`;
- provider/context: `src/tasks/provider-attempts.ts`, `src/tasks/native-fast-mode.ts`, `src/tasks/native-compaction.ts`, `src/tasks/cache-affine-compaction.ts`, `src/tasks/manual-shake.ts`, and provider SDK/live fixtures;
- state/retrieval: `src/goals/`, `src/history/service.ts`, `src/memory/`, `src/diagnostics.ts`, with their docs and tests; and
- real terminal behavior: `src/ui/`, `scripts/tui-harness.ts`, `tests/*-tui.test.ts`, `docs/background-ux-audit.md`, and `docs/task-monitor.md`.

These anchors are not exhaustive and do not reduce acceptance to current unit assertions. `PRODUCT.md` is historical; planned-only features identified in `current-app.md` are not parity requirements.

## Existing tests to retain, then go beyond

The current suite remains the first regression layer:

```bash
# Build in a disposable worktree because this command modifies dist/runtime assets.
bun run check
bun run test
# Live suites only with their documented opt-ins and separate authorization.
```

Map equivalent Go tests to current contract groups: compiled CLI/assets/release; TypeScript runner/output/images; IPC/job races; background and TUI; child persistence/cost; prompts/provider hooks/compaction/fast; goals/history/memory/diagnostics. Then run the cross-binary matrix above. Unit parity alone misses terminal behavior, compiled packaging, inherited environment, session migration, provider wire shape, process-group collateral damage, and interactions between wait boundaries and UI turns.

## Known environment availability (observed, values not printed)

Observed on 2026-09-13 during this research:

- host is `linux/x64`;
- `bun`, `go`, `tmux`, `script`, `timeout`, `jq`, `python3`, and `git` are available;
- `dist/die` exists (about 91 MB at inspection time);
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_PROFILE`, `AZURE_OPENAI_API_KEY`, `CODEX_TOKEN`, `OPENAI_BASE_URL`, and `ANTHROPIC_BASE_URL` were unset in this agent environment;
- both `~/.die/agent/auth.json` and `~/.pi/agent/auth.json` exist and parse with entries named `opencode` and `openai-codex`; only provider names/field names were inspected, not values. Validity and spending authorization were not tested.

Availability can change. The runner must recompute and store only booleans/provider identifiers, never secret values.

## Experiments actually executed

The following read-only inspections were performed; they are **not** a parity pass:

1. Repository source, tests, docs, harness, `package.json`, `godie/CONSTRAINTS.md`, and `godie/research/current-app.md` were inspected.
2. The existing `dist/die --version` and `--help` were run with an empty temporary `HOME` and `PATH=/nonexistent`. Version reported `0.2.8`; help was branded `die - AI coding assistant`. The temporary home gained `.die/agent` and versioned runtime assets, including a newly created auth store, and was deleted afterward. Real `~/.die` was not used by those launches.
3. Tool/platform availability and provider environment-variable **set/unset state** were checked. Auth file existence and JSON provider/field names were checked without printing values.
4. No Go candidate existed to compare here. No build, test suite, PTY interaction, process signaling experiment, fake-provider request, session migration, credential refresh, or live/paid LLM call was executed.

## Exit criteria report

The final migration report should list every matrix row with both subject revisions, outcome, evidence archive hash, and any approved difference. It must separately state:

- deterministic tests passed;
- differential offline scenarios passed;
- real PTY scenarios passed;
- process sentinel/isolation passed;
- current-session compatibility/migration passed;
- live providers actually exercised, model IDs, request counts and approved budget (no credentials); and
- blocked or untested claims.

Do not summarize “tests pass” as behavior parity while any P0 row is blocked or unexecuted.
