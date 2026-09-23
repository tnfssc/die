# Live voice research

Researched 2026-09-23 with tvly search and extract. No code changed.
User wants spoken meaning to drive on-screen animation. Provider not picked.

## What we found

ChatGPT Voice FAQ distinguishes Live, Advanced, and Standard. Live can listen while speaking and shows response text. The checked FAQ says video and screen sharing are in eligible mobile Advanced sessions, not Live. Features can change; check the FAQ before shipping.

OpenAI documents an animated orb, but not its animation algorithm or whether it reflects spoken meaning. Do not claim the orb visualizes intent or emotion. The public Realtime API is a build option, not proof of ChatGPT app internals.

Realtime offers WebRTC audio, speech-start/stop events, server and semantic VAD, interruption, transcript events, and function calls. Our proposed design: local audio analysis for fast movement; lifecycle events for listening/speaking states; tool calls for coarse scene changes. Render frames locally. This is our design, not a reverse-engineered ChatGPT design.

## Next

Ask whether the user wants an expressive orb or scenes that show spoken meaning. Test one provider with a small canvas and mic flow. Check auth, cost, latency, and tool-call timing before choosing. No implementation or worktree started. tvly hit a rate limit near the end; do not imply exhaustive research.

## Sources

- https://help.openai.com/en/articles/8400625-voice-mode-faq
- https://help.openai.com/en/articles/9703738-macos-app-release-notes
- https://developers.openai.com/api/docs/guides/realtime-webrtc
- https://developers.openai.com/api/docs/guides/realtime-conversations
- https://developers.openai.com/api/docs/guides/realtime-vad

Values unchanged. Existing values on showing what is real and using the simplest thing cover this work.

## User scope update

User chose two-way speech, CLI only, with animation inline in the terminal. No web panel. Asked whether an OpenRouter key works. tvly found OpenRouter transcription and speech endpoints, but did not establish a public full-duplex Realtime equivalent. OpenRouter can support a staged voice pipeline; do not promise native Realtime latency or interruption parity. No key supplied. Next: choose staged OpenRouter voice or direct Realtime, then inspect CLI rendering and local audio support.

## Credential staging and final UI scope

User wants a small audio-reactive line in the existing CLI status area, not an orb. Local only; SSH deferred. Gemini Live is the proposed provider. Created ~/.die/live.env with an empty GEMINI_API_KEY entry and mode 0600, outside the repo. It is only a staging file: die does not load it yet. Never print its contents once filled. User wants a visual setup flow and eventual auth.json integration; inspect the existing auth schema before adding or changing stored credentials. No live feature code yet.

## Agent loop decision pending

Started task_9334a390 then requested stop when user asked to settle orchestration and agent loop first. Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_9334a390. Branch: die/implement-cli-gemini-live-voice-9334a390. Inspect for partial work before resuming; nothing integrated. Proposed, NOT agreed: die owns agent/tools/approvals; voice is an interface to the current session. Need decide Gemini conversational autonomy versus single die reasoning loop, routing user turns while busy, and whether speech interruption also cancels work. Do not assume these product choices.

## Agreed loop design

User approved two concurrent loops. Gemini Live owns responsive ongoing conversation: speaks, listens, clarifies, and stays available while work runs. Configured die agent owns reasoning, tools, coding and task execution in the current session. Not dictation/read-aloud. Bridge must hand off asynchronously and inject real status/results without blocking live audio. Gemini may converse freely but must not invent task findings/completion. Prototype this non-blocking bridge first. Speech interruption stops playback, not implicitly work; retain normal tool permissions. Inline status line remains scope.

Active prototype: task_4b3cd724. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4b3cd724; branch die/prototype-concurrent-gemini-voice-and-di-4b3cd724. Review and integrate its commits when done. Values unchanged: existing guidance covers truthful status and simple designs.

Prototype completed on 6e972dd (five commits since base); not integrated yet. Independent read-only review task_b487b77e running. Parent test attempt task_2d3e3171 hit mise untrusted worktree config; do not bypass trust restrictions. Worker reports 85 selected tests, typecheck and compile passed. Remaining: review findings, integrate approved changes, opt-in real audio/protocol test, auth setup editor still deferred.

Correction: task_2d3e3171 completed exit 0 despite shell mise warning. Captured /tmp/die-live-parent-check.log confirms 50 tests passed (275 assertions) and bun run check completed. No trust bypass or retry used.
