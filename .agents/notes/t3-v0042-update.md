# T3 Code stable update (2026-09-18)

- Scope: web/t3-source.json, web/t3.patch, necessary web integration compatibility. Root package.json/bun.lock/notices are coordinated by main dependency-update agent. Existing release-v030.md untouched.
- GitHub releases/latest reports stable v0.0.42, published 2026-09-16T04:59:02Z, target 719a76ca1dbf5490f1aa33ffb9966301e02be9a9. Previous pin: 6f00d3881a197dd33c2cb43c6a11a9e759e56089.
- Rebase work isolated at .cache/die-t3code-v0042; previous patched checkout retained. No commits, installation, or release actions.
- Validation must use TMPDIR=/var/tmp: shared /tmp currently 94% full. Browser tests use private HOME, random non-13773 loopback ports and fake provider only.

## Results
Pending rebase/build/backend and feasible browser smoke validation.

- Initial root web integration tests: 21 pass / 0 fail (56 assertions), artifacts/t3-v0042-root-web-tests.log. Executable relocation test at this stage exercised the preexisting dist executable, not the forthcoming v0.0.42 candidate.

## Rebase
- Verified v0.0.42 tag SHA against remote; all 50 patch files retained. Canonical regenerated patch reorders new-file blocks and uses full index hashes. Normalizing hashes/hunk positions leaves only serverRuntimeStartup.ts (upstream context) and ChatComposer.tsx changed.
- One conflict: ChatComposer retains Die selector/conditional branch and new upstream data-composer-shortcut="composer.mode" on ordinary runtime-mode control.
- Worker reports full workspace typecheck and 365 targeted server/web/contracts/shared tests passed; clean reset/apply roundtrip and exact regenerated patch comparison passed. SHA256 c29170899a22f272012f14a9544014baf5dce835b55f69bca121c7dfc7643853.
- Full build running via TMPDIR=/var/tmp DIE_T3_SOURCE=$PWD/.cache/die-t3code-v0042 bun scripts/build.ts --outfile=artifacts/die-t3-v0042; log artifacts/t3-v0042-build.log. Full backend suite delegated independently.

## Build and browser results
- Full production web/backend build, archive packing, and standalone compilation PASSED. Candidate artifacts/die-t3-v0042 SHA256 47cdae48df36a881d3d468375e86a2b305a23edee74b75d8ee7fefccffe6e8e5. Archive SHA256 22aaabf14d7c188821744846ccac89c96c13bfb372e0431c55c76eff152abea4. SOURCE.txt matches new revision and patch hash.
- Build warnings: upstream Effect diagnostic suggestions, 9 deprecated transitive packages and peer-dependency warnings; no build/type errors.
- Current candidate real Chromium browser smokes all PASSED: chat/execute/background subagent plus integrated native terminal (4 fake-provider requests), model A→B→A (2), fast→normal→orchestrator mode (5), Stop held model stream and background tool. Logs artifacts/t3-v0042-browser-{terminal,model,mode,stop}.log. Model/mode tests include local no-auth HTTP/WS checks and hostile-origin denial.
- Relocated executable-only web --help PASSED with private HOME/TMPDIR and PATH=/nonexistent; artifacts/t3-v0042-relocated-help.log. No user server/session touched, installed executable unchanged.
- Tag version caveat: upstream v0.0.42 commit still declares apps/server/package.json version 0.0.40. This is upstream metadata, not a stale checkout; kept unchanged. Report release tag/commit as canonical bundled version.
- No integration compatibility edits outside pin/patch were required.

## Full backend first run / diagnosis
- TMPDIR=/var/tmp pnpm --filter t3 test -- --maxWorkers=2: 334 passed/3 failed/2 skipped files; 4,839 passed/12 failed/10 skipped tests, 378.84s. Log artifacts/t3-v0042-backend-tests.log.
- Nine failures were old test expectations not accounting for local patch additions (dieWebNoAuth false and Pi registration). Updating these tests only, not runtime behavior.
- Three ServerEnvironment failures were inherited T3_SERVICE_LAUNCHER_CONTEXT from hosting environment (childVersion 0.0.41-nightly.20260912.1612 vs upstream package 0.0.40). Unsetting this variable passes all 7 tests; artifacts/t3-v0042-environment-clean-rerun.log. Not an upstream defect.
- Additional focused backend: 178 tests/14 files passed; changed startup integration 3 passed; actual Bun1.4.1 PTY8 passed. Logs artifacts/t3-v0042-{patch-tests,patch-integration,bun-pty-tests}.log.

## Final test-fixture correction
- Added dieWebNoAuth:false to seven CLI config expected fixtures and Pi provider/probe entries to ProviderRegistry expected lists. Both corrected suites pass: 65 tests. No production changes. Patch now covers 52 files; final patch SHA256 d6185d7eb2cc3635c17082dc4924806564fcbf281721319bd8451a00e551ac25.
- Final clean-environment full backend rerun and build started; logs artifacts/t3-v0042-backend-final.log and artifacts/t3-v0042-build-final.log.
- Local rebuilds must set DIE_T3_SOURCE=$PWD/.cache/die-t3code-v0042; old default .cache/die-t3code intentionally retained at previous pin. Fresh checkouts automatically fetch correct new pin.

## Final candidate validation
- Final full build PASSED; artifacts/die-t3-v0042 SHA256 85d24002effc0db476a76b59b7cf44763cf516ba9330d01ab301803270f490a2. SOURCE.txt contains final patch SHA256 d6185d7eb2cc3635c17082dc4924806564fcbf281721319bd8451a00e551ac25.
- All four browser suites repeated on this exact final candidate and PASSED (chat/subagent/native terminal, model/security, mode, Stop); artifacts/t3-v0042-browser-{terminal,model,mode,stop}-final.log. Executable-only PATH=/nonexistent relocation also repeated and PASSED, artifacts/t3-v0042-relocated-help-final.log. The Stop harness labels itself "installed" but explicitly used the private artifacts candidate, not an installed binary.
- Final patch applies and reverse-checks on a fresh upstream archive; artifacts/t3-v0042-patch-final.log. Root and patched-source diff-check passed.

## Final backend result — PASS
- From .cache/die-t3code-v0042/apps/server: env -u T3_SERVICE_LAUNCHER_CONTEXT TMPDIR=/var/tmp ./node_modules/.bin/vp test run --maxWorkers=2
- 337 passed / 2 skipped files; **4,851 passed / 10 skipped / 0 failed tests** (4,861 total), 394.17s. Log artifacts/t3-v0042-backend-final.log.
- No remaining integration blocker. Build warnings and upstream server package version metadata caveat noted above. Linux x64 + Chromium tested, not other OS/architectures/real paid providers/remote SSH. No commits, installed-runtime changes, or release actions.
- Final owned tracked changes: web/t3-source.json, web/t3.patch, this note only. Other modified files belong to main/concurrent workers.
