Live now acts as the main orchestrator, not a companion that forwards requests to a second agent.

- Gemini Live and OpenAI Realtime use the normal main-agent instructions and execute tool. Work runs through the existing TypeScript runtime, permissions, session, and jobs.
- Typed input and voice share the active session. Background results return to Live without starting a second text-agent turn. Tool calls and results stay in order in the saved history.
- Speech interruptions do not cancel work. Explicit voice-off and stop-work requests keep their separate behavior. Session changes reject stale calls, and stopping Live returns control to text.
- GPT-Live (gpt-live-1) is no longer offered for this mode: its client-delegation protocol does not expose the same direct tools. Choose Gemini Live, gpt-realtime-2.1, or gpt-realtime-2.1-mini instead.

Limits: Live requires the ordinary execute-only tool setup. If a new turn changes instructions or tool policy, Live stops safely and asks you to continue in text. Large context/results and images remain available as local artifacts; images are not sent as provider vision inputs. Provider disconnects require restarting Live; old tool calls are not replayed automatically.

Validation includes offline provider fixtures and real local session, execute, async-job, history, and stop-helper integration tests. Connected paid-provider and microphone/speaker acceptance were not run because no Live provider API key was configured in the release environment.

Update with die update, restart, and check die --version for 0.13.0.
