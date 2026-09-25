# Live owns the main session

Implemented 2026-09-25. This replaces the production companion path. It is not
a prototype flag. See [investigation](main-orchestrator-investigation.md),
[prompt review](prompt-line-review.md), and its linked wire/input audits.
No install, release, push, credential change, paid request, or microphone use
was done in this worktree.

## One owner, same runtime

Main Live acquires the current Pi session before audio or provider startup.
The ordinary root instructions, project/custom context, root mode,
before_agent_start/context hooks, registered execute declaration, tool-call
permission hooks, tool-result hooks, execute child/IPC, and JobService are
reused. There is no second text main agent, copied companion prompt, JS
evaluator, or job scheduler on the production path.

Pi 0.87.1 has no public direct external-turn/tool owner API. A streamFunction
replacement alone still leaves text auth preflight and the text turn lifecycle.
Use the existing pinned instruction-continuity adapter to bind ClassicSession
and guard _runAgentPrompt. Main-owner uses the same prompt preparation methods,
registered tool, validation, beforeToolCall/afterToolCall, and transformContext.
Missing seams fail closed. The admission reservation covers asynchronous
startup hooks and the final handoff to the ordinary text run.

User, assistant, and tool call/result records go to the same branch and the
agent's in-memory state. Unknown/interrupted transcripts are explicitly
provisional custom messages, not invented final speech. OpenAI completed ASR
replaces deltas; assistant transcript finality does not prove playback. The UI
transcript view no longer owns an opaque companion history. Billing remains
in the existing voice-cost entries. Ordinary appends (including billing) do
not look like a branch switch. Actual switches fence old calls.

Typed text goes to Live, not a second model. Typed images are explicitly
rejected with retry guidance. Completion and attention notifications retain
their branch metadata and go to the voice transport. Gemini sends a completed
client turn; Realtime sends a conversation item and one response request when
the current response/tools settle. Initial history does not request a response.

Interruption flushes speech, not admitted execute work or jobs. live.stop
closes the voice side without awaiting its own execute call. Ordinary text
waits for admitted calls to drain and their results to be recorded. Explicit
jobs.stopWork uses the existing delivery-ACK cancellation path. A draining
owner remains reachable after live.stop, so calling both in one execute still
cancels the correct foreground. The host retains the actual stop-work report
in the tool result even if foreground cancellation wins the stdout flush race. Session
navigation/shutdown waits for foreground cancellation and result persistence
before Pi moves the branch, without changing detached job ownership.
No automatic reconnect or tool replay; duplicate call IDs reuse one result,
and reuse with different arguments is rejected.

## Providers and limits

Production selection supports Gemini Live and OpenAI Realtime direct execute.
GPT-Live is removed from the selection list; old settings and explicit
selection receive actionable errors. No fallback or client-delegation bridge
is started. Legacy standalone diagnostic adapters/tests are not the production
main path; its constructor requires a direct owner and ordinary instructions.

The old 16 KiB output rejection and 4 KiB context observation drop are gone
from main Live. Results over 64 KiB or containing images get a bounded preview
and a complete private artifact under the owning session. Image JSON is
explicitly not visually rendered. Large effective context uses one atomically
replaced context.json snapshot, not an ever-growing pile of full snapshots.
Its preview is marked incomplete and originals remain in branch history.
Context snapshots and retained tool output have a 32 MiB budget; a main wire
context/function argument has a 1 MiB bound, calls are capped at 256, and
concurrent admitted calls at 16. Limits stop/reject explicitly rather than
pretend omitted data was delivered.

## Deliberate unsupported cases and acceptance gaps

- Per-user prompt/context hooks run with finalized text before execute
  admission. Detected unfinished speech gates tool admission until final ASR.
  If per-turn instructions or the direct tool loadout change, Live stops
  before admitting new tools and tells the user to continue in text. Hot
  replacement of provider instructions/tool policy while audio is active is
  **not supported**. This is not full parity for prompt-dependent extensions.
- Images are retained and retrievable, not sent as provider vision inputs.
- No connected Gemini/Realtime function/schema/audio/permission-UI trial was
  possible. Canonical credentials were absent in the investigation; no
  alternate secret was sought. Real provider event ordering, acoustic
  interruption, device teardown, latency, and long-session behavior remain
  unverified. Fake adapters do not prove those.
