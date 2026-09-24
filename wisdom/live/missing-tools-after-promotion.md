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
