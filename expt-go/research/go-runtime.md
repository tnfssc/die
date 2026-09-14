# Go TUI and runtime research for `godie`

Research snapshot: 2026-09-13. This is design advice, not an implementation plan or a claim that the proposed behavior already exists. Web searches were run with `tvly search`; the captured JSON (including page extracts) is in [`sources/tui-*.json`](./sources/).

## Recommendation in one page

Use **Bubble Tea v2 + Lip Gloss v2 + selected Bubbles v2 components**, with a deliberately small application layer:

- one Bubble Tea model owns UI state; goroutines do I/O and report immutable messages;
- a Bubbles viewport owns the in-app conversation scroll position;
- a Bubbles textarea is the editor foundation, but wrap it in a die-specific composer for submit/newline bindings, history, completion, paste, and status behavior;
- render completed Markdown with Glamour, but debounce rendering while a response streams and retain the original Markdown as the source of truth;
- keep background jobs in a UI-independent service with bounded byte logs and monotonic offsets; send job events into Bubble Tea rather than placing process state in the widgets;
- use `os/exec` with pipes by default. On Unix, put every job in its own process group and cancel TERM -> grace period -> KILL -> `Wait`. Add a PTY only as an explicit mode for commands that require a terminal;
- **do not replace the current execute worker with Goja in the compatibility milestone.** Keep a separately spawned Bun worker and a narrow framed RPC bridge to Go. An embedded engine can be revisited only if the execute language contract is intentionally reduced.

This is the simplest stack that preserves the important current semantics. It also keeps four concerns separable: rendering, conversation state, process lifecycle, and the JS compatibility worker.

## Grounding in the current repository

These are verified observations from the checked-out TypeScript source:

- `src/cli.ts` starts Pi's coding-agent TUI and installs die extensions. The present UI is therefore not a small collection of local widgets that can be translated mechanically.
- `src/ui/editor.ts` subclasses Pi's `CustomEditor`; its comment explicitly relies on Pi for editing, IME, paste, and application shortcuts. A Go rewrite must rediscover those behaviors rather than treating a textarea swap as complete.
- `src/tasks/task-manager.ts` already has a useful runtime contract: pipe stdin/stdout/stderr, bounded output with absolute offsets, foreground waits that become background ownership, writable/closable stdin, completion notifications, and TERM/KILL process-group cancellation.
- `src/prompts/execute.md` exposes asynchronous `shell`, `subagent`, `handoff`, `jobs.*`, `history.*`, and `showImage` semantics to model-written code.
- `src/typescript/runner.ts` accepts TypeScript, transpiles it with `Bun.Transpiler`, runs it as an ESM module (including top-level `await`), supports `require` and static/dynamic imports of installed packages, and exposes Bun/Node facilities. `src/typescript/execution.ts` runs that worker as an isolated child with stdout/stderr/image/job channels and kills its process group on cancellation or completion.
- Existing tests cover real-TUI background responsiveness, foreground/background handoff, output capture and truncation, job bridge behavior, stdin, timeout escalation, shutdown, and descendant cleanup. Those are migration specifications, not incidental tests.

## TUI stack

### What the libraries verify

