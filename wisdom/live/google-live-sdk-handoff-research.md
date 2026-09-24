# Official Google Live SDK/protocol handoff research (2026-09-24)

Research only: no code changes, credentials, microphone, or paid calls. Read
values, missing-tools-after-promotion, and live session/extension/orchestration/types.

## Critical finding

The source model is **gemini-3.8-live**. Official ADK has a specific Gemini 3.x
Live adapter rule: **input_transcription is a single final transcription**. It
emits finished=True itself without requiring a wire finished field. Its model
predicate includes gemini-3.8-live. This is stronger evidence than guessing that
an omitted optional boolean means true. Do not generalize this to every model,
interim transcription, or output transcription.

An official-source-grounded correction candidate is therefore model-specific
semantic normalization, plus removal of model-written handoff text. Forward the
captured input segment itself. Preserve raw finished as unknown and record the
normalization provenance. A final ASR segment still is not proof that a whole
multi-sentence human request is over. Tool/input association remains app policy.

## Pinned sources

Durable directory: ~/.die/research/google-live/sdk-handoff-970a55b7/.

- Official npm @google/genai 2.24.0: https://registry.npmjs.org/@google/genai/-/genai-2.24.0.tgz
  SHA256 5c3fa4f63e1bacd95fcdc227c01cfa7874e6c263961b6282671f95ccd6b5c290.
  Installed package /Users/sharath/Private/home/Code/die/node_modules/@google/genai
  matches tarball dist/genai.d.ts and dist/node/index.mjs byte hashes:
  101746b9ab38ae7952135532f7a4b06cc2488ebef18fd9b473c30f06aff466e0 and
  cece533296f4363ef8eb6e951dc7df45683fd896546711ce9cbd0c4c33efd928.
- https://ai.google.dev/api/live saved as live-protocol.html; SHA256
  adec62404d14c81ce143376be90d8251286e4dedfb6a13811817f9344078cdba.
- https://ai.google.dev/gemini-api/docs/live-guide saved as live-guide.html; SHA256
  06c3c8cb1ed1423c4f413ec959ccd512aab50cd3b17c30b479cc6b53e6b073f5.
- https://ai.google.dev/gemini-api/docs/live-tools (canonical path now
  /gemini-api/docs/live-api/tools), live-tools.html; SHA256
  55b1994d22602c56053ac367cb998a725d24966a6e9997ea08d3023c0810b7c6.
- https://github.com/google/adk-python cloned at
  **9b9aac038fcc8a2358331bc93d58dca4b85d31d2**. All ADK paths below use this pin.
  HTML and extracted text are retained. Hashing a snapshot does not turn mutable
  web docs into an immutable service contract.

## Facts versus guarantees

1. SDK dist/genai.d.ts:16201 Transcription has optional text and finished:
   “Optional. The bool indicates the end of the transcription.” No guarantee of
   presence. LiveServerContent:11232 says input transcription is independent of
   model turns, with no implied ordering. Public protocol ServerContent says input
   transcription is independently sent with **no guaranteed ordering**. Its current
   Transcription table lists text/languageCode, not finished. Type presence alone
   is not universal server delivery.
2. SDK dist/node/index.mjs:14549 handleWebSocketMessage directly Object.assigns
   parsed JSON for Developer API. Only Vertex takes liveServerMessageFromVertex;
   that converter (~8912) copies inputTranscription unchanged and maps voice
   activity. No Developer API converter strips finished or defaults it to true.
   Local session.ts also preserves absence.
3. LiveServerMessage:11277 exposes voiceActivityDetectionSignal, explicitly
   **Allowlisted only**, and voiceActivity. VoiceActivity:18797 has optional
   voiceActivityType/audioOffset; ACTIVITY_START/END enum comments say start/end
   of sentence. These types establish representability, not delivery on every
   Developer API model or ordering with transcription/tool calls. Downloaded public
   protocol does not document these fields. ADK forwards message.voice_activity
   (connection.py:666). Do not invent an always-present server input boundary,
   subscription flag, or transcript completion guarantee from these types.
4. Guide Automatic VAD: default enabled on continuous audio. Interrupted refers to
   model-output interruption, not universal input end. activityStart/activityEnd
   are **client** realtime input fields, only when automatic detection is disabled.
   audioStreamEnd flushes cached audio when input pauses >1s. Current guide also
   documents hybrid VAD: client speech-end detection sends audioStreamEnd with
   server VAD enabled. Neither section promises atomic transcript correlation to
   the client boundary. It improves latency; it is not authorization metadata.
5. Official tools guide handles message.toolCall.functionCalls, executes app
   functions and sends matching id/name responses with sendToolResponse. Live
   does not automatically execute client tools. NON_BLOCKING allows conversation
   while tools run; it does not prove input finality. No example requires exact
   equality between model tool arguments and ASR text.
