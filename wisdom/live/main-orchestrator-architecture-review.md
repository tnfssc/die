# Independent main-owner architecture review

Read-only source/SDK audit on 2026-09-25, before implementation.

## Independent review findings

**The safest seam is Pi’s existing agent run, not a parallel voice executor.** In the installed SDK, `AgentSession.prompt()` runs authentication/compaction preflight, `emitBeforeAgentStart`, image normalization, prompt/loadout assembly, and then the agent stream (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1250–1325`). The agent’s `transformContext` calls `extensionRunner.emitContext` (`dist/core/sdk.js`, in `createAgentSession`; located via the installed SDK source). `getSystemPrompt()` and `getActiveTools()` expose state, but **reading them before a turn does not produce that turn’s final prompt and context**. A viable opportunity is a deliberately controlled Pi stream transport, like the offline capture in `src/prompt-preview.ts:150–190`: it receives the assembled `TranscriptContext` after normal preflight. That preview uses an isolated session and fake stream; it is not itself a production owner.

**Do not invoke a registered tool’s `execute` callback directly and call it Pi-equivalent.** Pi installs `agent.beforeToolCall`/`afterToolCall`, including extension `tool_call` denial and `tool_result` mutation/image normalization (`agent-session.js:235–285`). `execute` is registered in `src/typescript/extension.ts:52–82`; its implementation binds the session manager, leaf/session IDs, cancellation, child runner, and job IPC (`:81–145`). A direct callback can reach JS execution but skips Pi’s hooks unless the implementation explicitly routes through or faithfully invokes that lifecycle. Review both denial behavior and post-result mutation, not just a successful shell call.

**History must be on the same Pi branch, in valid message order.** Pi persists user/assistant/tool-result messages from `message_end` through `SessionManager.appendMessage` (`agent-session.js:580–605`). Merely sending speech transcripts as custom observations, or saving a tool result without its preceding assistant `toolCall`, is not normal history. Pi even defers custom messages while streaming to avoid placing them between a tool call and result (`agent-session.js:1470–1515`). Check replay after resume/branch/compaction, including images and large execute artifacts; Live’s bounded host context/result transport is not a substitute for canonical history (`src/live/session.ts:25, 218–242`).

**Completion delivery currently starts the text model.** `src/agent/extension.ts:245–275` batches completion/attention and calls `pi.sendMessage(..., {deliverAs:"steer", triggerTurn:true})`; Pi starts `_runAgentPrompt` when idle with `triggerTurn` (`agent-session.js:1470–1510`). Voice ownership must intercept/reroute *both* completion and attention for its current branch, and preserve queued delivery through disconnect or owner transfer, without a second main-model response. `triggerTurn:false` alone appends without necessarily delivering work to Live.

**Typed input and stopping need an explicit single-owner policy.** Current Live orchestration forwards text to the configured agent (`src/session/host.ts:266–283, 307–324`), which is precisely the companion path to retire for main Live. Typed input while Live is active must enter the same turn/history/serialization owner, not concurrently call Pi’s text model. `live.stop()` is session-scoped through the shared extension bus and only tears down voice, preserving jobs (`src/live/lifecycle-access.ts:3–28`; `src/typescript/extension.ts:111–122`). `jobs.stopWork()` requests scoped jobs, then requests foreground abort **after its execute result is delivered** (`src/agent/extension.ts:515–545`); stopping speech or Live is not stopping work. Ensure voice-provider shutdown cannot abort the job owner unintentionally, and a stop-work report is not treated as proof every job exited.

**Provider evidence remains limited.** `wisdom/live/main-orchestrator-investigation.md` records offline prompt/schema and execute/job probes, but no connected provider call: credentials were unavailable. Gemini Live/OpenAI Realtime are plausible function-call transports; documented GPT-Live client delegation does not supply executable tool arguments. Do not claim wire acceptance or parity from the offline probes.

### Acceptance checklist

- Same effective `before_agent_start` prompt, selected tools, `context` edits and branch projection as a normal turn.
- Tool denial/result hooks, execute’s original owner/IPC/cancellation, and image/large-output behavior exercised.
- User → assistant tool call → result → continuation persist and replay on one Pi branch.
- Speech, typed input, reconnect, completion and attention serialize under one main-model owner; no incidental Pi text request.
- `live.stop` preserves jobs; `jobs.stopWork` delivers its report before foreground abort; interruption does neither.
- Connected end-to-end provider call/result/continuation test before declaring production-ready.

Read `wisdom/values.md` and the investigation note; no wisdom or values changed in this read-only review.
