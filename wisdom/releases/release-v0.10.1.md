# Stable OpenAI voice release v0.10.1

Continues [v0.10.0 preparation](release-v0.10.0.md), same branch/worktree and reviewed feature. v0.10.0 tag a925a22 is preserved but unpublished: Release run https://github.com/tnfssc/die/actions/runs/35998994804 stopped at lint, before publication. Two noSwitchDeclarations errors in src/live/openai-session.ts required braces around transcription.completed and response.created case-local declarations. Narrow scope-only fix; no protocol change. All other reported lint diagnostics were nonblocking warnings/info. Mac native sanitizer/helper gates passed that attempt.

Fix verification: 28 Realtime tests passed (141 assertions), typecheck, error-level lint, full format, diff check and v0.10.1 tag/version validation passed. Paid acceptance remained skipped. New normal patch version avoids overwriting/deleting the failed tag; no bypass of publication gates. Release notes retain exact models, persisted choice/Gemini default, canonical API-key setup and honest GPT-Live RMS/stale-tail/device/API limitations. Values unchanged: preserve immutable release evidence and fix the actual blocker, not disable the gate.

Publication evidence to follow.
