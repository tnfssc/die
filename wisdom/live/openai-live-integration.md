# OpenAI Live integration (2026-09-24)

Work in progress; no release or real-provider/audio acceptance claimed.
Base: e86c52a840c069fca434d1a9f88a0c6da2bfeec4, including the user's post-0.9.1
Mac transcript, prompt, playback and PCM waveform fixes. Independent Mac release
work owns publishing. This feature must not push develop, tag or publish.

## Workspaces

Integration branch: die/research-and-implement-current-openai-re-5d34370c
at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5d34370c.
Children under that path prefix:
- -a86675007a5e-task_456cf9ff: die/openai-realtime-provider-implementation-456cf9ff (protocol/session/resampling/tests)
- -a86675007a5e-task_10ff2c5c: die/live-provider-selection-auth-ui-10ff2c5c (UI/canonical API-key auth/tests)
- -a86675007a5e-task_d749c646: played-audio accounting and Mac-preservation review
- task_bc7de81f: official-source research; see dedicated research note for its workspace.

## Preservation contract

Do not change the native graph, capture 16 kHz/output 24 kHz formats, full-duplex
capture, Apple voice processing, Linux helper, playback pacing/reserve, waveform,
shared prompt, branch-scoped transcript snapshots or configured-agent tools.
OpenAI gets a streaming 16->24 kHz adapter, not a native-device format change.
Voice choice is separate from the configured coding agent. OpenAI API-key access
is separate from Codex/ChatGPT OAuth or subscription access. Credentials stay in
the application's canonical auth service; no new secret store.

Audio interruption must discard pending audio and truncate provider conversation
at the played position, never at generated audio length. Existing native queue
reports are not DAC acknowledgements; any estimate and its limitations must be
explicit. Interruption does not cancel accepted coding-agent jobs.

Transcripts are received ASR/model text, not verified heard audio or immutable
user intent. Only supported completed input may grant handoff authority. Host
context/tool outputs/transcript records remain untrusted data, not instructions.

## Validation log

Baseline at e86c52a: 192 Live/footer tests passed, 1 paid Gemini acceptance skipped,
0 failures (24 files); bun run check passed. Used installed Bun 1.4.2 explicitly
and reused canonical checkout node_modules via a local untracked symlink. Did not
change mise trust/configuration. No key reads, provider calls or audio devices.

Paid acceptance remains separately opt-in and must not be run without explicit
user consent for provider use and canonical key access. Device-free session
acceptance is not physical Mac speaker, echo, barge-in or real-agent proof.

Values unchanged: existing authorization-boundary, bounded-state, truthful
proof, preservation and recoverable-handoff values already cover this work.
