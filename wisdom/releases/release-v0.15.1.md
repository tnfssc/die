# v0.15.1 released

Published https://github.com/tnfssc/die/releases/tag/v0.15.1.
Tested tag: 6f15b7d73e5793e07feced2e4bb5427ca4a893f2.
User requested release of GPT-Live input cleanup.

## Scope

Implementation 493755b removes snapshot JSON and clarification boilerplate
from delegated user turns. Visible turn is spoken words. Coding model gets
new speech with a short provisional-transcription fact; prior handled speech
is not reissued. Bounded transport/provenance stays internal. Legacy model
replay cleaned without rewriting original disk history. Public scope/limits:
[support notes](../../support/release-v0.15.1.md).

Actual serialized model requests and real terminal evidence:
[clean input proof](../live/clean-gpt-model-input-evidence.md).
No connected provider, device, ASR-quality or model-reasoning acceptance.
No local installation. Existing values cover clean surfaces and honest facts.

## Proof

- Full local candidate gate passed: 1175 tests, 17 opt-in skips, zero failures;
  28104 assertions across 164 files. Fresh CLI/web build, web suites,
  format/lint/typecheck and standalone smoke passed. Log
  artifacts/clean-input-release-ci.log. Bun 1.4.2, Node 24.21.0,
  pnpm 11.27.1, SHELL=/bin/sh.
- Later change was test-only full-frame capture polling, no production change.
  Parent reran typecheck and actual PTY tests, 4/4 pass. Worker repeated PTY
  four times and ran source Live lane: 272 passed, 3 opt-in skips, zero fails.
- Exact-SHA Linux/macOS CI passed:
  https://github.com/tnfssc/die/actions/runs/36238805685
- Exact-SHA release dry run passed:
  https://github.com/tnfssc/die/actions/runs/36238805756
- Tag publication passed:
  https://github.com/tnfssc/die/actions/runs/36239395759
- GitHub latest is v0.15.1, non-draft, non-prerelease. All 12 expected assets
  exist and are nonempty. [Metadata](v0.15.1-publication.json).
  No unnecessary published-binary downloads or repeated hash checks.

## Hosted correction

First candidate 919fb9a had full local pass and release dry-run pass, but Mac
CI 36238139467 caught partial picker output. At 80 columns the capture stopped
as soon as gpt-live-1 appeared, before its readiness label/footer finished.
Test-only fix 1630ab4 integrated 6f15b7d waits for all expected content in one
frame. No assertions removed, no timeout extension or production workaround.
Corrected hosted Mac tests pass. [Frame lesson](../live/pty-frame-readiness.md).

Fix worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_35f43410;
branch die/fix-partial-terminal-capture-race-on-mac-35f43410.
Implementation and other durable paths:
[input handoff](../live/gpt-live-input-cleanup-handoff.md),
[implementation work](../live/clean-agent-input-work.md).

## Wisdom and values

Feature/input audit, before/after evidence, frame-readiness lesson and release
notes updated. Values reviewed after release; unchanged. Existing rendered
user/agent surface, whole-path proof and honest-evidence values apply. This
corrects a missed delegation path, not grounds for another blanket warning.
Post-release evidence commit uses [skip ci]; tested tag remains exact SHA.
