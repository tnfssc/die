# Single binary implementation coordination

## Plan and boundaries

The lead owns integration and review. Workers: task_a7d4dbd8 runtime/build/package and runtime tests (also support bootstrap if needed); task_37afdd20 backend compatibility plus canonical patch; task_a2723203 release/install/docs and corresponding tests; task_4820c775 browser smoke harnesses and eventual candidate validation.

Candidate output is `dist/die-bundled`. Do not overwrite `dist/die` yet. Standard final build may default dist/die. Do not install, commit, tag, push, or release. The protected native-compaction source and test, and the task-monitor-tui test, are out of scope. Never port13773, PID discovery/killing, or user server/settings/session access. Use only owned child processes, random ports, private HOME, `TMPDIR=/var/tmp`, and `HERDR_ENV=0`. Make no paid calls.

The architecture still needed runtime proof: embedded compressed web archive, content-addressed atomic private cache extraction, same executable Bun backend/helpers; no external Node or download. Backend explicit cli/makeCli startup needed if imported. If BUN_BE_BUN self interpreter used, delete flag at bootstrap and set deliberately ONLY on JS helper invocations (not Die/RPC). Main prior actual Bun SQLite/HTTP and node-pty proofs valid; old worker health proofs invalid.

Coordinate the build-script interface through implementation notes. release worker assumes bun run build includes web before compile and build:web only intermediate. The smoke worker must use the candidate EMBEDDED runtime (no sidecar override). Full fake-provider chat + terminal + Mode/model/Stop required before complete.

The release worker needed a target override for GitHub release and proposed: `bun run build -- --target=bun-linux-x64-baseline --outfile=./dist/release/die-linux-x64`. Build/package worker: please support or replace this wisdom file with the canonical CLI before release workflow lands. Release metadata expects backend license output path to be documented here as well.

Release check: current `scripts/build.ts` accepts `--outfile=` but silently ignores `--target=`. The workflow now uses both and therefore needs build.ts to parse/pass `--target=bun-linux-x64-baseline` into `compile.target`; please fail on unknown options rather than silently host-compiling a release.

## Integration timeline

### Lead review, 20:01

 current src/web/launcher.ts globally SETS BUN_BE_BUN=1; do NOT ship this. Backend worker now provides explicit with/without Bun interpreter env helpers in shared/hostProcess.ts, so backend global flag must be DELETED (terminal shells/execute children must not inherit interpreter flag). Current launcher expects backend.runCli but backend bin.ts has no such export yet: coordinate explicit Cli.run implementation/export. Runtime worker please resolve these before build; backend worker please expose runCli(args) if easiest.

The launcher cache must append die/web-runtime below XDG_CACHE_HOME, not use XDG_CACHE_HOME directly (extractor chmod(cache,0700) must never chmod unrelated whole user cache). Extraction root .complete check currently before cache permission/symlink checks; evaluate private directory guarantee. Keep scope simple but avoid trusting precreated shared cache.

Correction at review: embedded.ts appends web-runtime already so no whole XDG chmod. Still consistently namespace XDG_CACHE_HOME/die/web-runtime vs default ~/.cache/die/web-runtime.

### Runtime and build update, 20:05

 addressed review: launcher no longer sets global BUN_BE_BUN; XDG cache is XDG_CACHE_HOME/die/web-runtime; extraction validates/chmods cache and completed target before reuse. scripts/build.ts now accepts/passes --target, accepts --outfile/--reuse-web, and fails unknown options. Baseline-target candidate compilation passed. Embedded archive license is LICENSE-T3CODE at archive root (runtime <cache>/die/web-runtime/<sha>/LICENSE-T3CODE). Payload omits obsolete launcher.mjs/t3 Node sidecar wrappers. Backend contract still required: export runCli(args); stale candidate reaches extraction then fails old node:sea before contract check.

The `runCli` integration needed this detail: src/cli.ts does process.exit(await runWeb(...)); runCli MUST return Promise that resolves when backend finishes, not NodeRuntime.runMain void (otherwise process exits instantly). Can use new Promise<number>(resolve => NodeRuntime.runMain(Command.runWith(cli,{version})(args).pipe(Effect.scoped, Effect.provide(CliRuntimeLayer)), { teardown: (exit) => Runtime.defaultTeardown(exit, resolve) })); inspect exact Command.runWith signature. This preserves NodeRuntime SIGINT/SIGTERM interruption without outer premature exit. Backend worker owns bin.ts export+patch.