6. [ADK connection.py](https://github.com/google/adk-python/blob/9b9aac038fcc8a2358331bc93d58dca4b85d31d2/src/google/adk/models/gemini_llm_connection.py#L432)
   notes tool_call may precede generation_complete and transcription. Lines
   435–447 say Gemini 3.x sends a single final input transcription and emit
   finished=True/partial=False for its text. [Model predicate](https://github.com/google/adk-python/blob/9b9aac038fcc8a2358331bc93d58dca4b85d31d2/src/google/adk/utils/model_name_utils.py#L199)
   matches gemini-3.* containing -live, excluding Live Translate. This is official
   implementation evidence for specific model semantics, not a universal wire
   guarantee or an acoustic test of this production session.
7. For other models, that ADK adapter appends text deltas and emits accumulated
   text when finished exists. Lines 501–530 explicitly say Gemini/Vertex may omit
   finished; they flush at generation_complete, turn_complete, or interrupted,
   synthesizing finished=True. **This is framework normalization, not a protocol
   guarantee that these events close input.** Do not copy this generic fallback
   into an authorization gate unchanged.
8. [ADK live flow](https://github.com/google/adk-python/blob/9b9aac038fcc8a2358331bc93d58dca4b85d31d2/src/google/adk/flows/llm_flows/_live_llm_flow.py#L433)
   yields transcription separately; lines 469+ execute model function calls using
   handle_function_calls_live. [Nonblocking sample](https://github.com/google/adk-python/blob/9b9aac038fcc8a2358331bc93d58dca4b85d31d2/contributing/samples/live/live_non_blocking_tool_agent/agent.py)
   accepts model task_description and sets WHEN_IDLE. It proves natural tool flow,
   **not** our stronger no-model-authored-instructions requirement.

## Local diagnosis

extension.ts:277 accumulates input and calls userTranscript only on t.finished;
orchestration.ts:99 requires args.text equal that completed pending text. Absent
finished leaves completed count zero even if text arrives and Gemini responds.
Zero completed count does not prove zero transcript text or prove a tool arrived.
Exact equality rejects paraphrases separately. The ADK 3.x rule directly applies
to the configured model name; previous research stopping at optionality missed it.

session.ts:351 schedules calls before serverContent handling, but execute is
microtask-deferred, so same-message transcript callbacks run first. Cross-message
tool-before-transcript remains possible; don't misdiagnose same-message ordering.
A nonblocking tool chain can span model turns, so model completion must not revoke
unused request authority.

## Minimal correction proposal (design; not implemented/proven)

- Separate raw provider metadata and semantic input events. For explicitly
  supported Gemini 3.x Live input events, use ADK's final-segment rule with
  finalitySource=model_contract. Preserve raw finished unknown; do not silently
  convert it. Unknown models need their own documented rule or explicit finished.
  interimInputTranscription is updateable low-latency text, not final input.
- Remove text from agent_send/agent_steer schemas. Host supplies captured input
  only, never model output, model paraphrase, or host observations. ASR is still
  an interpretation of audio, not authenticated verbatim intent. Keep explicit
  trusted confirmation for destructive operations/cancellation.
- Keep one host-owned request record: connection epoch, host ID, bounded segments
  and revision, provenance/finality, expiry, dispatch state. Cap bytes/time/calls;
  overflow rejects rather than forwarding a truncated imperative. Host idempotency
  must not depend solely on a model retry string. Atomically consume at host
  enqueue and cache outcome for duplicate call IDs/ambiguous dispatch failures.
- Tool chooses action, not payload. Freeze eligible captured input and dispatch
  once. If tool arrives first, boundedly defer with its call ID until eligible
  input arrives, or truthfully reject/expire. Never substitute model args. Waiting
  is visible and is not accepted work. Do not attach arbitrary late calls to the
  next user: invalidate pending calls on a known distinct newer user activity, disconnect, canceled
  undispatched call, interruption, or ambiguity. Exact ordering/association
  without input correlation IDs remains a design limitation.
- Delta models append documented deltas until their completion rule. 3.x final
  input segments should not be accumulated forever as unfinished deltas. Model
  turn completion neither commits nor resets this input buffer. If available,
  ACTIVITY_START can help identify new input, but cannot be universal dependency.
  Keep playback epoch separate. Interruption revokes undispatched authority/stops
  speech, not already accepted jobs. Fresh user request gets new identity.
- Multiple final segments per request require an explicit bounded grouping policy.
  No protocol transcript/tool correlation ID proves our preferred grouping. Show
  captured text. After dispatch, late segments must not silently rewrite a running
  request or auto-steer it; new speech requires a fresh tool-mediated handoff or
  confirmation. Sentence finality is not whole-request finality.

## Safety/usability choices still needing product decision

**Natural candidate:** model-specific final segments, host-owned payload, short
bounded deferral, visible captured request. Grounded in official ADK and avoids
verbatim argument matching. Residual risks: ASR mistakes, grouping, delayed or
missing events, unsolicited tool selection. Not proof of exact spoken intent.
Verify actual event shapes before claiming an acoustic pass; no paid probe here.

**Strict fallback:** if finality/provenance/request association is unknown, show
captured text and require trusted UI Send/confirm, or explicit push-to-talk framing.
This is honest and usable instead of permanent generic tool failure, but adds
friction. Client/hybrid VAD can bound capture and improve latency; it does not
establish undocumented ASR correlation guarantees.

**Never silently choose:** silence timer=final, model turn=final, absent finished
always true, arbitrary model task_description, or dispatch-then-append updates.
ADK's generic flush fallback is history/display normalization evidence, not our
stricter authority boundary.

Future tests: 3.x absent finished; unknown-model absence stays unknown; explicit
false/contradictory metadata policy; textless final marker; interim updates; tools
before/after transcript; multiple segments/calls; extra nonblocking model turns;
interrupt before/after enqueue; pending-call cancellation; reconnect; expiry and
overflow; duplicate calls and ambiguous outcomes; no model-written text reaches
host. Explicitly decide contradictory finished=false on a model-final channel.

Values unchanged: existing truth/unknown and owning-boundary principles cover this.
Feature wisdom adds model-specific ADK evidence and separates adapter normalization
from protocol guarantees.
