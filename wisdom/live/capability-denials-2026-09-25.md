# Live denied tools it had

## Evidence

Investigated current checkout e6b5399 after a user report on 2026-09-25.
Session 01a0d999-3ff7-7069-a846-1915d009aa05 records Live execute calls
that ran shell commands and launched workers. Git pull completed successfully.
Later speech denied local shell and file access without trying those tools.
For audio cleanup, Live asked a worker to create an FFmpeg command, not to
find and process the recording. The worker answered that narrower request.
Several execute calls also dropped helper return values instead of printing
them. This explains empty tool output, not missing execution rights.

## Current source

src/live/main-owner.ts takes the effective ordinary root instructions and
registered execute tool (around lines 168 and 443). Provider session adapters
use those instructions in preference to src/prompts/live.md. The old prompt
says to check capabilities before refusing, but is not the main-owner prompt.
The root identity starts with software-building work. This may cue an overly
narrow role in the voice model. It is a hypothesis, not a proven model cause.
The recorded system frame includes the shell/subagent helper documentation.
No evidence here supports a real OS permission denial.

Do not restore the old companion architecture to address this. The prompt
review deliberately chose one main owner; see prompt-line-review.md.
A possible next step is shared-root guidance to ground capability claims in
actual tools/results and preserve action intent when delegating. Test real
provider behavior as well as prompt wiring. Offline injected tool-call tests
prove transport/runtime access, not spontaneous model tool choice. Release
notes say connected provider/audio acceptance was not run.

## Scope and handoff

Read-only code investigation; no runtime fixes or tests run. This note is the
only intentional edit. Independent read-only review task task_18de5eda completed
in the inherited workspace. Its session is
/Users/sharath/.die/agent/sessions/--Users-sharath-Private-home-Code-die--/2026-09-25T17-33-42-676Z_01a0d9a1-4f94-7069-a846-191f78bb00e4.jsonl.
Exact running binary/provider setup was not established. Pulling source does
not update an already running process. Values unchanged: existing values on
showing real state and checking boundaries already cover this failure.

Independent review agrees no missing executor is shown. It adds a tool-discovery
hypothesis: execute-description.md leads with JS/TS, while shell/files helpers
live in the longer prompt reference. The actual session frame includes that
reference, so omitted helper docs do not explain this observed session. Next
proof should use the running provider/build and a harmless spoken file/job
request; no permission relaxation or second executor is warranted.

## Authorized provider experiments

User authorized live model probes, then allowed as many experiments as needed.
Worker task_ccca35fc owns probe code and empirical tests in
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_ccca35fc
on branch die/probe-live-capability-instructions-ccca35fc (base e6b5399).
Compare baseline with small shared-root/tool-description variants; repeat
trials and test correction after refusal. No production prompt changes yet.
Use normal credential resolution without printing secrets, synthetic files,
and safe tool responses. No desktop edits or microphone/speaker access.
The expanded scope is recorded in LIVE-PROBE-USER-UPDATE.md in that worktree.
Review results before integrating; model tool choice is not execution proof.

First probe checkpoint: 34/34 text-input trials chose execute, baseline too.
No reproduced denial or justified prompt fix. Prior evidence is in the first
worker worktree under wisdom/live/capability-denials-probe-2026-09-25.md.
Follow-up task_a6fd3f1b owns actual recorded-context replay in
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_a6fd3f1b
on branch die/replay-live-refusal-context-a6fd3f1b. It will compare the
recorded root and pre-refusal/accumulated-refusal contexts with safe mocked
tools, without committing the full private transcript. Still no mic capture
or real file processing. Review both workers before integrating.

Recorded-root follow-up completed: commit 322a87e, 27 trials. The exploratory
accumulated-speech replay had one no-tool desktop-command denial in four
trials; it is not faithful audio/provider-history replay. Simple grounding
did not reliably help. First round commit e90f02a has 34 trials.
Targeted follow-up task_ea586341 owns controlled repeated multilingual and
refusal-carryover comparisons in
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_ea586341
on die/test-targeted-capability-instruction-var-ea586341, base 322a87e.
Review task checks first two research commits before integration. No production
prompt changes or real tool execution by probe yet.