| Library | Verified upstream capability | Fit / limitation |
|---|---|---|
| Bubble Tea v2 | Elm-style `Init`/`Update`/`View`; commands produce messages; a v2 `View` can describe terminal features. It has keyboard, paste, mouse/focus/window events, terminal capability requests, `ExecProcess`, and managed printing above the program. [API](https://pkg.go.dev/charm.land/bubbletea/v2) | Good owner for input serialization and rendering. It is not a job supervisor, Markdown parser, or transcript store. As of the captured docs the current package is v2.0.9. |
| Lip Gloss v2 | Terminal-aware styling/layout, color profiles, borders, padding, joining and width/height measurement. [API](https://pkg.go.dev/charm.land/lipgloss/v2) | Use for presentation only. It does not parse Markdown, virtualize history, or solve Unicode editor semantics. |
| Bubbles v2 | Reusable components include textarea and viewport; textarea exposes focus, cursor, line, dimensions, value and update operations. [textarea API](https://pkg.go.dev/github.com/charmbracelet/bubbles/v2/textarea), [v2 upgrade guide](https://github.com/charmbracelet/bubbles/blob/main/UPGRADE_GUIDE_V2.md) | Strong foundation, not a finished coding-agent composer. The captured textarea API was a v2 beta while Bubble Tea itself is stable, so pin and test an exact compatible Bubbles release rather than assuming all v2 modules move together. |
| Glamour | Stylesheet-based terminal Markdown rendering with configurable word wrap. [repository](https://github.com/charmbracelet/glamour), [API](https://pkg.go.dev/github.com/charmbracelet/glamour) | Appropriate for completed messages. Its public API renders Markdown documents; it does not claim to be an incremental streaming parser. |

Bubble Tea v2 is materially preferable to starting a custom ANSI renderer: input decoding, terminal restoration, sizing, cursor declaration, and event serialization are hard to reproduce correctly. Lip Gloss and Bubbles should remain replaceable leaves beneath die-owned interfaces; do not let widget models become persisted domain state.

### Conversation, streaming Markdown, and scrollback

**Verified:** Bubble Tea's `Println`/`Printf` write persistent unmanaged lines above an inline program, but print nothing while alternate-screen mode is active ([API](https://pkg.go.dev/charm.land/bubbletea/v2#Println)). A viewport provides application-controlled scrolling. The two mechanisms are not the same scrollback model. Bubble Tea has had active discussion/issues around managed scrollback and scrollback restoration ([discussion #1482](https://github.com/charmbracelet/bubbletea/discussions/1482), [issue #1571](https://github.com/charmbracelet/bubbletea/issues/1571)).

**Proposal:** use alternate screen plus an in-app viewport for the first viable build. This gives deterministic composer placement, resizing, selection state, and long-message navigation. On clean exit, optionally print a plain final transcript to the normal screen if preserving terminal scrollback is a product requirement. Do not mix `tea.Println` transcript rows with an alternate-screen conversation.

Keep transcript blocks structurally (role, original Markdown, lifecycle, optional rendered cache), not as one giant ANSI string. Render only visible blocks when performance requires it. During token streaming:

1. append source bytes/runes to the active message;
2. coalesce UI updates (for example every 25-50 ms rather than per token);
3. render plain/wrapped text or rerun Glamour on that one block;
4. perform a final Glamour render when the block completes;
5. auto-follow only if the user was already at the bottom—never steal their scroll position.

Incremental Markdown is a **proposal**, not a verified Glamour feature. Re-rendering a partial document can restyle unmatched fences/lists as more bytes arrive; tests must accept that transient layout or the streaming view should intentionally be simpler than the final view.

### Editor

Start with Bubbles textarea, then add a thin die composer. Required behaviors to specify and test before claiming parity:

- Enter submits while a distinct binding inserts newline;
- bracketed/multiline paste never accidentally submits;
- Unicode grapheme movement/deletion and wide/zero-width characters;
- IME composition on supported terminals;
- resize and soft-wrap without cursor drift;
- prompt history and draft restoration;
- completion/menu focus and mouse coordinate translation;
- editor height limits and indicators for text hidden above/below;
- interrupt priority: cancel generation/job versus clear editor versus quit.

Bubble Tea v2 exposes richer key events and paste messages, but upstream APIs alone do not verify all of these product semantics.

### Background jobs

Retain the current service shape rather than coupling jobs to `tea.Cmd` lifetimes:

- one supervisor owns each process and its state machine;
- stdout/stderr readers append to bounded logs carrying `baseOffset` and `endOffset`;
- every transition/event is sent to the Bubble Tea program with `Program.Send` or returned by a waiting command;
- the model keeps summaries and cursors, not `*exec.Cmd`, pipes, or goroutines;
- completion notification ownership must remain exactly-once across the foreground-wait/background race;
- shutdown stops admissions, terminates jobs, drains/reaps children, persists lifecycle state, then exits the TUI.

This is a proposal grounded in `src/tasks/task-manager.ts`; Bubble Tea does not supply this lifecycle.

## Subprocesses, PTYs, and cancellation

### Pipes first

Go's `os/exec` deliberately does not invoke a shell unless asked, and `CommandContext` by default cancels by calling `Process.Kill`; it also allows a custom `Cancel` and `WaitDelay` ([official package docs](https://pkg.go.dev/os/exec)). For the existing `shell(command)` contract, explicitly run the platform shell (on Unix, typically `/bin/sh -c`) while all internal helpers use argv directly.

Use three pipes by default because they preserve separate stdout/stderr, deterministic non-interactive behavior, explicit stdin-open state, and clean byte accounting. Continuously drain both output pipes before/during `Wait` to avoid deadlock.

### PTY only when requested

`github.com/creack/pty` provides `Start`/`StartWithSize`, resize helpers, and terminal-size inheritance ([API](https://pkg.go.dev/github.com/creack/pty), [repository](https://github.com/creack/pty)). A PTY is valuable for an interactive REPL, password prompt, full-screen child, or command that changes output when `isatty` is true.

It should not be the default: a PTY merges terminal-oriented streams, introduces echo/line-discipline and ANSI-state concerns, changes buffering/color behavior, needs resize propagation, and makes “close stdin” unlike closing a pipe. Define an explicit `pty` job mode later, with one byte stream and terminal dimensions in its contract. Do not let an arbitrary child and Bubble Tea concurrently own the real controlling terminal; either proxy through a contained PTY pane or use Bubble Tea's suspend/exec mechanism for a foreground takeover.

### Process tree cancellation

**Unix proposal:** immediately after fork and before exec, create a distinct process group (`SysProcAttr.Setpgid = true` in Unix-specific code). Record PID/PGID. Cancellation should be idempotent:

1. atomically record the first cause (user, timeout, execute abort, shutdown);
2. signal `-pgid` with SIGTERM;
3. after a bounded grace period, signal `-pgid` with SIGKILL;
4. continue draining pipes and always call `Wait`;
5. report exit code/signal and the original cause separately.

A negative PID to `kill(2)` targets a process group ([Linux man page](https://man7.org/linux/man-pages/man2/kill.2.html)); Go exposes process attributes and signals through OS-specific `syscall`/`x/sys/unix` APIs ([`SysProcAttr` docs](https://pkg.go.dev/syscall#SysProcAttr). `CommandContext` alone is insufficient because its default kill targets only the direct process. Descendants that deliberately create a new session/process group can escape this scheme; Linux subreaper/cgroup containment is a separate stronger feature, not required for the first build.

**Windows proposal:** use a Job Object with kill-on-close rather than pretending Unix negative-PID behavior is portable. Hide this behind a `ProcessTree` interface and use build-tagged implementations. If Windows is not initially supported, fail/document that explicitly.

PTY startup often changes session/process-group attributes itself, so test and implement PTY cancellation separately rather than stacking `Setpgid` assumptions blindly.

## JavaScript/TypeScript execute runtime

### Goja: useful engine, wrong compatibility layer

The authoritative Goja docs say it is a pure-Go ECMAScript 5.1 implementation with many later features, that a runtime is not goroutine-safe, and that the host must provide concurrency/event-loop functions; a separate `goja_nodejs` project supplies some Node functionality. Goja supports interruption from another goroutine. [Goja API/README](https://pkg.go.dev/github.com/dop251/goja)

That makes Goja attractive for a small, controlled scripting language: Go values/functions can be exposed directly, runtime interruption is available, and there is no CGo deployment cost. It does **not** provide the current execute contract out of the box:

- no TypeScript parser/transpiler;
- no Bun globals or full Node standard library;
- no compatible npm CommonJS/ESM resolver/loader;
- no built-in event loop for top-level `await`, promises backed by asynchronous Go jobs, timers, and cancellation;
- no process isolation or memory limit merely because it is embedded.

Implementing those pieces would be a new runtime platform, not glue code. Running model-generated code in-process also increases the blast radius of engine/host bugs and makes hard memory termination difficult.

### Alternatives

- **Sobek** is Grafana's maintained Goja fork used by k6 and remains a pure-Go embeddable ECMAScript engine ([repository](https://github.com/grafana/sobek)). It can be preferable to Goja if its conformance/maintenance trajectory wins a spike, but it still requires host modules, an event loop, TS transformation, and API shims.
- **QuickJS bindings** embed a broad ES engine but normally introduce C/CGo or vendored native-code lifecycle, cross-compilation, allocator, and interruption complexity. They still do not provide Bun/Node APIs or TypeScript by themselves. Evaluate only if modern language conformance is more important than pure-Go builds. ([official QuickJS project](https://bellard.org/quickjs/))
- **V8 bindings** are the heaviest option (native library/artifact size and cross-platform packaging) and likewise do not recreate Node/Bun. They are unjustified for this CLI. ([official embedding guide](https://v8.dev/docs/embed))
- **A spawned Bun worker** already has the language, TS transform, imports, Node/Bun APIs, and process isolation needed by this repository. Its cost is distribution: either require a compatible Bun executable or ship/manage a platform-specific sidecar.

### Recommended compatibility boundary

For the first Go runtime, spawn a Bun execute worker and communicate over a versioned framed protocol (JSON plus separate binary/image framing, or equivalent). Go owns shell/subagent/job/history lifecycle; the worker owns parsing/module loading and turns global helper calls into RPC requests. Preserve:

- top-level await and TS syntax;
- `Bun.file`, `Bun.write`, Node built-ins, `require`, static and dynamic imports;
- output limits/artifact spill behavior and image limits;
- background launch return/acknowledgement races;
- execute cancellation killing the worker tree without killing already-detached managed jobs;
- structured diagnostics and distinct timeout/caller/shutdown causes.

This is a proposal. If a single self-contained Go binary is a non-negotiable goal, explicitly choose a smaller execute v2 contract; then Sobek/Goja plus a TS transform and a tiny host event loop can be compared fairly. Do not silently label that reduced language “compatible.”

## Meaningful risks and tests

1. **v2 dependency churn / mismatched Charm modules.** Pin exact versions, run an API compile check, and snapshot key rendering at widths 1, 2, narrow, normal, and very wide.
2. **Unicode/editor regressions.** Table-test grapheme clusters, CJK width, emoji ZWJ, combining marks, multiline bracketed paste, IME, mouse placement, and resize. Run real PTY tests, not only model unit tests.
3. **Streaming render cost/flicker.** Benchmark a long response with small chunks and large fenced code blocks; assert bounded update frequency, stable user scroll position, and acceptable resize latency.
4. **Unbounded transcript/job memory.** Soak with multi-gigabyte/no-newline output; verify bounded resident memory, monotonic offsets, truncation markers, UTF-8-safe page boundaries, and artifact cleanup.
5. **Foreground/background race.** Deterministically race completion, wait timeout, execute-worker disconnect, response acknowledgement, and shutdown; assert one completion notification and no lost result.
6. **Process leaks.** On Unix test shell -> child -> grandchild where TERM is handled/ignored, leader exits first, pipes remain inherited, timeout races caller cancel, and repeated stop is idempotent. Verify PIDs disappear and `Wait` completes. Add separate PTY cases and platform-specific Windows Job Object tests.
7. **Terminal restoration.** Crash/panic/SIGINT/SIGTERM tests must restore cooked mode, cursor, mouse/paste modes, and alternate screen. Test under tmux and at least two terminal families.
8. **Bun protocol drift.** Golden compatibility tests should run the same execute snippets against current die and godie: TS, top-level await, imports, npm package resolution, stdout/stderr, images, jobs input/stop/list/inspect, handoff, errors, timeout, and cancellation.
9. **Security assumptions.** Execute and shell are arbitrary-code facilities, not sandboxes. Document trust boundaries; validate RPC framing/size limits and never treat an embedded JS VM as a security boundary.

## Sources captured

The primary captured searches are:

- [Bubble Tea v2](./sources/tui-bubbletea-v2.json)
- [Bubbles v2](./sources/tui-bubbles-v2.json)
- [Lip Gloss v2](./sources/tui-lipgloss-v2.json)
- [Glamour](./sources/tui-glamour.json)
- [scrollback / alternate screen](./sources/tui-xterm-scrollback.json)
- [Go PTY](./sources/tui-go-pty.json)
- [Go process groups / os/exec](./sources/tui-go-process-groups.json)
- [Goja](./sources/tui-goja.json)

Authoritative upstream/package documentation is preferred in the citations above. GitHub issues/discussions are used only to establish caveats or active design questions, not stable guarantees.
