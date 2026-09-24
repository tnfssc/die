# Realtime original-Upgrade diagnostics / v0.10.2

Read [values](../values.md), [prior diagnostics](openai-realtime-connect-diagnostics.md), and [offline evidence](../../evidence/realtime-upgrade-transport.md). The remote cause of the user's connect_failed with gpt-realtime-2.1 is UNKNOWN; successful GPT-Live with the same key does not prove Realtime access. This patch provides actionable handshake diagnostics, not a proven connection fix.

Only the OpenAI Realtime default socket changes to ws. It observes the original authenticated Upgrade, reads at most 4096 bytes for at most one second, destroys rejected responses, and reports only numeric HTTP status plus existing allowlisted codes. No key lookup, extra probe, retry, fallback model, raw URL/header/body/error logging, or change to GPT-Live/Gemini/Mac audio. Session rejection stays distinct from handshake failure.

## Dependency and review

Do not reuse the original 8.18.3 pin: official npm registry security bulk response flags GHSA-58qx-3vcg-4xpx (memory disclosure, <8.20.1) and GHSA-96hv-2xvq-fx4p (memory exhaustion, <8.21.0). Pinned current stable 8.21.3 has an empty advisory response; see [captured registry results](../../evidence/realtime-ws-registry-security.json). Gemini's existing resolved version was already 8.21.3, so its code and dependency version are unchanged.

Independent review of 51b009b, c63455a, 1258aa9 found no correctness/security defect; release gate caught and fixed one formatting error. Added stalled partial-response cleanup regression. 33 focused tests and compiled provider loopback smoke pass with pinned 8.21.3; format/lint/diff pass. Earlier full CLI/typecheck proof remains in evidence; final full gates run once via develop Release dry run and staged assets are reused for tag publication. No paid API, key/device access, binary installation or redundant local full matrix.

## Resume / release

Release worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_cbad3b1c; branch die/review-and-release-realtime-handshake-di-cbad3b1c. Independent review worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_cbad3b1c-a86675007a5e-task_0ce348e6; branch die/review-realtime-transport-security-and-c-0ce348e6 (no edits).

Next stable version 0.10.2. Preserve remote develop by ordinary fast-forward push only, then await successful exact-SHA develop dry run before immutable annotated tag. Verify latest release, all 12 assets, updater/native gates. Do not download released binaries merely to rehash or install locally. [Release notes](../../support/release-v0.10.2.md) contain the exact same-model retry instructions.

Values reviewed and unchanged: existing privacy, bounded resources, truthful unknowns, immutable/user-work safety and real-path proof cover this work; no new general lesson warrants another value.