### Backend contract, 20:06

 backend compatibility original worker completed patch BUT no runCli interface. Continuation task_0f58209c now explicitly owns bin.ts runCli export + tests + patch recapture. Runtime worker wait for that before fresh full candidate build; current dist/die-bundled STALE not valid for browser yet.

### Bun compatibility blocker, 20:07

 actual minimal Bun1.4.1 compiled proof returns Bun.main="/$bunfs/root/probe" vs process.execPath="/var/tmp/.../probe", so isHostProcessExecutable Bun.main===execPath new helper/test is invalid and unproven. More importantly our backend is extracted JS, NOT die hidden subcommands: ClaudeAdapter current false branch chooses claude-history-worker.mjs BUT environment unconditionally withoutBunSelfExecEnvironment -> compiled die will parse JS path as CLI prompt! Easiest keep HostProcessIsExecutable SEA-only (as original valid main shim), compiled backend runs JS helper paths with withBunSelfExecEnvironment(environment,isBun) and normal Node SEA internal command branch without flag. Do not treat the compiled Die executable as T3 SEA, as its hidden subcommands differ. Continuation backend worker task_0f58209c please own this correction + focused tests along with runCli. Inspect remaining HostProcessIsExecutable usages (service launcher etc) for same assumptions.

### Runtime integration, 20:10

 removed obsolete support/die-web-{launcher.mjs,t3.sh} and corresponding old Node bootstrap tests; build-web no longer copies dead wrappers. Live launcher settings coverage now includes malformed structures; added 8-way concurrent extraction + symlink target rejection. 17 focused tests pass (compiled override tests used existing dist/die; repeat with DIE_WEB_BINARY candidate after rebuild). Main owns runtime/build now original worker done.

Backend continuation at 20:09: READY for runtime worker. `.cache/die-t3code/apps/server/src/bin.ts` now exports `runCli(args: ReadonlyArray<string>): Promise<number>` using explicit `Command.runWith`, scoped/provided `CliRuntimeLayer`, and `NodeRuntime.runMain` with `Runtime.defaultTeardown(exit, resolve)`; Promise remains pending through server lifetime and resolves to teardown exit code. Existing import.meta entrypoint startup remains unchanged. Direct server tsc (no build) passed. Recaptured full canonical `web/t3.patch` from all tracked + untracked apps/packages (426052 bytes); reverse apply check passes against source checkout and HEAD matches pinned `6f00d3881a197dd33c2cb43c6a11a9e759e56089`. Runtime worker may build now.

Lead at 20:10: attempted full build after READY note; git reverse-check failed because backend source edits still in progress against last captured patch. Will wait continuation task completion before building to avoid source races. No deployment output changed by failed build.

### Backend continuation complete, 20:11

 also applied lead's Bun compatibility correction before final patch capture: `HostProcessIsExecutable` is SEA-only (compiled Die is not mistaken for T3), while Claude history JS helpers receive `BUN_BE_BUN=1` only for extracted backend running under Bun; normal/SEA children have the marker removed. Focused hostProcess tests 2/2 and direct server tsc passed. Canonical patch was recaptured *after* these corrections (425876 bytes, 18 untracked files), and reverse-check + pinned HEAD check pass.

### First full build, 20:13

 first full build succeeds but isolated candidate web --help fails Cannot find module @ff-labs/fff-node Require stack <private cache>/dist/bin.mjs. Package+symlink exists in dist deployed modules. Investigating compiled dynamic import resolution vs extracted payload. Browser worker may see same startup failure; do not assume backend absent externally. Candidate remains unchanged while smoke runs.

Lead at 20:15: actual fff module+native loads correctly from extracted cache in stock Bun and candidate self-interpreter (BUN_BE_BUN=1). Failure is compiled IN-PROCESS dynamic imported backend createRequire resolution. Testing self-exec bootstrap instead; if passes, launcher will spawn same executable as Bun interpreter on extracted bootstrap, bootstrap immediately deletes BUN_BE_BUN before backend import/runCli. No external Node; deliberate flag still only interpreter children. Browser current candidate likely fails startup; report and wait replacement hash.

