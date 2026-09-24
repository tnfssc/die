# Grounded spoken handoff candidate (2026-09-24)

Initial worktree: /Users/sharath/.die/worktrees/die-f528e86af6b5-task_d89ea45b
Review of candidate 2789302: /Users/sharath/.die/worktrees/die-f528e86af6b5-task_c403a669

Context: [physical failure](missing-tools-after-promotion.md),
[pinned Google research](google-live-sdk-handoff-research.md). Six tools and a
connected host with zero completed input transcripts is not proof of a broken
host connection. The old finished-only gate plus exact model-argument equality
could reject ordinary speech before any host enqueue.

## Evidence and implementation

Read the official pinned ADK sources directly:
- [gemini_llm_connection.py:432–447](https://github.com/google/adk-python/blob/9b9aac038fcc8a2358331bc93d58dca4b85d31d2/src/google/adk/models/gemini_llm_connection.py#L432): tool calls may precede transcription; Gemini 3.x input text is emitted as a final segment.
- [model_name_utils.py:199](https://github.com/google/adk-python/blob/9b9aac038fcc8a2358331bc93d58dca4b85d31d2/src/google/adk/utils/model_name_utils.py#L199): 3.x Live predicate excludes Live Translate.

Session normalizes absent finished only for the explicitly supported configured
model, gemini-3.8-live, and only nonempty inputTranscription. It retains rawFinished
when supplied and labels finalitySource provider/model_contract. Unknown model
names (including other unreviewed 3.x names), Translate and output text get no
inference. Explicit false wins, deliberately stricter than ADK's unconditional
3.x normalization. Explicit true, including a textless delta completion marker,
remains supported. Interim transcription cannot grant authority even if marked
finished. No silence, model-turn or elapsed-time finality synthesis.

agent_send/agent_steer now take requestId only. Unexpected text arguments reject;
the host receives the bounded captured user transcript, never a model paraphrase,
context observation or job output. One latest unused capture, 4000 characters
(at most 16000 UTF-8 bytes), fixed 60-second monotonic expiry; reject overflow
before trimming. Consume synchronously before host invocation, even on ambiguous
failure. Existing host request idempotency and bounded Session call receipts
remain; a new model ID cannot reuse consumed capture. This is ASR provenance,
not authentication of exact spoken intent.

## Ordering and grouping policy (deliberately limited)

No cross-message waiting queue. Without input/tool correlation IDs we cannot
prove a call preceding a transcript belongs to that future input. Reject calls
without eligible capture; do not advise blind retries after transcription. Session
returns only typed allowlisted public failure codes/messages, never raw exception
text; unrelated failures remain generic. SDK call receipts replay failures.
Orchestration tombstones every valid handoff requestId it attempts, including
rejections (also unexpected text arguments), before inspecting capture. A fresh
SDK call ID cannot rebind that requestId to newer input, across send/steer.
The set holds at most 256 IDs per orchestration lifetime, with no TTL or eviction;
at capacity new handoffs fail closed, while read tools remain available. Replacing
the live session creates a new set; this is not durable cross-reconnect identity.
Host idempotency remains independent. IDs rejected before orchestration execution
are not in this set; Session retains its separate SDK call receipts. Same-envelope
input runs before tool scheduling; this is the only bounded ordering deferral.
The dispatch microtask also checks input revision, cancellation and session state
so newer input observed before that check invalidates the scheduled call.
This is the orchestration-dispatch boundary, not actual host enqueue. Once
execute starts, capture is consumed synchronously and the payload is fixed.
LiveHostBridge.once enqueues in a later microtask, checking host scope but not
Session input revision/cancellation; activity in that gap does not cancel the
fixed handoff. Do not describe this as revocation until host acceptance.

Known fresh transcription, optional ACTIVITY_START/interim signals, interruption,
stop/close and cancellation of an undispatched handoff revoke authority. Interim
signals clear unfinished capture, conservatively, rather than merging independent
channels. Provider delivery of activity signals is not assumed. Accepted host
work is never cancelled by these signals; nor is a handoff already dispatched
to orchestration but awaiting the bridge enqueue. Existing job_cancel trusted UI
confirmation and playback/audio epochs remain independent.

Each contract-final segment replaces unfinished capture; multiple unconsumed
segments are latest-only, not silently concatenated into an inferred whole
request. Explicit delta streams accumulate within the existing bound until
explicit finality. Model turn completion neither commits nor erases capture.
Late segments cannot rewrite accepted work or auto-steer it; they need another
tool-mediated handoff. Existing UI displays captured transcription.

Residual limits: sentence finality is not whole-request finality; no protocol
correlation ID proves the selected segment and call share intent. A late call
with a fresh model-invented requestId can select the latest unconsumed eligible
segment. Tombstones do not prove input/call correlation or solve that association;
speech not yet reported as activity/transcript is unobservable. Missing/out-of-order signals can still cause
rejection or association ambiguity. Multi-sentence grouping and cross-message
call-before-input are intentionally not solved by timers or speculative queues.
Trusted Send/confirmation or explicit input framing remains the stricter fallback.

## Checks / handoff

97 focused tests pass across live-session, live-extension, live-orchestration,
live-tools, live-host-bridge, live-playback, live-audio-lifecycle. Real Session/Run
seams cover supported absence, unknown/Translate, explicit false, textless
markers, before/after/same-envelope calls, turn chains, latest segments, duplicate
IDs, cancel/interrupt/stop/new activity, and rejection of fabricated tool text.
Orchestration tests cover expiry, overflow, ambiguous failure consumption, rejected
request rebinding with fresh SDK IDs (both send/steer), and fail-closed tombstone
capacity without eviction. Real Session/Run tests assert public pre-transcript
reasons and reject the old request after newer activity despite a fresh SDK ID.
Session tests verify typed errors use fixed messages and spoofed/unknown codes
or raw exception details cannot leak.
Host bridge tests retain trusted cancellation confirmation; audio tests remain
green. bun run check passes (including local asset preparation and tsc).
Dependencies were reused from the existing main checkout; no dependency install.

No provider, microphone/speaker, installed-binary or promotion operations.
No acoustic success claimed. Parent must review and perform provider validation;
in particular measure actual transcript/tool ordering before adding any waiting.

Values unchanged: owning the authorization boundary, bounded state, truthful
unknowns and lifecycle-specific identity already cover these lessons.
