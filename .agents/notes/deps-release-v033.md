# Dependency update / planned v0.3.3

User requested deps including bundled T3, then release after done. No install explicitly requested. Main owns root deps/notices/release. Existing .agents/notes/release-v030.md modification predates this task; preserve/exclude from commit.
- Root bun update --latest complete: Pi 0.85.1, lexer 3.0.2, zod 4.6.5, Biome 2.5.14, types/bun 1.4.2, transitive updates. Notices pins adjusted and generation passed.
- Worker task_5959f79d adapts lexer v3 runner API/tests; initial check failed solely on lexer changed API.
- Orchestrator task_faec9379 owns T3 pin/patch upstream update and backend/build/browser validation.
- task_5a37c235 read-only dependency audit.
- format/lint passed (existing lint warnings/infos); biome schema bumped.
- Latest published v0.3.2, branch develop. Plan v0.3.3 after validation, push branch/tag and monitor release CI, verify downloaded assets.
- /tmp near full; use TMPDIR=/var/tmp and HERDR_ENV=0 for checks. Never stop user's live servers.

Root validation: lexer v3 adapted, 21 targeted runner tests pass; full suite 637 pass /14 skip /0 fail (artifacts/deps-v033-core-tests.log). License version assertions updated; upstream Pi v0.85.1 LICENSE verified byte-identical to curated file. Frozen install, format/lint/check, notice generation pass. Package bumped 0.3.3. Pending T3 completed fresh build/tests and final integrated binary validation/release.

User additionally reports handoff(message) text invisible in terminal; include fix before release. Worker task_f5a80963 owns task/UI fix/tests and read-only web assessment. Avoid handoff for user-facing status until fixed. Final T3-integrated build and core rerun passed 637/14/0; smoke script rebuild failed only due old default .cache/die-t3code pin. Use DIE_T3_SOURCE=$PWD/.cache/die-t3code-v0042 for fresh build/smoke (or preserve old checkout and move new into default after workers done). T3 worker still investigating broader backend test failures; browser candidate passes.

Handoff terminal fix complete: src/ui/execution-previews.ts shows successful details.handoff in collapsed row with ↪, wrapped untruncated prose; errors take precedence. Tests updated in conversation-density, execute-handoff, execution-previews. Worker task_f5a80963 passed 61 targeted. Main rebuilt and full tests/check/format passed (artifacts/deps-v033-handoff-tests.log). Web equivalent gap being fixed independently by task_58c2f24b in isolated worktree; will deliver incremental patch to integrate into canonical web/t3.patch after T3 orchestrator done. Release still pending both web work pieces.

Terminal rebuilt full suite: 640 pass /14 skip /0 fail. Real PTY validation delegated task_db6d646e. Web handoff patch ready artifacts/t3-v0042-handoff-ui.patch (isolated /var/tmp/die-t3-handoff-ui), 141 focused tests + web tsc pass; NOT integrated yet pending T3 owner finishing final backend rerun/build. T3 added expectation-only fixture fixes to CLI/ProviderRegistry; environment needed T3_SERVICE_LAUNCHER_CONTEXT unset. Once T3 done: apply incremental handoff patch to .cache/die-t3code-v0042, stage changes there and regenerate canonical web/t3.patch via git diff --cached --binary HEAD; rebuild/smoke with DIE_T3_SOURCE explicit then final tests/release.

T3 worker COMPLETE: full backend 4851 pass /10 skip /0 fail, repeated browser matrix passes. Main applied incremental web handoff patch to canonical new checkout, staged apps/web/src, regenerated web/t3.patch. Final fresh smoke+core suite task_f2cbcfbc running (artifacts/deps-v033-integrated-{smoke,tests}.log). Worker task_bd85e713 final real-browser handoff once visibility + canonical focused web tests; no edits. Terminal real PTY confirmed text exactly once collapsed (artifacts/deps-v033-handoff-tui-result.json). Final format/lint/check/notices pass. GitHub authenticated; still no commit/tag/push. Preserve preexisting release-v030.md change.

FINAL integrated fresh smoke/build succeeded, full core suite 640 pass /14 skip /0 fail. All changes ready; final browser handoff worker still running. Planning commit and release tag once worker confirms.
