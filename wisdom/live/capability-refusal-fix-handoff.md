# Ground Live capability claims in tools

## Why

On Sep 25, Live denied internet access and refused repeated explicit requests
to delegate Hyderabad weather without attempting a tool. A later worker fetched
wttr.in successfully. The earlier session showed the same mismatch for shell
access. See capability-denials-2026-09-25.md and its probe notes.

## Change

Shared src/prompts/execute.md now tells the agent to use tools for authorized
noncoding work too, test uncertain access, treat old assistant denials as claims
rather than limits, and honor clear delegation requests without needless questions.
The execute description names shell/subagent globals and says no die import is
needed. Access still depends on actual environment/results; no permissions changed.
This reaches the real main-owner Live path, not just the bypassed fallback prompt.
Tests assert the guidance in production-assembled Live instructions and tool schema.
No second executor or provider-specific prompt layer added.

## Checks and evidence

Parent integrated the four-file candidate into the main workspace. Source-CLI run:
DIE_PROBE_EXECUTABLE="$PWD/tests/fixtures/live-execute-cli.sh" bun test
 tests/live-main-integration.test.ts tests/prompts.test.ts tests/prompt-preview.test.ts
29 pass, 283 assertions. bun run check and git diff --check passed.

User explicitly authorized direct Gemini probes. Synthetic inputs only, no private
session replay or audio hardware. Model: gemini-3.8-live.
Initial shortened-frame study: weather refusal recovery used execute 0/3 baseline,
2/3 candidate. Both frames selected tools for two other scenarios. Intercepted calls,
no code execution. artifacts/live-gemini-denial-recovery/findings.md has details.

Follow-up worker stalled and was stopped. Its exact-source builder omitted normal
extension framing; do not call those two baseline refusals deployed-frame proof.
Parent used createPromptPreview from each checkout instead, with isolated project
context and cwd replaced by /synthetic-project. No saved history, private guidance,
custom hooks, or audio. Frames: assembled-frames.json in the same artifact directory.
The first multi-session harness timed out after saving one baseline spoken refusal
(no calls); turnComplete was false. A candidate attempt then hit a harness parser
error because TypeScript 7 lacked the expected compiler API. That attempt is not
a valid behavioral result. Parent replaced syntax checking with Bun.Transpiler.
The final bounded single-session candidate trial completed: one execute call with
valid JS and awaited subagent weather request, no refusal. It did not log the
helper return. Calls stayed intercepted: no worker launched or weather fetched.
Evidence: single-candidate.json, probe-single.ts, run-single.log. Commands:
bun artifacts/live-gemini-denial-recovery/probe-single.ts
The saved assembled baseline/candidate frames predate local integration.

This is limited evidence of better tool choice, not a reliable rate estimate or a
claim that spoken refusals are solved. Fresh live voice acceptance remains needed.
Installed CLI was not rebuilt or installed by this change. Rebuild/install and
restart Die before checking the new guidance in the app.

## Ownership

Original candidate worktree remains:
/Users/sharath/.die/worktrees/die-f528e86af6b5-task_d3229e5e
Branch: die/fix-live-unsupported-capability-refusals-d3229e5e; base 79f517e.
Worker stopped; parent applied its uncommitted diff and owns integrated changes.
Probe workers also finished or were stopped. No ongoing provider probe intended.

Values unchanged: show real state, verify the real path, and respect current
permissions already cover this lesson. Local prompt wiring and probe limits belong
here, not in a new value.
