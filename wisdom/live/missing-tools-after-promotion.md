# Live says it has no tools

User on installed promoted Live reports Gemini said it had no tools or ability
to do things. Do not dismiss this because declarations exist in source. Need
actual session host binding and SDK setup evidence. Current main workspace:
/Users/sharath/Private/home/Code/die, branch feat/native-live, base38fc292.

Tools remain session_context, agent_send, agent_steer, jobs_list, jobs_inspect,
job_cancel. SDK setup includes them only when host discovery succeeds.
A missing host currently starts voice without tools and shows a warning.

## Work and evidence

Host-boundary worker task_71d80022 owns host-access/task-host fix if proven:
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_71d80022,
branch die/trace-missing-live-host-tools-71d80022. It must use actual Pi SDK
context/event-bus behavior rather than assume our fake EventEmitter proves it.
No devices/provider calls by worker. Parent owns provider probe/status.

Parent ran one real paid Google-only probe under user's earlier permission,
announced beforehand. No microphone, recorded speech, real jobs or coding.
Used existing canonical credential service and VoiceSession/official SDK.
Six actual orchestration declarations sent; synthetic text requested jobs_list.
Only a diagnostic fixture handler returned empty jobs, explicitly marked fake.
Result: state ready, calledTools=[jobs_list], errors=[], no collected reply text.
This proves Google accepts/calls these tools in that setup, NOT that user's
CLI bound its host or that spoken agent_send authorization works.
No credentials printed or copied into files. Temporary probe is at
/var/folders/bf/b99kjy314x36r9t_6ffs0d2m0000gn/T/die-live-tools-probe-UyAfDT;
remove when done. Call job task_e284e647 completed exit0.

Parent added /live status fields: agent connected/unavailable and tools
configured count. These describe local binding/declarations, not provider
ability or successful tool execution. Tests cover missing host=0 and
connected host=6. No behavior change or installation yet. Need worker result,
actual regression test, integration, built binary validation and user trial.

Values unchanged: existing truthful-state and real-path evidence rules cover
this failure. Source declarations alone are not end-to-end tool proof.

## Host review result

Worker a48941b integrated (see git log for cherry-pick hash): no host-discovery
bug reproduced. Regression now uses real Pi0.87.1 createEventBus, not a raw
EventEmitter mock. Its async safe listener invokes the callback synchronously
before the first await, so synchronous host handshake still works. SDK contexts
expose the same underlying session manager; CLI registers tasks before Live.
Session ownership/id/file gates and six-tool bridge dispatch pass. No production
host patch justified. Parent52 tests across4 host/tool/extension files and
TypeScript check passed. Audio-only fallback warning remains; status now makes
missing binding and zero configured tools explicit. This is diagnosis, not a fix.

A second real-provider synthetic capabilities question (no mic/real jobs) was
launched as task_0fd419bf; inspect result. Parent build/self-test task_43929f01
is preparing status-only diagnostic installation. User was asked whether they
fully restarted die after installation: a running process retains old extension
code, and all local builds still print0.9.1. This is a hypothesis, not observed
proof of the user's cause. Next useful evidence: fresh process /live status,
then a spoken read-only jobs request and exact response. No more speculative
host rewrites or system-prompt changes from source declarations alone.

Second Google probe completed: state ready, errors=[], no calls (capabilities
question only). Reply: “I can definitely delegate coding work and check on
job statuses for you. I have tools like agent send and steer to pass on your
requests, and jobs list and inspect to follow project progress.” With supplied
tools and current system instruction, broad denial was not reproduced. No
system-prompt tweak justified. Real user process/session remains unmeasured.

Diagnostic build and helper self-test passed. Installer task_5fa4fc5e reports
installed and installed embedded-helper self-test passed; see final hash below.
Ask user to fully restart die, start /live and paste /live status before stop.
Expected local binding: agent connected · tools configured6. If that holds,
ask “List my current jobs” and capture exact response/tool behavior; then test
coding handoff separately (speech/transcription authorization may be distinct).
Do not claim the tool issue is fixed. No native audio behavior changed.
Probe source files removed after saving these results; no recordings made.

Installed CLI SHA256: 68f8f9747659a84eadcdfe88e1091d4ca324ed8ff6a4c7e24bd6185f8b73285f.

## User authorizes further real probing

User explicitly said to probe/test and not worry about paid costs. Parent
explained scope: actual provider/installed CLI, harmless read-only handoff,
no cancellation of user jobs, no keys or mic audio in logs.

Speech worker task_705ada19 owns synthesized-speech -> Gemini transcription ->
actual createOrchestration gate evidence. Worktree
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_705ada19. It may use up to3
bounded paid sessions, inert host fixture only, no microphone or actual agent
jobs. Investigate finished flags, exact-text gate and tool/turn timing before
changing authority. Parent owns compiled CLI/agent route independently.

Parent installed-CLI probe task_19910656 uses a private disposable directory
/var/folders/bf/b99kjy314x36r9t_6ffs0d2m0000gn/T/die-installed-live-probe-nT90BG.
An explicit diagnostic extension in a fresh --no-session CLI asks the real
compiled tasks extension for its host over the shared bus, then uses real
VoiceSession/SDK and real createOrchestration to ask jobs_list and agent_send.
Only granted request: read the fixture README.md and report its first line;
no edits/background jobs. Handoff authority is seeded from that fixed request
for this typed harness, NOT evidence of speech transcription (worker owns that).
The process environment is cleared to HOME/PATH/TERM/offline, preventing
inherited native bridge scope from attaching to original user jobs. Existing
canonical auth is read in place, never copied. No audio devices are opened.
Only structural events/model ID and a known-reply boolean are recorded; no
real session text, keys or microphone audio. Probe owns its tmux server and
must kill it; delete scripts/events after reviewing. Results pending.