Lead at 20:16: self-interpreter bootstrap proof PASSED actual extracted backend --help with PATH=/nonexistent and private HOME, flag deleted before import. Changed live launcher to self-spawn interpreter on new support/die-web-bootstrap.mjs (copied into archive), immediate BUN flag deletion, explicit awaited runCli. Building dist/die-bundled-next to avoid altering browser worker current failed candidate. Main will request smoke new hash after quick no-Node test.

### AgentDeviceShim audit, 20:16

 fixed POSIX ordering to `BUN_BE_BUN=1 exec ...` (previous `exec BUN_BE_BUN=1 ...` was invalid), switched shim generation to the injectable HostProcessExecutablePath compatibility reference, and added an isolated test that privately compiles a Bun executable then proves both shim hops self-exec as interpreter without daemon-env leakage. Focused AgentDeviceTarget + shared hostProcess tests: 5/5 pass; owned formatting check passes. No full build run. Canonical web/t3.patch recaptured from apps/packages after formatting (425663 bytes, sha256 17eced12aa5adcab0135baa2a4c4e8957ba8c0970b023046758800d14da27e9e); reverse apply check and pinned HEAD 6f00d388 pass. Audit note/no broad change: LocalDeviceHost hub/daemon helpers correctly use withBunSelfExecEnvironment and Claude history helper correctly marks only non-SEA Bun script execution. Remaining concrete optional gap: LocalDeviceHost DeviceHostReady.run uses raw hostEnvironment, while iOS serveSim permissions calls ready.run(ready.nodePath, [serveSimCli,...]); under compiled Bun this JS helper likely lacks BUN_BE_BUN=1. SSH serveSim equivalent may need separate runtime-aware treatment. Those optional iOS/SSH helper paths have no actual compiled proof and were left unchanged pending broader ownership. Claude history compiled-Bun path is logic-covered only, not actual provider/history integration-proven.

### LocalDeviceHost follow-up, 20:19

 corrected LocalDeviceHost.ready.run env when command===process.execPath (ready.nodePath API is JS interpreter, including serveSim). Recaptured full patch through temp index; reverse-applied temporary index equals exact pinned HEAD tree, plus worktree reverse-check. 429152-byte patch (full-index diff). Final candidate full build now running to dist/die-bundled-final, leaving browser candidate-next unchanged. Final archive gains SOURCE.txt upstream pin/patchSHA/Bun/native target. Added README cache behavior and explicit unreleased status/official0.2.12.

### First final candidate, 20:22

 dist/die-bundled-final sha256 ef37db756691b73e6e293ea271e63cc54686476477320808d403aa56c4846ed0, size 151483872. Final backend runtime fully built with helper fixes; final repack only updates SOURCE patchhash after test-only diagnostic annotation. DO NOT MODIFY THIS BINARY during worker task_35b9d7a9 browser/real-terminal final validation. Current web/t3.patch SHA256 216160b648521f3efaf587a5f620d89ade10ff98d0b0f044892c611674ab0997, exact pinned-tree reverse-check passed.

### Terminal proof review, 20:28

 current new terminal smoke types printf literal marker and accepts marker in server frames; PTY input echo alone could satisfy, even if command fails. Strengthen proof with octal-escaped printf bytes (marker must not occur literally in typed command) or parse exact output line distinct from echoed command. Require actual output marker from server, not echoed keyboard text. Main core mirror worker done: FINAL616 pass14skip0fail, 630tests87files3869assertions, candidate final exact frozen hash.

### Terminal debugging, 20:32

 capture failure screenshot + browser console/errors + current terminal DOM and server frames before cleanup (current script screenshot only success hides evidence). Canvas remount/actionability instability may be UI lifecycle, not PTY backend; inspect bounded terminal component source excluding node_modules rather than broad recursive tree. Use output-only marker (octal escapes) as noted above. Must finish with honest pass/fail rather than count keyboard echo. New terminal smoke must pass core format/typecheck before final report.

A simpler terminal test was available: successful die-web-smoke.ts already has persisted conversation and stable page. Add actual terminal assertions after its settled chat/subagent proof (before cleanup), instead of opening terminal on ephemeral never-submitted new-thread draft in standalone harness. This avoids possible draft thread/terminal lifecycle churn and proves normal user workflow; fake provider already exists there.

