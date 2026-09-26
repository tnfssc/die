# v0.15.0 released

Published https://github.com/tnfssc/die/releases/tag/v0.15.0.
Tested tag: e6b54109879b3e2e2af17762bb8d768d0eb9edfd.
User approved this release and explicitly prioritized user and agent surfaces.

## Scope and limits

Parent CLI persistent questions and /questions; short-ID replies, saved state
and guarded continuation. Cross-provider Live model picker with credential-only
provider setup. GPT transcript bubbles removed while canonical context stays.
Native interpolation packet-tail defect fixed. Public notes:
[support release notes](../../support/release-v0.15.0.md).

No web question UI, automatic child relay, child in-place replies or targeted
voice answers. Uncertain answer dispatch is not blindly replayed. No paid
provider/device acceptance, no local installation. Offline waveform proof
establishes a seam bug and fix, not that all user-device crackling is resolved.

## Final proof

- Full local gate: 1160 passed, 17 opt-in skips, zero failures; 28188 assertions
  across 161 files. Format/lint/typecheck, fresh CLI/web build, web suites and
  standalone smoke passed. Log artifacts/questions-release-ci-corrected.log.
  Bun 1.4.2, Node 24.21.0, pnpm 11.27.1, SHELL=/bin/sh.
- Exact-SHA Linux/macOS CI passed:
  https://github.com/tnfssc/die/actions/runs/36235237077
- Exact-SHA release dry run passed, including native Mac helper:
  https://github.com/tnfssc/die/actions/runs/36235237061
- Tag publication passed:
  https://github.com/tnfssc/die/actions/runs/36235671933
- Native Live workflow passed at earlier candidate 8247e4b; native source was
  unchanged afterward: https://github.com/tnfssc/die/actions/runs/36234271585
- GitHub latest is v0.15.0, not draft/prerelease. All 12 expected assets exist
  and are nonempty. [Metadata](v0.15.0-publication.json). No unnecessary binary
  downloads or repeated checksum comparisons.

## Surfaces checked

Actual source CLI PTY: questions survive progress/restart, short IDs work,
saved answers remain visible, corrupt storage differs from no questions.
Real offline Pi SDK proves one new parent turn; hidden answer metadata does
not become a chat bubble. Parent caught and removed an irrelevant unavailable
badge in no-history sessions while keeping explicit command errors.

Actual picker PTY at 80/120 columns: all five model IDs/readiness labels fit;
selected marker changes; provider setup offers Done, not Start voice. No
microphone or provider socket in fixtures. Parent read complete captures,
not only the intended widget. See [question review](../questions/final-surface-review.md)
and [picker evidence](../live/unified-picker-render-evidence.md).

GPT flood capture: 25 metadata bubbles before, zero after, readable You/Voice
view preserved. Native 437 Hz fixture: 49 seam sample errors before, zero after;
ASan/UBSan and cross-rate/starvation/flush tests pass. See
[transcript proof](../live/gpt-live-tui-rendering.md) and
[audio investigation](../live/gpt-live-crackling-investigation.md).

## Review and gate fixes

Questions merge e6242a7; unified picker cdc7723; short-ID review 8d9498a;
actual picker test 85ff530. Parent surface polish in 8247e4b. Earlier local
candidate passed 1158 tests but hosted CI/dry run failed three new PTY tests.
Linux clean checkout had no trust-requiring project resources, so the CLI
started directly while tests awaited a trust prompt. macOS lacked tmux.
Fix 6bdc616 integrated e6b5410 handles either real startup path, uses only
session-scoped trust when prompted, and installs macOS tmux. No tests skipped,
no production behavior weakened, no extra Mac web build. Corrected hosted
runs passed. Failed runs: 36234271598 and 36234271607.

An earlier local build stopped because cached upstream still had old die.patch.
Verified old patch could reverse, reversed only that patch, applied current
patch with --check; kept ignored dependencies. Gate then passed. No user files
or test assertions removed. Parent also corrected a premature no-failure
status after log annotations already showed failures.

Durable worker paths, branches and remaining limits:
[questions](../questions/implementation-handoff.md),
[picker](../live/model-picker-handoff.md),
[follow-ups](../live/follow-up-status.md).

## Wisdom and values

Feature/review/release wisdom updated. Value 8 now explicitly treats rendered
user views and actual model-facing prompts/results as core behavior, keeps
unresolved state discoverable, and rejects unnecessary subtitles/internal
metadata. User direction and repeated concrete misses justified refining that
existing value; no extra global rule. This is not a reason to hide needed
errors or expanded diagnostics. Post-release evidence commit uses [skip ci];
tested tag stays at the exact SHA above.
