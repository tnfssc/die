# Installed die web Stop investigation

Date: 2026-09-14

## Scope / fixture

Reproduced against the installed `~/.local/bin/die` and its installed `die-web/t3`, using the official upgraded checkout at `/home/tnfssc/Code/die-research/t3code-upgrade` only as the Playwright module source.
The smoke uses a real headless Chromium, real T3 UI, real Pi provider process, same-origin no-auth startup, onboarding completion, an isolated HOME/agent dir under `/var/tmp/die-web-stop-*`, and a loopback OpenAI-completions fixture.
The spawned web backend receives only an explicit allowlist (PATH, LANG, HOME, TMPDIR, Pi/Die dirs, HERDR_ENV=0, subagent depth/type, and web bridge settings).
No paid/external model call or fake UI state is used.

Reproducer: `scripts/die-web-stop-smoke.ts`

Run:

`TMPDIR=/var/tmp HERDR_ENV=0 node --experimental-strip-types scripts/die-web-stop-smoke.ts`

Final run exited 0; “passed” means the investigation ran to completion, not that every Stop control killed work.

## Findings

### 1. Held streaming model response: Stop works

* Actual control accessible name: **`Stop generation`** (red square composer control; there is no visible text label).
* The fixture sent the first SSE assistant delta and deliberately did not finish the response.
* Clicking `Stop generation` closed the loopback model HTTP connection at 15:56:50.841.
  The response had `writableEnded: false`, so this was a client abort rather than fixture completion (opened 15:56:50.631).
* The composer settled, the partial text eventually appeared, and a later prompt completed as `AFTER_STREAM_STOP_OK`.

Conclusion: the installed bridge does propagate Stop to an active model stream.

### 2. Long execute/shell: turn stops, owned subprocess does not

The model issued a real `execute` call whose code awaited a real `shell` command. The owned command wrote its PID (270390 in the final run), installed TERM/INT traps, and slept.

* Before composer Stop: PID 270390 was alive, sleeping, PPID 270109, process group/session 270390.
* Clicking composer **`Stop generation`** settled the parent turn and UI showed **`You stopped after 477ms`**.
* 1.5 seconds later the exact owned bash PID was still alive with unchanged command line and parent/process-group data. No TERM or INT trap fired.
* UI switched the tool surface to **`Monitoring`** and exposed a visible button whose exact accessible name/text is **`Stop`**.
* Clicking that per-job **`Stop`** also did not terminate the owned bash within the following 2 seconds; it remained alive and no TERM/INT trap fired.
* Despite that, the parent UI accepted and completed `AFTER_TOOL_STOP`.
* The test's isolated backend process-group shutdown laterly removed the owned process; it was checked dead after the run. No unrelated process was cleaned up.

Conclusion: this reproduces the report for actual shell work.
Composer Stop interrupts/settles the current turn only and leaves the shell running as monitored work.
More importantly, the resulting per-job button literally labeled `Stop` also failed to signal/terminate the owned subprocess in this fixture.
This is stronger than merely observing documented detached-job semantics.

### 3. Parent idle with running background subagent

A real `subagent({ type: "fast", waitSeconds: 0 })` was launched through `execute`.
Its loopback model stream was held open while the parent completed with `BACKGROUND_PARENT_IDLE_OK`.

* UI said **`Kicked off 1 subagent`**, then **`1 agent working`**.
* The parent was idle and there were **zero controls named `Stop generation`**. Thus there is no composer Stop to click in this state.
* A later parent prompt completed while the worker stream remained open.
* Any bare `Stop` visible in the accumulated UI was the monitored shell job control from scenario 2, not a composer `Stop generation` control for the idle parent.

Conclusion: current Stop-generation semantics are scoped to a running parent turn, not detached/background agents.
The idle-parent case does not itself reproduce a broken composer button because that button is absent.

## Evidence

* `artifacts/die-web-stop-summary.json` — timestamps, exact controls, UI text, connection and process snapshots
* `artifacts/die-web-stop-requests.json` — 8 real loopback requests, including tool continuation and independent worker request
* `artifacts/die-web-stop-process.json` — before/after `/proc` evidence and empty signal log
* `artifacts/die-web-stop-stream.png`
* `artifacts/die-web-stop-tool-parent-interrupt.png`
* `artifacts/die-web-stop-tool.png`
* `artifacts/die-web-stop-background-idle.png`
* `artifacts/die-web-stop-ui.txt`
* `artifacts/die-web-stop-server.log`

## Narrow fix target suggested by evidence

Do not change model-stream interruption or redefine Stop to cancel all detached subagents.
Focus on the monitored shell/job cancellation path behind the visible per-job `Stop`: it reports/accepts the action but does not propagate termination to the actual owned process group.
Also verify whether turn interruption should explicitly hand an in-flight foreground shell into this same working cancellation path.
