# OpenAI Live as primary main orchestrator (2026-09-25)

Read ../values.md and existing GPT-Live/OpenAI transport notes. Investigation only: no production changes, dependency installation, microphone, private context or user jobs.

## Contract to replace

src/cli.ts calls withDieSystemPrompt (src/system-prompt.ts): explicit CLI/project/global SYSTEM.md overrides otherwise dieSystemPrompt() from src/prompts.ts is supplied as Pi --system-prompt. Pi appends cwd, project context and skills, and extension tool declarations. src/agent/extension.ts injects mainAgentGuidance('orchestrator', owner) at before_agent_start. src/prompt-preview.ts:createPromptPreview captures **the actual** systemPrompt, tools and messages at Pi's provider-stream boundary in a synthetic isolated session with zero model requests. That effective frame, not dieSystemPrompt() alone, is what SAME normal prompt assembly means. Probe below uses the base only, not this exact assembled frame; never transplant private active history into a test.

src/typescript/extension.ts registers execute: required code:string, optional timeoutSeconds:number >=0.1, optional outputByteLimit:integer 0..Number.MAX_SAFE_INTEGER. src/tool-schema.ts uses zod mini toJSONSchema draft-7; description src/prompts/execute-description.md and guidance src/prompts/execute-reference.md are inserted by Pi. The handler executeIsolated carries TS evaluation, shell/subagent, jobs/history, permission/ownership and cancellation; declaring a similarly named function alone does not reproduce that host behavior.

Existing src/live/openai-session.ts sends session.update to /v1/realtime?model=gpt-realtime-2.1 using src/prompts/live.md, audio output and src/live/orchestration.ts's *different* bounded voice tools. Completed function calls are followed by conversation.item.create function_call_output and response.create. This is a capable protocol seam, but it is NOT currently the Pi root orchestrator. src/live/gpt-live-session.ts sends session.start to /v1/live/sessions with src/prompts/gpt-live.md and delegation:{type:'client'}. src/live/extension.ts forwards session.delegation.created to the configured-agent bridge, explicitly not the requested replacement.

## Public protocol evidence, not connected proof

Realtime guide https://developers.openai.com/api/docs/guides/realtime-conversations documents function_call/function_call_output and tool_choice. Live delegation guide https://developers.openai.com/api/docs/guides/live-delegation says client delegation.created contains offset_ms and delegation ID/target, **not task text, tool name, args or a complete transcript**; commentary.append/thinking.append are scoped observations. Official type source https://raw.githubusercontent.com/openai/openai-node/master/src/resources/live/live.ts: SessionConfig has model/audio/client/delegation/input/instructions/store, no tools or tool_choice. ClientEvent union has no Live native tool output; FunctionTool and response.item.create belong to the delegated Responses backend. Responses delegation introduces another model, not the goal. A hypothetical server accepting/echoing tools config would not establish real function-call plus result. See also https://developers.openai.com/api/docs/guides/voice-websockets?api=live and https://developers.openai.com/api/docs/models/gpt-live-1 .

## Reproducible bounded attempt

main-orchestrator-openai-probe.ts uses createDefaultLiveCredentialService(undefined,'openai').loadKey(), no environment fallback. Its three modes: realtime proposes synthetic text, execute function schema, simulated result only (never evaluates generated code); live-tools deliberately tests tools/tool_choice at session.start; live-delegation starts client delegation without inventing an unsupported text input event. Each socket has a 12-second deadline. Events logged with bounded selected fields; no key, auth header, arbitrary tool code or audio. This probe uses a synthetic approximation of the schema and base prompt rather than Pi's provider-boundary frame. It cannot claim asynchronous responsiveness without actual overlapping turns.

Command: temporary node_modules symlink to existing /home/tnfssc/Code/die/node_modules (removed afterwards); /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun wisdom/live/main-orchestrator-openai-probe.ts realtime, live-tools, live-delegation (three invocations). **All three failed before connection** with exact canonical-loader error: "Live requires a configured OpenAI API key in canonical auth storage." No network attempt, session acceptance, function call, response round-trip, delegation event or async test occurred. First attempt with bare bun failed because the worktree mise.toml is untrusted/no bun on PATH. No alternate credentials were sought; no production key is present via this loader. Existing mocked transport tests are fake seams, not connected evidence. The historical reported GPT-Live connectivity in other sessions does not grant this probe credential access or prove native tool support.

## Hard blockers and recommendation

Credential availability blocks connected trials here. GPT-Live public client protocol does not describe native execute calls; delegation provides no executable args and Responses delegation means a separate backend model. For Realtime, direct execute is **protocol-plausible**, not validated or integrated: full prompt/tool capture, root-session execution authority, audio/text turns, interruption/staleness, result reinjection, asynchronous jobs and completion delivery need design and connected end-to-end trials. Recommend an isolated Realtime prototype only after canonical authorized API key is available. Require observed session.updated, actual execute function_call and simulated function_call_output followed by answer, overlap/interrupt response test, then separately safe integration through existing host dispatcher. Do not swap the default or silently substitute a configured-agent handoff. Keep GPT-Live a voice front end pending evidence of native call/results under the actual protocol.

## Parent review

The initial simplified probe below is historical. Parent replaced its prompt
and tool construction with the actual root orchestrator provider-boundary
preview, added explicit --offline/--paid modes, call caps and result-marker
observation. Both modes ran; paid trials still stopped at missing canonical
credentials. See main-orchestrator-investigation.md and
main-orchestrator-provider-attempts.json for current evidence. Parent also
checked the public types and saved selected excerpts with a source hash.
