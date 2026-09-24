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
