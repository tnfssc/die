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

Candidate pushed: 7dc618cf97df615e26aa40f76328d3a12b67d368.
Hosted CI: https://github.com/tnfssc/die/actions/runs/36162060645
Release dry run: https://github.com/tnfssc/die/actions/runs/36162060555
Both started; watchers save logs in artifacts/live-main-hosted-ci.log and
artifacts/live-main-release-dry-run.log. Do not tag until both pass.

## First hosted gate failure

CI 36162060645 failed in the macOS lane: nine new real-runtime Live tests
reported ENOENT spawning dist/die. That lane previously prepared source assets
only. Linux/local gates build the CLI first, explaining the local success.
Parent changed the macOS lane to build the real production CLI/web bundle
before Live tests, with pinned Node/pnpm and a 30-minute lane timeout. No
tests were skipped, renamed out of the gate, or pointed at a fake binary.
Failed log: artifacts/live-main-macos-failure.log. Candidate must be pushed
again and both hosted gates pass at its new SHA before tagging.

New candidate e8396419427ebcae193192f876931a7dfc27bb36 pushed after bash syntax,
actionlint and diff checks. Product code is unchanged from the locally passing
candidate; only macOS CI setup and wisdom changed.
CI: https://github.com/tnfssc/die/actions/runs/36162937859
Release dry run: https://github.com/tnfssc/die/actions/runs/36162937959
Requested cancellation of superseded dry run 36162060555 to avoid duplicate
build work. Its watcher failing from cancellation is not a new product failure.

## Correct macOS fix after CI contract review

Dry run 36162937959 failed three CI-contract tests: the macOS source lane
intentionally excludes full web/packaging builds. The earlier build addition
was the wrong fix. Existing tests/fixtures/live-execute-cli.sh already invokes
the REAL src/cli.ts hidden execute route, with a child process and real IPC,
not an evaluator stub. This is documented in
[macOS source CLI](../live/macos-live-ci-source-cli.md); parent missed that
existing path in the first correction.

Restored the original macOS workflow/runner. New integration fixture now uses
DIE_PROBE_EXECUTABLE if supplied, compiled dist/die when built (Linux/release),
or the existing real source wrapper when no binary exists (macOS source lane).
Added the new fixture to the existing macOS regression guard. No tests skipped
or moved out of the macOS glob. Forced-source integration + CI contracts:
31 passed, 385 assertions, 0 failed. Full local gate is being rerun before
push. Production feature code has not changed during these CI corrections.

Corrected full local shared gate task_b18290f4 passed: 1098 root tests,
17 opt-in skips, 0 failures; all web, build, lint/format/typecheck, transport
and standalone smoke gates passed again. Log: artifacts/live-main-release-ci-final.log.
Value 7 now links the recurring source-CLI-fixture lesson; no new value was
needed. Existing source tests stay in the macOS lane and use real runtime/IPC.