- No automatic Live compaction/reconnect: use ordinary text when a budget or
  changing instruction policy requires it. Reopening sends history as data,
  never as executable replay.

## Evidence

Existing node_modules were reused by an untracked local symlink. No install.
Bun: /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun.
Private dist/die-web assets were copied (not symlinked) from the main checkout.
scripts/build.ts --reuse-web builds this worktree's matching dist/die without
overwriting main files. Typecheck uses bun run check.

Baseline: 1075 passed, 17 skipped, 0 failed, 1092 tests / 145 files. The first
run without SHELL=/bin/sh had 10 shell-output failures from fish startup's
untrusted mise.toml warning. No trust setting was changed.

Focused production-path tests include first-turn normal/custom/project/root
prompt parity, real execute and an isolated async shell completion on Gemini's
fake provider wire with zero text streams, same-branch history, tool denial and
result/context hooks, positive typed routing, stale/exclusive ownership,
acquisition cancellation, duplicate-call fencing, interruption, real live.stop
and jobs.stopWork helpers, and ordinary text fallback. Adapter tests cover
Realtime/Gemini wire setup, context wakes, large/error/image mapping and GPT
rejection. Retired companion assertions were replaced deliberately.

The last broad run before the final stop-order/policy/navigation refinements
passed 1093 tests, skipped 17, failed 0 (1110 tests, 148 files, 101.39s).
A later run failed a newly added policy test after source/test files changed
mid-run; do not treat that mixed snapshot as final evidence.

Frozen final source: bun run check passed; matching private CLI build passed;
SHELL=/bin/sh bun test ./tests passed: **1096 pass, 17 skip, 0 fail**, 27321
assertions, 1113 tests across 148 files, 102.58s. Focused owner/integration/Live
lifecycle suite: **77 pass, 0 fail**, 405 assertions. The 17 paid/device/LLM
acceptance tests were skipped, not passed. No remaining offline failure.
The temporary dependency symlink can be recreated with
ln -s /home/tnfssc/Code/die/node_modules node_modules; this is reuse, not install.

## Durable work

Integration: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3b87c7af
Branch: die/build-live-as-the-main-orchestrator-3b87c7af.
Children share prefix /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3b87c7af-a86675007a5e-
and remain available:
- task_26c61ec6 / die/shared-pi-main-owner-seam-26c61ec6: stopped and rejected;
  it still delegated to a text main. None of that draft was integrated.
- task_e362cf27 / die/direct-voice-provider-transport-e362cf27: direct adapters.
- task_2f6e7a2d / die/production-live-ui-and-gpt-block-2f6e7a2d: GPT block/UI guards.
- task_f05a5a23 / die/offline-full-path-test-preparation-f05a5a23: planning only;
  not presented as executable proof.
- task_3aea9498 / die/direct-pi-owner-implementation-no-bridge-3aea9498: direct owner.
- task_79e08dae / die/main-live-production-vertical-tests-79e08dae: real runtime tests.
- task_7a1c56b4 / die/update-extension-tests-for-direct-owner-7a1c56b4: lifecycle tests.
- task_85817ff5 / die/independent-integrated-live-review-85817ff5: read-only review.

Parent integration corrected owner acquisition races, leaf advancement, late
startup cancellation, missing initial history, companion prompt/context
rewrites, provider result wakes, self-cancellation on live.stop, missing
per-turn hooks/run options, and unbounded repeated context artifacts. The
independent review found the per-turn hook/run-option gaps; tests now cover
static parity and fail-closed dynamic instructions.

## Values review

Values unchanged. One owner, whole-path proof, bounded output without quiet
loss, honest evidence, and durable handoff already cover this change.
Feature notes changed; no new global rule was needed.

## Parent release completion

Integrated and released as v0.13.0. Parent applied overlap/unfinished-ASR fixes
and corrected the Mac test fixture; final full root gate passed 1098 tests,
17 opt-in skips, no failures. Hosted Linux/Mac CI, exact-SHA release dry run
and tag publication all passed. See ../releases/release-v0.13.0.md for proof
and limits. No paid provider/device acceptance or local install was claimed.
