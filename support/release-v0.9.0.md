# v0.9.0

Live Lab can now work with the current session’s coding agent and jobs: scoped list/inspect, send/steer to the current agent, and explicitly confirmed cancellation. Normal speech needs no extra terminal confirmation. Agent handoffs require the exact trimmed text of a completed input transcript; paraphrases, missing completion markers, and expired speech are rejected. This is provider-derived transcription, not speaker authentication or proof from a real conversation.

Host context bursts are coalesced and duplicate tool calls replay their result without repeating work. Native job completion is observed through bounded scoped polling, not an exhaustive event stream: short-lived or undiscovered jobs can be missed.

On macOS, native capture explicitly disables voice-processing bypass and verifies it again after startup. Ready diagnostics report processing state and route sample rates without device identity or audio. The v0.8.2 audio graph and startup diagnostics are retained. **MacBook speaker echo cancellation and double-talk remain acoustically unverified.** Capture is not muted during playback.

Run `die update`, start a fresh `die` session, then `/live-lab`. Live Lab remains experimental and uses its existing consent flow. The Apple Silicon helper is embedded in the Mac stable executable. Publication is gated by the normal native Mac, embedded-helper, updater, deterministic test, build, web, and PTY checks. No real devices, paid APIs, real job cancellation, or live-provider conversation were used for verification. Ordinary /live and stable updater asset names are unchanged.
