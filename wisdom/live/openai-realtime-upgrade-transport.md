> Follow-up: [production transport investigation](realtime-production-transport-investigation.md) found that v0.10.2's extension discarded these safe messages and still displayed only Provider connect_failed. Adapter test success did not prove terminal diagnostics.

# Realtime original-Upgrade diagnostics / v0.10.2

Read [values](../values.md), [prior diagnostics](openai-realtime-connect-diagnostics.md), and [offline evidence](realtime-upgrade-transport.md). The remote cause of the user's connect_failed with gpt-realtime-2.1 is UNKNOWN; successful GPT-Live with the same key does not prove Realtime access. This patch provides actionable handshake diagnostics, not a proven connection fix.

Only the OpenAI Realtime default socket changes to ws. It observes the original authenticated Upgrade, reads at most 4096 bytes for at most one second, destroys rejected responses, and reports only numeric HTTP status plus existing allowlisted codes. No key lookup, extra probe, retry, fallback model, raw URL/header/body/error logging, or change to GPT-Live/Gemini/Mac audio. Session rejection stays distinct from handshake failure.

## Dependency and review

Do not reuse the original 8.18.3 pin: official npm registry security bulk response flags GHSA-58qx-3vcg-4xpx (memory disclosure, <8.20.1) and GHSA-96hv-2xvq-fx4p (memory exhaustion, <8.21.0). Pinned current stable 8.21.3 has an empty advisory response; see [captured registry results](realtime-ws-registry-security.json). Gemini's existing resolved version was already 8.21.3, so its code and dependency version are unchanged.

Independent review of 51b009b, c63455a, 1258aa9 found no correctness/security defect; release gate caught and fixed one formatting error. Added stalled partial-response cleanup regression. 33 focused tests and compiled provider loopback smoke pass with pinned 8.21.3; format/lint/diff pass. Earlier full CLI/typecheck proof remains in evidence; final full gates run once via develop Release dry run and staged assets are reused for tag publication. No paid API, key/device access, binary installation or redundant local full matrix.

## Resume / release

Release worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_cbad3b1c; branch die/review-and-release-realtime-handshake-di-cbad3b1c. Independent review worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_cbad3b1c-a86675007a5e-task_0ce348e6; branch die/review-realtime-transport-security-and-c-0ce348e6 (no edits).

Next stable version 0.10.2. Preserve remote develop by ordinary fast-forward push only, then await successful exact-SHA develop dry run before immutable annotated tag. Verify latest release, all 12 assets, updater/native gates. Do not download released binaries merely to rehash or install locally. [Release notes](../../support/release-v0.10.2.md) contain the exact same-model retry instructions.

Values reviewed and unchanged: existing privacy, bounded resources, truthful unknowns, immutable/user-work safety and real-path proof cover this work; no new general lesson warrants another value.

## Published

[v0.10.2](https://github.com/tnfssc/die/releases/tag/v0.10.2) published 2026-09-24T13:20:04Z, verified Latest, not draft/prerelease. Annotated immutable tag targets 39a2aeb062f95a77276a1920725f8d6d005e481b. [CI](https://github.com/tnfssc/die/actions/runs/36003473642), [develop dry run](https://github.com/tnfssc/die/actions/runs/36003473539), and [publication](https://github.com/tnfssc/die/actions/runs/36004652180) succeeded. Tag workflow reused exact-SHA staged assets; duplicate full matrix was skipped as designed.

Release gates: 1009 deterministic tests passed, 17 skipped, zero failed; format/lint/typecheck/compiled standalone smoke, four release builds, web backend 67/cache 135/terminal recovery 38 tests passed. Actual Linux and Mac payloads passed checksum-failure preservation and replacement SHA256/version 0.10.2 through pinned v0.7.1 updater source compiled with the current toolchain (not the historical full executable). Mac helper ASan/UBSan, device-free self-test and protocol v1 passed. Tag workflow rechecked staged checksums/source identity and Mac updater/helper before publishing.

[Release metadata evidence](realtime-v0.10.2-publication.json) confirms all 12 expected assets uploaded/nonempty. Release notes accurately state unknown remote cause and same-model retry; no paid call, physical device use, redundant released-binary download or local install. Remote develop was preserved via fast-forward; no force push, old tag rewrite, or GPT-Live/Gemini/Mac code change. Publication evidence is a documentation-only follow-up.

User retry: `die update`, restart die, `/live provider openai`, `/live model gpt-realtime-2.1`, `/live status`, `/live start`. Keep the same saved key and report only the new sanitized error plus model. Normal API billing may apply. Actual remote cause remains UNKNOWN until that retry supplies evidence.

Values reviewed after release and unchanged: existing truthful proof, security/privacy, bounded use and immutable-history principles suffice.
