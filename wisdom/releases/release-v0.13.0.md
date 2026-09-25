# v0.13.0: Live is the main orchestrator

User authorized production implementation and release. Feature work and review
are in [Live release work](../live/main-orchestrator-release-work.md), with
implementation details in [main owner](../live/main-orchestrator-implementation.md).

## Changes

Same ordinary root instructions and execute tool/runtime under one active
session owner. Typed/voice input, background job results, branch history,
permissions and explicit voice/work stops share that owner. Gemini Live and
OpenAI Realtime are supported direct tool transports. GPT-Live's distinct
client-delegation mode is no longer offered as equivalent.

Changing per-turn instructions/tool policy stops Live safely and requires
text. Images/large context and results remain local artifacts, not provider
vision inputs. Reconnect is explicit, not automatic tool replay. Public notes
in support/release-v0.13.0.md state these limits and the missing connected
provider/audio acceptance. No Live API key was configured; no alternate key
source was used.

## Review and proof

Parent rejected an outdated Realtime schema review claim after checking
current official types. Confirmed size-limit mismatch was fixed. Independent
main-owner review found concurrent history ordering and missing-final-ASR
waits; fix 8e03bb7 (integrated 2decd0a) adds controlled overlap and revocation
tests. The earlier prototype was not counted as production proof.

Full local shared gate passed with Bun 1.4.2, Node 24.21.0, pnpm 11.27.1,
SHELL=/bin/sh. Fresh CLI/web build, lint/format/typecheck, offline transport,
standalone smoke; root 1098 pass / 17 opt-in skips / 0 fail; web 260 backend,
158 model, 26 contract and 9 projection tests passed. Logs: artifacts/ci/ and
artifacts/live-main-release-ci.log.

## Publication status

Not published yet. Parent will push the candidate to develop, wait for hosted
Linux/macOS CI and Release dry run at that exact SHA, then tag v0.13.0. Check
published metadata and expected nonempty assets; no redundant binary downloads.

Values reviewed after integrated work: unchanged. One owner, whole-path proof,
source verification and honest limits already cover this feature and fixes.