## Concrete installed-CLI result (not a source-only test)

First installed CLI probe: actual shared host connected, TUI mode,
configured gpt-6-astra agent, jobs_list succeeded. Gemini then emitted model
turnComplete before a later agent_send with EXACT authorized text. That send
was rejected by createOrchestration because endUserTurn had erased authority.
No agent job started. This is a proven premature-expiry defect across
NON_BLOCKING tool/model turns. It may explain user trouble but is not yet a
reproduction of their exact spoken interaction.

Control probe task_97420398: same installed CLI, real Google SDK/tools, same
fixed read-only request, but direct agent_send without preliminary jobs_list.
It succeeded: real configured openai-codex/gpt-6-astra agent started, used its
execute tool, read the disposable README, and replied its known first line.
No user files/jobs were touched. Structural events saved temporarily under
probe directory; no transcript/secret/audio logs. This proves actual compiled
host discovery and handoff work, rather than only fixture dispatch.

Fix worker task_37f3ab60 at
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_37f3ab60,
branch die/fix-speech-authority-lifetime-across-too-37f3ab60, produced0d1982e.
It keeps latest completed exact-text authority once for60s across model turns;
new input, interruption and stop revoke it. Finished-marker requirement remains.
Worker58 focused tests/typecheck passed. Parent reviewing/integrating and will
repeat identical real-provider chained request before installation.

## Synthetic speech limits and additional diagnostic

Speech worker a64f3a8 (task_705ada19, branch
 die/probe-real-gemini-spoken-tool-handoff-705ada19) tested3 sessions with valid
synthesized PCM16/mono16k speech,100ms paced packets, source AAD enabled. All
connected and sent6 tools, but none emitted transcriptions/tools/turnComplete
before30s close. Inert host; no real agent calls. Parent verified WAV format,
nonzero peaks25650/25712 and RMS about-16.5/-15.5dBFS. Do not infer a tools
failure from provider silence. Raw2 setup/other messages existed.

Parent then ran ONE diagnostic with explicit activityStart/activityEnd,
automatic VAD disabled and20ms packets. Real input transcription appeared:
“Ask the configured agent to read readme.md and report its first line.” It
had NO finished flag; agent_send instead supplied the paraphrase “Please read
the README.md file and report its first line.” Both attempted calls were
rejected, then model said it was having trouble communicating with the agent.
This demonstrates missing completion/paraphrase rejection in MANUAL activity
mode; it does not prove production automatic VAD sends the same markers.
No authority weakening is justified from assuming those modes are identical.
Final control with AAD enabled/20ms produced no transcript/calls, matching prior
synthetic silence. No native capture/VAD settings changed. Further production
speech behavior still needs observed real user input; generated audio is not a
replacement for it. Temporary synthesized files/metadata remain under
/tmp/die-synthetic-speech-705ada19 until parent cleanup. No mic was captured.


## Completed transcript lifetime fix (2026-09-24)

Source: parent task report to worker task_37f3ab60. Parent reproduced with
installed CLI host + real Google + current VoiceSession/createOrchestration:
completed, authorized read-only text -> jobs_list -> provider turnComplete ->
exact-text agent_send denied. Direct agent_send succeeded through configured
openai-codex agent reading scratch README and replying a marker. This separates
premature authority expiry from host discovery/agent routing. Worker did not
repeat these paid/provider probes. Synthetic speech probes reportedly gave no
responses; absence of a finished transcription marker is NOT established.

Worker worktree: /Users/sharath/.die/worktrees/die-f528e86af6b5-task_37f3ab60.
Fix in live/orchestration, types, extension: one latest completed input grant,
exact existing trimmed matching and single-use consumption, fixed 60s TTL
(performance.now; injectable clock). New nonempty input revokes previous grant;
provider interruption and stop revoke it too. Each Run creates fresh orchestration.
Model turnComplete neither revokes authority nor clears partial input. Only an
actual input finished marker finalizes the accumulated request. Interruption
clears partial input before same-message transcription is processed; admission
still uses Session's existing microtask ordering. No Session code changed.

Tradeoff: an unused completed request may authorize its exact text for up to
60 seconds across NON_BLOCKING tool/model turns, but never after fresh input,
interruption, consumption or teardown. Slow chains beyond 60s must obtain fresh
input. Latest-only storage intentionally removes prior multi-request history.
Host observations/model output cannot mint grants. Request/job cancellation
rules, status agent binding/tool counts, devices, SDK transport and audio unchanged.

Validation: 58 tests passed across live-extension, live-orchestration,
live-tools, live-session; bun run check passed. Added actual VoiceSession + Run
callback regression with fake SDK/host: jobs_list then multiple model completions
then exact handoff once; partial input surviving model completion but not
authorizing; old grant revoked by input/interruption; interrupted+finished
transcript+tool in one packet; fabricated outputs/context denied; stop/restart
cannot reuse grant. Clock test covers fixed TTL and latest-only/single-use grant.
No device/provider calls or CLI installation/release by worker. Parent must
repeat exact real-provider CLI chain before installation; this does not prove
real speech end-to-end. Values unchanged: existing real-path evidence, bounded
state and truthful-limits principles apply.