Research review task_79f4f5bb: no report-accuracy blocker. Before integrating
probe-live-recorded.ts, remove its hard-coded private session path. Require
an explicitly chosen input and disclose transcript transmission, or use a
sanitized fixture. This session authorized the investigation; a reusable
script must not silently reuse this private conversation for future runs.
Keep current research branches until this portability/privacy fix is reviewed.

## Live terminal visibility report

User reports Live tool calls/results are absent from terminal transcript even
when actions run. Separate UI investigation/fix delegated on 2026-09-25;
this may obscure capability evidence but does not itself explain model refusal.
UI worker task_d7ebbb4e owns
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_d7ebbb4e
on die/trace-hidden-live-tools-in-terminal-ui-d7ebbb4e, base e6b5399.
Trace saved history versus terminal event/render path; reuse normal rendering
and test without provider/audio. Integration and review still pending.

Targeted trials complete in 6ad14ad: 72 sessions, total 133 across three
studies. Named-file cases used tools with baseline too. Original follow-up
was 2/3 calls with baseline and guidance; no demonstrated denial fix.
Globals/no-die-import reminder avoided that import error in 12 trials, but
code never executed. Stop more text probes for now: diminishing returns.
Research consolidation will remove hard-coded private inputs, add explicit
transcript transmission consent and offline checks before integration.
Research packaging task_7dc3f0fd owns
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_7dc3f0fd
on die/package-safe-live-probe-research-7dc3f0fd, base 6ad14ad.
It will combine e90f02a and portable-input fixes; no paid calls.
UI worker remains independent; both need parent integration/review.

UI candidate 0e229b7: direct Live history appends missed terminal subscriber
events. Adds start/end through Pi _emit, bounded display result, empty code
preview. Worker reports 75 tests and tsc passing. Read-only review
task_803018fd checks actual renderer contract, useful preview, type shapes
and missing progress before integration. Real audio/UI acceptance not run.

Research integrated on develop as 9bb3d16, 4759fa2, 575a576, 96cbac5.
Explicit source/disclosure gate and bounded UTF-8 parsing resolve reusable
script review blocker. Parent reran tests/live-probe-input.test.ts: 2 pass,
11 assertions; git diff --check clean. Worker ran bun run check and formatting.
No more provider calls made in packaging. UI candidate still under review.

UI review blocks 0e229b7 as complete fix: real renderer shows no action
with empty args; lossy result adapter hides job IDs/images and differs from
reload. Normal collapsed results remain expandable. Follow-up must reuse
actual args/results and test rendered views, not only emitted events.
UI correction task_a9b0c7f2 owns
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_a9b0c7f2
on die/complete-useful-live-terminal-rendering-a9b0c7f2, base 0e229b7.
Await corrected commit then review/integrate both UI commits on develop.

UI corrected commit 591e782 integrated with candidate as 62ddd29 and
25aad17. Actual args/canonical results now reach normal Pi renderer; update
callback forwarded if tool emits it (current execute does not stream).
Real ToolExecutionComponent tests cover readable actions and expanded result
identity/artifacts/images/reload. Worker reports 122 relevant tests and checks.
Parent first combined run: 24 pass, 3 integration failures because default
fixture picked preexisting dist/die dated Sep 24, missing live/stopWork helpers.
Rerun uses established DIE_PROBE_EXECUTABLE source-CLI fixture; do not rebuild
all packaging just for these tests. Source rerun pending. No physical TUI/audio
acceptance, install, push or release done. Values unchanged: existing real-path
proof and truthful UI guidance cover both research and corrected rendering.

Final parent checks: source-CLI run passed 27/27, 185 assertions. Initial
typecheck then found stale node_modules missing already-declared @types/ws.
bun install --frozen-lockfile installed that package without tracked dependency
changes; bun run check and git diff --check now pass. Research and UI fixes
are integrated locally. Manual voice/TUI expand/redraw check remains before
release; running installed CLI has not been updated by these source changes.

## Local install

User requested installation. bun run install:local completed successfully on
2026-09-25. Fresh web/CLI build and embedded native helper self-test/protocol
v1 passed without audio devices. Installed ~/.local/bin/die matches dist/die
byte-for-byte; --version remains 0.13.0 (local unreleased fixes, no version bump).
Restart Die to load it. Physical voice/TUI acceptance still outstanding.
