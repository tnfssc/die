# v0.13.0: Live is the main orchestrator

Published 2026-09-25 at 17:14:45 UTC. Latest stable release:
https://github.com/tnfssc/die/releases/tag/v0.13.0
Tag commit: 03496ca01b9e9b30b654176d683727918c26dd27.

User authorized implementation and release. No local installation was requested
or performed. Update with die update, restart, then die --version should show
0.13.0.

## What shipped

Live owns the ordinary root prompt, execute tool/runtime, permissions, branch
history and jobs. Typed input, speech and background results share one active
owner; completion does not start a second text-main turn. Explicit voice/work
stops stay separate. Gemini Live and OpenAI Realtime use direct tools.
GPT-Live's client delegation is no longer offered as an equivalent main mode.

Per-turn instruction/tool-policy changes stop Live safely and require text.
Large context/results and images are retained as local artifacts; images are
not provider vision inputs. Reconnect is explicit, not automatic tool replay.
Connected paid-provider and physical audio acceptance was not run: canonical
Live keys were absent. No alternate secret source or credential change was used.
Public notes: support/release-v0.13.0.md.

## Final proof

- Full local shared gate passed twice with Bun 1.4.2, Node 24.21.0,
  pnpm 11.27.1 and SHELL=/bin/sh. Final root result: 1098 passed, 17 existing
  opt-in skips, 0 failed, 27303 assertions. Web: 260 backend, 158 model,
  26 contract and 9 projection tests passed. Format/lint/typecheck, fresh
  production CLI/web build, offline transport and standalone smoke passed.
  Logs: artifacts/ci/ and artifacts/live-main-release-ci-final.log.
- Hosted Linux/macOS CI passed at the tag SHA:
  https://github.com/tnfssc/die/actions/runs/36164486479
- Release dry run passed at the same SHA, including native Mac helper,
  cross-platform binaries and actual Mac binary/old-updater checks:
  https://github.com/tnfssc/die/actions/runs/36164486849
- Tag workflow passed, reused exact-SHA assets, repeated Mac binary/updater
  gates, and published:
  https://github.com/tnfssc/die/actions/runs/36165614050
- GitHub reports latest, non-draft, non-prerelease. All 12 expected assets
  are uploaded and nonempty: four binaries, four SHA256 files, LICENSE,
  SOURCE.txt and both third-party attribution files. Metadata evidence:
  [v0.13.0-publication.json](v0.13.0-publication.json).
  No unnecessary published-binary downloads or hash rechecks.

## Review and gate fixes

Implementation squash 8f05c42 integrated as 4e7060f. Independent review found
concurrent history ordering and missing-final-ASR waits. Fix 8e03bb7 integrated
as 2decd0a serializes tool pairs, defers other owner messages, and revokes
waiting admission on unfinished speech. Regression tests use true overlap,
typed/final speech, host updates, deduplication and explicit stop paths.
A claimed Realtime missing-name bug was rejected after checking current
primary types; the real receive-size mismatch was fixed.

First hosted CI 36162060645 failed nine new integration tests with ENOENT at
dist/die on macOS. Parent initially added a full Mac web/CLI build (e839641).
Dry run 36162937959 caught that wrong approach with three CI-contract failures.
The established device-free lane already has a real source-CLI wrapper:
tests/fixtures/live-execute-cli.sh invokes src/cli.ts with the normal child
runtime and IPC. It is not a mock evaluator.

Final correction 03496ca restores the original Mac lane and uses the compiled
CLI when present (Linux/release), or the existing real source runner otherwise.
All tests remain in the Mac glob. Forced-source runtime + CI-contract checks:
31 passed, 385 assertions. Corrected hosted Mac tests also passed. No test
skips or altered runtime behavior were used to hide the setup failure.
See [source CLI lesson](../live/macos-live-ci-source-cli.md).

## Work and values

Implementation, tests, durable worktrees and limitations:
[main owner](../live/main-orchestrator-implementation.md),
[parent release work](../live/main-orchestrator-release-work.md),
[investigation](../live/main-orchestrator-investigation.md).

Values reviewed after integrated review and release. No new value needed.
Value 7 now links the recurring source-CLI-fixture lesson: reuse the existing
real path before adding another build. This applies to runtime tests, not a
reason to skip packaging or real platform acceptance. Post-release edits are
wisdom/evidence only; a docs-only commit skips redundant CI builds. The tested
and published tag stays at the exact candidate SHA above.
