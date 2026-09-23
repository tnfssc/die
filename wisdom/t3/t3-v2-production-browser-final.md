# T3 v2 NON-ADOPTED production browser final evidence

Date: 2026-09-21 (UTC)

## Disposition

**PASS for the exported NON-ADOPTED candidate. The canonical source was not adopted.**

Canonical `web/t3.patch` and `web/t3-source.json` were not edited. The candidate remains isolated in `.cache/die-t3code-v2-production`, `.agents/patches/t3-v2-production-candidate.patch`, and `dist/die-t3-v2-candidate` pending coordinator disposition.

## Final exact inputs and outputs

- Upstream repository: `https://github.com/pingdotgg/t3code.git`
- Immutable candidate HEAD: `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`
- Candidate patch SHA-256: `17c685873864630a1d514b4c7de61d32059aea2639a4c4294d8d190773d71cf9`
- Final executable: `dist/die-t3-v2-candidate`
- Final executable SHA-256: `f666b829d2a6b8070f20b2c7ca8561f9a1b1a029b92a5ac98b807cafb49f5c46`
- Packed web archive SHA-256: `af8450e434d3d42d8a46dbf3cdccf918c376dbea235b137aa03ded2557be441e`
- Candidate worktree SHA-256 recorded before and after final acceptance: `891cc63876ec28741a70d30c31d72f565bd3c2fc9a796bb19f398d0fc62fa7c9`
- Build manifest: `dist/t3-v2-candidate-build.json`, with `adopted:false` and `typecheckVerified:true`.
- Export manifest: `.agents/patches/t3-v2-production-export.json`, with `cleanApplyVerified:true`.

The final command was the required non-skipping build:

`T3_V2_BUILD_CANDIDATE=1 TMPDIR=/var/tmp bun scripts/t3-v2-production/build-candidate.ts`

It completed successfully after a fresh export. Its full 15-package workspace typecheck passed, then the web frontend, T3 server bundle, deploy, web archive, Die assets, and standalone executable all built successfully. Earlier explicitly marked initial browser builds used the new `T3_V2_SKIP_CANDIDATE_TYPECHECK=1` escape hatch while source workers were still editing. The final manifest proves that escape hatch was not used for the evidenced artifact.

## Actual same-server browser acceptance

Final command used the exact manifest HEAD and binary digest with `T3_V2_ACCEPT_CANDIDATE=1`. It exited 0 against a fresh, unseeded temporary HOME/state and a deterministic loopback OpenAI-compatible model fixture.

Machine proof: `artifacts/t3-v2-production-browser/proof.json`

Proof SHA-256: `3649c7e42a6da753438f8ed9a1662b376f2bfdd6052a181b6ed6984b35875cbd`

The final live server origin was `http://127.0.0.1:41903`. The browser created the parent and both children on that one origin and one backend process tree. The proof records `sameLiveServer:true`.

Observed deterministic model route sequence, each exactly once:

1. `launch-complete`
2. `complete-armed`
3. `complete-child`
4. `complete-child-finished`
5. `parent-inspect`
6. `parent-wake`
7. `launch-stop`
8. `stop-armed`
9. `stop-child`
10. `stop-parent-inspect`
11. `stop-parent-observed`

Acceptance demonstrated:

- a native orchestrator child spawned asynchronously with documented `waitSeconds:0`;
- the rendered lineage relationship was used to open that exact child while its delayed execute tool was still running;
- the completed child produced `T3V2_COMPLETE_CHILD_DONE`;
- the native terminal notification was followed through the documented `jobs.inspect(id)` path;
- completion woke the parent exactly once and rendered `T3V2_PARENT_WAKE_OBSERVED`;
- a second native child was spawned and opened while running;
- the child was stopped from its real browser `Stop generation` control;
- the forbidden delayed completion marker never appeared;
- cancellation was observed through the parent notification/inspect cycle;
- reloading the stopped child's direct URL preserved the exact delegated-child pathname, transcript, and visible `Run interrupted` state.

Screenshots:

- `artifacts/t3-v2-production-browser/complete-child-running.png`, SHA-256 `c0c97f15be4f1be73f2187774f4495771303abf609639dbd33dfc0e564df107e`
- `artifacts/t3-v2-production-browser/stopped-child-refreshed.png`, SHA-256 `823f4b45fdf8c37197952afb039ca742e9dfe0f3e1c2cec5efc48f3559210c83`

## Packaging and isolation evidence

The harness copied only the standalone executable into an owned runtime directory and launched it there. The backend/provider PATH deliberately contained ordinary OS tools but no `node`, `bun`, `npm`, `pnpm`, or `npx`. The proof records `relocatedOnlyExecutable:true` and `externalJavascriptRuntimesOnPath:false`.

The deterministic model rejected any model payload containing T3 MCP URL/token/bearer context. Browser evidence URLs were checked for authentication query/fragment material. Logs written on failures were redacted.

All backend and Chromium process identities recorded by PID plus Linux start time were gone after teardown. The final temporary directory `/var/tmp/die-t3-v2-production-browser-ktZIHJ` was removed. No install, user profile, live state, or non-loopback service was used.

## Production issues found and fixed during acceptance

1. **Composer selector drift:** the real desktop action is named `Submit message`, not `Send message`. The harness now targets the visible submit action inside the composer surface.
2. **Native launch contract:** scoped native subagents reject `timeoutSeconds`. The harness uses documented async `waitSeconds:0` and explicit browser/jobs cancellation.
3. **Packaged Die misclassified as old Pi:** Die reports its own release version (then `0.4.0`), while Pi provider probing enforced Pi's `0.80.5` package floor. `PiProvider` now bypasses only that package-version comparison when the operator-owned `DIE_WEB_DIE_BINARY` exactly equals the configured provider binary. Ordinary Pi binaries still require the floor. This was necessary to remove a real `provider_unavailable` rejection and is constrained to the trusted packaged runtime identity.
4. **Relationship navigation:** the harness now opens the actual thread-details lineage surface, chooses the unique live relationship, and tolerates truncated presentation titles without weakening the live-status requirement.
5. **Native completion protocol:** terminal notifications require an explicit `jobs.inspect(id)`. The deterministic fixture now exercises that documented path for both completion and cancellation instead of assuming result text is pushed directly.
6. **Delegated-child reload regression:** child threads are omitted from sidebar shells, so `ThreadRouteView` incorrectly treated a direct delegated-child route as missing on bootstrap and redirected to the parent/default thread. Delegated-child routes now remain mounted long enough for `ChatView` to hydrate the detail projection. The final browser proof verifies the stopped child route and transcript after a real reload.
7. **UI terminal wording:** acceptance recognizes the production wording `Run interrupted` / `Run interrupted by user` in addition to stopped/cancelled variants.

## Race history and finality

Several early export/build attempts correctly failed exact-source verification while concurrent candidate workers edited source. Per instruction, exports were refreshed and retried. No verification was weakened. Intermediate typechecks also exposed transient worker edits and were not claimed as final. The final export clean-applied, the final full workspace typecheck/build passed, and the final browser run confirmed the exact final executable digest and unchanged candidate worktree hash.

The final browser artifacts supersede all earlier failure captures in the same artifact directory. The candidate is validated but remains **NON-ADOPTED**.

Post-proof exact-source recheck: canonical `verifyWebSource` reported `CURRENT_SOURCE_EQUALS_FINAL_PATCH`. Both root and candidate `git diff --check` passed. Root production source mtimes predate the final 08:26Z compile.
