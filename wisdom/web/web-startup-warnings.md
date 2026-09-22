# Web startup warnings investigation (2026-09-22)

User pasted macOS die web --port 13773 warnings: background Git fetch timeouts and title generation failure with nested Cause hidden as [Object ...]. Research only; no product changes requested/applied. User runtime version/hash not mapped; source findings are current pin b488c57f3f9f1688e31c53daee99e29dd1d0baa2 plus Die patch, not proof of Mac environment root cause.

Inspected persistent source /home/tnfssc/.die/worktrees/die-a86675007a5e-task_49d9fc83/.cache/t3-preview-final-source (HEAD matches pin). Parent .cache/die-t3code is older; do not use it for current-source conclusions.

GitVcsDriverCore.ts:63 timeout is 5 seconds; :79 environment disables GCM/Git/SSH askpass/terminal prompts. :1124 fetches current upstream remote using --git-dir <common-dir> fetch --quiet --no-tags <remote>. :944 timeout creates generic GitCommandError and discards partial stderr. :1329-1385 failed refresh is cached, failure cooldown exponential starting 30 seconds capped at 15 minutes, shared by common-dir/remote across worktrees; error swallowed and existing refs used. :1950-1971 status still reads local cached refs. No merge/reset or working file edits. This can fail on a working but >5s remote; cannot infer credential/network root cause from timeout alone.

ThreadTitleRegenerationService.ts:104 uses project-resolved textGenerationModelSelection, :118 initial generation retries twice with exponential 2s delay; :122 catches non-interrupt failure, logs nested cause (:125) and completes without new title. Worker task_fe710234 researches provider/diagnostic detail (shared workspace, read-only).

Validation: attempted 2 focused Git tests (backoff/logging across worktrees; noninteractive env). First pnpm launch failed in local pnpm deps-status check. Direct vp launch failed before tests due ENOSPC in temporary cache. Retrying direct vp with TMPDIR=/var/tmp, task_824e2a1d. No claim of test success yet.

Next diagnostics on user's Mac: die --version; identify branch upstream remote with git config --get branch.<branch>.remote, then time equivalent noninteractive fetch against that remote (not assume origin). Ordinary git fetch is less equivalent because it allows credential prompts and no 5s deadline. Need provider/model selection and readable underlying title error to establish title root cause. Never request credential/auth file contents.

Git validation finished: TMPDIR=/var/tmp direct vp run passed both selected tests (2 pass, 97 skipped), task_824e2a1d. Initial ENOSPC was local temp cache, not evidence about user Mac.

Title service test suite passed: 15/15, task_ff2279a0, same TMPDIR workaround. Total focused checks: 17 pass. Current contracts/settings.ts:1255 defaults separate text-generation selection to codex / gpt-5.6-luna / low (settings.test.ts:731); no matching Die patch override. Existing user/project settings can differ. Do not claim this was the failing user model.

Closed research: stopped title worker task_fe710234 after 10-minute checkpoint; it was continuing broad read-only tracing (including historical a9b49 cache), no final integrated report and no product edits. Parent current-pin findings + 17 passing focused tests above are authoritative. No jobs/fixes/releases remain underway. Await user Mac version, timed fetch and text-generation model selection before further root-cause work.
