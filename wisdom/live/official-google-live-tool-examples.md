# Official Google Live examples: tools vs transcript completion

Research only, 2026-09-24. Read values.md and missing-tools-after-promotion.md.
No production edits, credentials, devices, dependency installation or provider calls.
Only public GitHub HTTP/git reads; examples were **not executed**.

## Reproducible sources

GitHub repository API returned owner **google-gemini**, archived **false** for all
three repos. Official ownership is verified, not a security endorsement of demos.
No archived-repo replacement was needed. Current cookbook links the current
example collection below; it is a maintained alternative, not a proven formal successor.

Durable clones under `/.die/research/google-live/:

| Clone directory | Pinned HEAD | HEAD date |
| --- | --- | --- |
| live-api-web-console-task-1f458085 | 0a4542fe0e39d07956ea7af5de45d7c81fde8960 | 2025-10-14 |
| cookbook-task-1f458085 | e28775cab9be00a3cd2e585d93cf58bcb9c5830b | 2026-09-23 |
| gemini-live-api-examples-task-1f458085 | 3bcae1162d1bc6955672153310e4f84eba6621ff | 2026-09-15 |

GitHub pushed_at can reflect other refs: web-console API says 2026-06-21, but
main HEAD above is older. Web console uses @google/genai ^0.14.0 and
models/gemini-2.0-flash-exp. Cookbook installs unpinned latest Python google-genai,
v1alpha; current tools notebook selects gemini-3.8-live. Current examples also
select gemini-3.8-live. These are not our exact SDK/model/transport reproduction.

## Web console: actual code, not just README

[Altair.tsx L26–100](https://github.com/google-gemini/live-api-web-console/blob/0a4542fe0e39d07956ea7af5de45d7c81fde8960/src/components/altair/Altair.tsx#L26-L100):
- declares render_altair with required json_graph;
- setup includes `{ functionDeclarations: [declaration] }` (L63);
- toolcall handler finds that name, consumes fc.args.json_graph, updates chart;
- responds after **200ms setTimeout**, with `id: fc.id, name: fc.name` and
  success:true. It acknowledges every call in the batch: not a robust validation
  or security template, nor proof rendering succeeded.

[Client L177–206](https://github.com/google-gemini/live-api-web-console/blob/0a4542fe0e39d07956ea7af5de45d7c81fde8960/src/lib/genai-live-client.ts#L177-L206)
emits `this.emit("toolcall", message.toolCall)` immediately (L185), independently
of model turnComplete. [L275–284](https://github.com/google-gemini/live-api-web-console/blob/0a4542fe0e39d07956ea7af5de45d7c81fde8960/src/lib/genai-live-client.ts#L275-L284)
forwards functionResponses to SDK sendToolResponse. This path neither requests
nor waits for input transcription, finished, or transcript equality. No explicit
manual activity/VAD policy in this Altair setup. The 200ms demo timer is **not**
an acoustic completion boundary or a recommended timeout.

## Cookbook LiveAPI tools notebook

Pinned [notebook](https://github.com/google-gemini/cookbook/blob/e28775cab9be00a3cd2e585d93cf58bcb9c5830b/quickstarts/Get_started_LiveAPI_tools.ipynb)
(JSON source lines below; GitHub may render notebook instead of line anchors):
- L515–516 declares light functions; L670 passes function_declarations in tools.
- L334–336: `tool_call = response.tool_call`; if present,
  `await handle_tool_call(session, tool_call)`.
- L404 onward builds FunctionResponse(id=fc.id, name=fc.name,
  response={"result": "ok"}) and awaits send_tool_response. **Mock ACK only**;
  prose explicitly says it just replies ok, not that lights actually change.
- Async Live helper (L680–840) runs receive, send, tool worker and text reader
  as separate TaskGroup tasks. Receive queues calls; worker awaits supplied
  function and replies preserving name/id. No transcription/equality dependency.
  Inputs are text: this cannot establish microphone automatic-VAD final markers.
- NON_BLOCKING examples L1114–1115 and later demonstrate INTERRUPT, WHEN_IDLE,
  SILENT scheduling, delayed mock functions, prompts 5s apart, and retaining
  connection 20s after input. This shows intended overlap, not a benchmark or
  secure request-lifetime policy. Tool worker processes its queue sequentially;
  do not call it unlimited parallel execution. Saved outputs are historical
  illustrations, not our tests.

## Current examples: transcription AND tools

[Python session L32–49](https://github.com/google-gemini/gemini-live-api-examples/blob/3bcae1162d1bc6955672153310e4f84eba6621ff/gemini-live-genai-python-sdk/gemini_live.py#L32-L49)
sets input/output AudioTranscriptionConfig, TURN_INCLUDES_ONLY_ACTIVITY and
`tools=self.tools`. [Receive L107–168](https://github.com/google-gemini/gemini-live-api-examples/blob/3bcae1162d1bc6955672153310e4f84eba6621ff/gemini-live-genai-python-sdk/gemini_live.py#L107-L168):
transcription text becomes UI events, independently of tool_call. Tool name must
exist in tool_mapping; async function is awaited (sync via executor), response
preserves id/name, then send_tool_response. No finished or equality gate.
Receive iterator is re-entered after turn completion. Awaiting tools *inside*
receive can delay further receives: do not blindly port its concurrency design.
This class accepts supplied tools; its presence alone doesn't prove the main app
configures a real coding-agent tool.

Raw-WebSocket example:
- [Setup L359–405](https://github.com/google-gemini/gemini-live-api-examples/blob/3bcae1162d1bc6955672153310e4f84eba6621ff/gemini-live-ephemeral-tokens-websocket/frontend/geminilive.js#L359-L405)
  sends functionDeclarations, automaticActivityDetection and optional
  inputAudioTranscription independently. Defaults L190–197 enable automatic
  detection (disabled:false, silence 2000ms, prefix 500ms), not manual activity.
- [script.js L291–303](https://github.com/google-gemini/gemini-live-api-examples/blob/3bcae1162d1bc6955672153310e4f84eba6621ff/gemini-live-ephemeral-tokens-websocket/frontend/script.js#L291-L303)
  does inspect finished, but **only for display**:
  `if (!message.data.finished) {` then `addMessage(...)`.
- [L320–369](https://github.com/google-gemini/gemini-live-api-examples/blob/3bcae1162d1bc6955672153310e4f84eba6621ff/gemini-live-ephemeral-tokens-websocket/frontend/script.js#L320-L369)
  dispatches TOOL_CALL independently; Promise.all maps async callFunction,
  returns id/name and result/error, sends responses after all calls settle.
  NON_BLOCKING handling adds scheduling hints. It waits for neither finished,
  model turn completion nor transcript match. Batch replies wait for slowest
  call. Check current SDK wire schema before copying scheduling fields.

## Applicable conclusion and limits

Our extension.ts L280 only creates completed-input authority when t.finished;
orchestration.ts L102 demands pending.text === requested. Inspected official
handlers impose **neither** gate. With connected agent, configured tools6 and
completed input transcripts0, the reported symptom is compatible with our
completion gate, not evidence of missing agent/tool declarations. Manual synthetic
input without finished plus paraphrased agent_send reveals two separate policy
obstacles. This is separate from the already-fixed model-turn lifetime defect.

Simplest applicable transport pattern: declare tools at connect; route actual
server toolCall by allowed name; validate args and existing host permissions;
execute authorized work; return matching id/name result/error; keep receive
and transcript display independent of tool completion. No need to wait for
transcription.finished merely to *receive/route* calls. But coding-agent side
effects still need an **authorization policy**, which these demos do not supply.
Parent must explicitly decide how user requests authorize model arguments before
changing either gate. Do not treat unknown finished as true, accept paraphrases
as authenticated intent, or mistake VAD for identity.

Not proved: whether our actual automatic-VAD stream emits finished, why it did
not, message ordering for our SDK/model, or whether a gate change fixes the
user's speech failure. No production patch proposed. Official demos establish
protocol patterns, not arbitrary-side-effect permission or voice identity.
Values unchanged: this reinforces existing evidence, boundary ownership and
permission rules rather than introducing a new general value.
