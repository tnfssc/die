# Voice controls, transcript grouping, and Realtime terminal diagnostics

- Voice self-stop closes voice resources while leaving agent jobs running. Explicit work-stop uses current-session scoped execute controls, reports pending cancellation honestly, and handles supported asynchronous descendants. Busy-agent steering is processed at the next available steering boundary; blocking tools can delay it. Detached descendant termination is not guaranteed.
- GPT-Live transcript grouping keeps adjacent speech together with bounded speaker/time/size grouping and preserves corrections and handoff authority.
- Fixed the proven terminal UI bug that discarded safe detailed OpenAI Realtime errors. Classified handshake/status and startup-stage diagnostics now reach the UI without exposing keys or raw provider bodies.

The actual cause of the user’s OpenAI rejection remains unknown. Exact compiled production transports passed offline loopback tests on Linux and macOS; that is not proof of authenticated OpenAI connectivity. No real jobs were cancelled, no keys accessed, no paid provider calls or physical-device tests were performed.

## Update and retry

Run `die update`, exit and restart die, then confirm `die --version` reports 0.11.0. Select `/live provider openai` and the same `/live model gpt-realtime-2.1`, confirm with `/live status`, then run `/live start`. Keep the same saved key; do not paste it into chat. Starting voice may incur normal API charges. If it fails, share only the new sanitized error and selected model, not keys or raw logs.