Lead at 20:37: replaced failed standalone/minified terminal script with optional DIE_WEB_TEST_TERMINAL=1 block in existing successful chat smoke. Runs after persisted completed chat/subagent. Uses output-only marker (octal-escaped command) and terminal type:output frames; writes frames artifact. Test currently running on frozen final no-Node PATH via absolute installed Bun harness (candidate/backend still no Node/Bun PATH). Narrow PTY diagnosis worker task_cf3aeca4 read-only in parallel.

Lead at 20:39: persisted-chat terminal ALSO fails: input becomes detached/absent before Enter, while full fake-provider chat4requests passed. artifacts/single-binary-persisted-terminal.log. Not just never-submitted draft lifecycle. Final hash unchanged. Await narrow read-only Bun PTY diagnosis.

Exact PTY source paths for the diagnosis worker: .cache/die-t3code/apps/server/src/terminal/NodePtyAdapter.ts and Manager.ts (ignored checkout; root rg excludes it). No relevant Pi node_modules PTY code. Final deployed module require base dist/die-web/dist/bin.mjs and node-pty dep dist/die-web/node_modules/node-pty. Main direct delayed-interactive-bash candidate self-interpreter proof now running; logs artifacts/single-binary-interactive-pty.log.

Read-only review task_598a696e finished: no actionable regressions in core archive/runtime, Bun flag helper changes, baseline build/release/licenses/install; git diff --check clean. Browser terminal remains gating pending lead evidence. No install/release yet.

### PTY diagnosis, 20:41

This was a read-only source and candidate check. It made no product patch. It found a **real Bun/node-pty mismatch, not a harness lifecycle bug.** Frozen `dist/die-bundled-final` self-exec (`BUN_BE_BUN=1`) requiring deployed `dist/die-web/node_modules/node-pty`, spawning absolute `/bin/sh` or `/bin/bash` under a private `/var/tmp` HOME/TMPDIR with `HERDR_ENV=0` and PATH=`/nonexistent`, exits immediately exactly `{exitCode:0, signal:1}` with no data. The same failure also occurs with inherited PATH/environment, so missing Node/Bun PATH is not causal. Main's independent delayed candidate proof in `artifacts/single-binary-interactive-pty.log` matches (runtime 1.4.1, signal 1, no marker after 1s). Instrumenting the node-pty private socket showed deterministic ordering: socket starts readable/open, immediately emits `error EAGAIN`, then `close`, then PTY exit signal 1. Deployed node-pty 1.1.0 `lib/unixTerminal.js` explicitly treats initial EAGAIN as ignorable, but Bun's `tty.ReadStream` closes anyway after emitting that EAGAIN; closing the PTY master HUPs the interactive shell. This explains the 6ms backend transition in `die-web-terminal-frames.json`; Manager merely records node-pty's exit in lines ~2035-2061. NodePtyAdapter has no close-on-UI-unmount behavior; Manager kills only explicit close/restart/finalizer. Persisted-chat test also fails, ruling out empty-draft cleanup. The terminal must block release as a known Bun 1.4.1 mismatch. Do not chase the UI lifecycle. A fix needs an agreed runtime/backend change (e.g. Bun tty EAGAIN handling or a Bun-compatible PTY stream/backend), not a harness tweak. Final binary/hash untouched.

### Native Bun terminal path, 20:42

The real `Bun.Terminal` proof passed in candidate self-interpreter no Node/Bun PATH: delayed500ms alive, printf marker output, exit0. Logs artifacts/single-binary-native-bun-pty.log. task_194272fa owns narrow native-Bun PTY adapter and tests/canonical patch. Prior final hash terminal FAILS; not releasable until rebuild/new smoke. No source changes outside adapter work; protectedfiles untouched.

## Final result for main review, 21:03

Current `dist/die-bundled` SHA-256 d8de9e58f01095f208be66c2c61aca35aaa627a3ae9e1230c1cd97cf93785380 (151487968 bytes) passed real browser chat and subagents, a terminal output-only marker, canvas resize, Mode, model, and Stop. Runtime PATH had no Node, Bun, or npm. The current hash passed the full private mirror with 616 pass, 14 skip, and 0 fail; 29 focused packaging tests; 127 backend tests; eight native PTY tests; and five helper tests. Notes are in `wisdom/packaging/single-binary-packaging.md`. Long-lived evidence is in `artifacts/single-binary-final-validation/SUMMARY.md`. Older `-next` and `-final` binaries are replaced and must not ship. No commit, install, tag, push, or release ran. No user server or protected file was touched.
