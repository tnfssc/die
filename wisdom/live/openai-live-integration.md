# OpenAI Live integration (2026-09-24)

Integration candidate for parent review; no feature release or real-provider/audio acceptance claimed.
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

## Integration and synchronization

Official research, provider, UI/auth, and playback pieces were reviewed together. Draft GA field/tool-timing/ASR-ordering bugs were corrected before acceptance; the shared Run callback no longer turns OpenAI display text into authorization. Real Session/Run offline regression verifies delayed final ASR attaches the exact captured request once to the configured agent. Independent auth/playback review found no blocker; its menu-race and misleading OpenAI import-capability observations were fixed with tests. A second safety review uses branch die/final-realtime-safety-audit-b87bb9d9 in sibling worktree ending task_b87bb9d9. Protocol correction worktree ends task_48d3a6e6, branch die/correct-openai-ga-protocol-and-authority-48d3a6e6; auth/playback review worktree ends task_bec29dbc, branch die/independent-live-auth-playback-review-bec29dbc.

Mac release landed independently: fetched develop 44ff46f (v0.9.2 evidence), inspected 103bff7's final-transcript-chunk fix and release notes, and merged it normally as 13f128c. No reset/rebase of user work, push, tag, publication, installation, or existing checkout edits. Feature has no diff from that new develop in native/, audio.ts, Gemini session.ts, prompt.ts, waveform.ts or transcript.ts. Version remains upstream 0.9.2, not a new feature release.

Before that merge: 223 Live/OpenAI/footer tests passed, two paid provider tests skipped, zero failures; typecheck passed. Real Bun WebSocket loopback proves Authorization header transport with fake credentials only. Linux helper compiled/self-tested without opening devices. The existing helper embedding plugin intentionally only supports bun-darwin-arm64, so Linux embedded-helper build was not claimed. Full fresh web build stopped because pnpm was unavailable; compiled CLI validation instead copied the existing canonical e86c52a web build (unchanged web source/pin) and used supported --reuse-web. Linux compiled CLI build, --version and --help passed; Mac compilation/install/acoustics for this feature remain untested. This does not inherit physical proof from the separate v0.9.2 release.

Setup: /login → Sign in with an API key → OpenAI; /live provider openai; /live setup or /live. Choice is extension-session scoped. /live provider google restores Gemini. OpenAI requires a stored canonical openai API key; it deliberately does not use openai-codex OAuth, subscription auth, ambient fallback, or Google migration files. Paid session-only acceptance is tests/live-openai-provider.acceptance.test.ts behind DIE_RUN_OPENAI_LIVE_ACCEPTANCE=1; it may read the canonical key and contact OpenAI, so do not execute without explicit user consent. Physical barge-in, echo/speaker quality, entitlement, automatic-VAD/model/tool behavior and exact acoustic timing remain paid/device acceptance gates.

Final synchronized verification: 226 passed / 2 paid acceptance skipped / 0 failed across 26 Live/OpenAI/footer files (21,667 assertions), plus typecheck and git diff --check. The no-audio-first-delta cancellation, late-ASR-after-server-cancel, synchronous close during connect, duplicate ASR, stale microtask and send-backpressure regressions are included. Independent final read-only safety review reported no blocking GA bug. Linux CLI rebuilt from final runtime sources with --reuse-web and passed --version (0.9.2) and --help. Durable scripts/live-openai-offline-smoke.ts was compiled and executed: real Bun loopback WebSocket accepted fake Authorization header, GA setup, and synthetic PCM append. No external provider, user key, microphone or speaker was involved.
