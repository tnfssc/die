# Native Live via plain die update — stable v0.8.0 published

Current status: **published and verified stable**. See final publication proof below.
Earlier proposal/hold notes are historical, superseded by that proof.

Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_98aeea31
Branch: die/make-native-live-release-work-with-die-u-98aeea31
Base: 5a66e7999ec43b6758cc3443bf79daace66774a2.

## Compatibility approach for parent review

Inspected current src/update.ts and exact v0.7.1 tag: no diff. Old updater only
accepts /releases/latest stable numeric versions and exact raw executable asset
names plus matching per-file .sha256. It atomically replaces ONE executable.
A prerelease flag in new code cannot help the installed binary. The published
v0.8.0-rc.1 tar and compiled 0.7.1 version cannot satisfy this path.
Read prerelease commits d778ad2/b6f6142; not integrated wholesale (their manual
candidate is intentionally isolated). Existing tags/assets must stay untouched.

Propose fresh stable v0.8.0 with package version compiled as 0.8.0 and unchanged
four raw stable asset names/checksums. Mac arm64 die embeds the native helper;
/live-lab extracts it privately on demand, with integrity/permission checks, and
keeps experimental opt-in labeling. No helper download, updater extension, or
manual user install. Other stable target updater contracts remain unchanged;
Linux native helper distribution is NOT newly promised. macOS helper must be
built on macOS, preserving dependency licenses. No device/provider acceptance
claims. Substantial packaging/security changes: HOLD publication until parent
reviews extraction, workflow gates and evidence; no tags/releases pushed here.

## Delegated pieces (all durable worktrees)

- embedded helper: branch die/embedded-native-helper-packaging-e2c7cb3e,
  worktree sibling task_98aeea31-a86675007a5e-task_e2c7cb3e.
- exact old updater fixture: branch die/old-updater-compatibility-fixture-586363f0,
  worktree sibling task_98aeea31-a86675007a5e-task_586363f0.
- release pipeline: branch die/stable-native-release-pipeline-af57607c,
  worktree sibling task_98aeea31-a86675007a5e-task_af57607c.

Pending implementation, integration tests, actual Mac no-device gates, and review.
No secrets, paid calls, physical microphone, auto-install, or publication.
Values unchanged: existing truthful-evidence and bounded-ownership values apply.

## Direction and local evidence (in progress)

Parent clarified ordinary stable release is authorized; no preview/channel process
is wanted. Parent will review integration and publish after normal checks.

- b2da22f proposal; 7ddc857 carries formatting/lint suppression from d778ad2
  for the acceptance script only (no prerelease packaging/manual-install docs).
- f5a5850 exact v0.7.1 source fixtures: 15 tests, 85 assertions pass. All four
  stable target names, network/checksum/draft/prerelease failures, competing update.
- 9b22c2d adds scripts/verify-v071-update.ts: builds pinned old updater as a real
  compiled executable in private temp dir, serves staged asset/checksum through
  fetch injection at official URLs, proves corrupt checksum leaves executable
  unchanged, then replaces itself and executes replacement --version. No install.
  Gate itself passed on Linux using a tiny compiled version-output test payload;
  actual release binary gates must still run on Linux/Mac CI.
- Existing updater/audio tests: 27 pass, 95 assertions (includes compiled self-update).
- Locked install, formatting, lint (existing warnings), typecheck pass at this stage.
- Old updater has NO executable-format validation: a tar renamed to raw binary
  with matching checksum would install. Fixture tar preflight is not an old-updater
  defense; release gate must execute actual payload before publishing.

## Integrated design and review

Worker ea08004 integrated as 3adf11d:
private per-launch mkdtemp extraction, content SHA256 before/after write,
non-executable write then chmod0700, cleanup on launch failure and process reap.
No shared cache/symlink reuse. Explicit developer helper override remains; source
and non-Mac builds retain existing helper resolution. Hard-kill/crash or cleanup
failure can leave disposable temp directories; never reused as executables.
Independent safety review task_0585c9a1 found no blocker in this threat model.
Review worktree sibling task_98aeea31-a86675007a5e-task_0585c9a1,
branch die/review-native-helper-safety-0585c9a1 (no code changes).

Coordinator integration replaces worker environment-variable build interface with
--live-lab-helper=<path>; rejects wrong target, symlinks and non-arm64/Mach-O
executable headers before web build. One bundle plugin shared by production build
and tests proves embedded payload survives source file removal in a real compiled
Bun executable. Payload test is inert Mach-O-shaped data, not a real Mac helper.
--live-lab-self-test is a device-free compiled diagnostic: embedded helper only,
--self-test then protocol hello/stop (never start), bounded child time/output,
private extraction cleaned in finally. It intentionally fails on unsupported builds.

Worker pipeline 0b9cb56 integrated then simplified: NO workflow_dispatch or preview
publication. Ordinary stable tags run native Mac tests -> Linux full normal checks,
four raw assets -> actual cross-compiled Mac binary exact-old-updater gate and
embedded helper self-test from unrelated directory/clean HOME -> publish job.
Only publish job has contents:write. Prerelease tags remain skipped. v0.8.0 package
version is compiled normally; no reused v0.7.1 candidate CLI. Native helper hash in
SOURCE; regular production and embedded web license generation retained. Swift
helper uses Apple platform frameworks, no bundled external native library.

Local evidence: format, lint (pre-existing warnings), typecheck, 88 tests / 630
assertions across 10 Live Lab/updater/release files passed, including parsed-YAML
publication dependency/permissions assertions. CI checkout fetch-depth:0 preserves
the pinned old stable tag needed by exact-source tests. ASan/UBSan
native C core test passed on Linux. Logs: artifacts/native-update (ignored).
No actual Mac binary was built/run locally; full release web/PTY matrix not run here.
Mac native compile, actual staged Linux/Mac executable gates and full release matrix
are mandatory workflow gates, NOT evidence already obtained.

## Exact remaining release steps (parent owns)

1. Review/cherry-pick this branch's commits onto intended release source; use
   git log 5a66e79..HEAD for the series. Do NOT merge isolated prerelease branch
   wholesale or move its existing tag/assets. Check version 0.8.0 is still free.
2. Run ordinary CI on reviewed source (locked install, formatting, lint, typecheck,
   deterministic compiled/web/PTY checks). Review extraction/diagnostic and workflow
   permissions. No physical mic, provider, or auto-install required or claimed.
3. Only after review/checks, create a NEW annotated stable v0.8.0 tag at exact source
   commit, push that tag. Ordinary Release workflow gates all build/upload jobs;
   gh release create publishes stable only after actual Mac smoke succeeds. On any
   failure, no release should exist: inspect logs, fix source, and use a NEW version
   if the tag is already public; do not move/overwrite public tags or release assets.
4. Verify /releases/latest returns v0.8.0, prerelease=false/draft=false, all four raw
   assets and per-file SHA256 plus LICENSE/THIRD_PARTY_NOTICES/THIRD_PARTY_LICENSES/
   SOURCE exist. Compare API metadata/digests with workflow artifacts. Existing
   updater fixture is local/offline; publication-time API availability remains to
   verify. User runs plain die update and starts a fresh die session, then explicitly
   opts into /live-lab. Do not auto-install on their behalf.

Publication remains unattempted. Physical acoustic/provider tests and signing /
notarization are not claimed. Values unchanged: no new general lesson beyond the
existing truthful-evidence, simple-design and bounded-ownership rules.

## Authorized stable release execution (2026-09-23)

User explicitly authorized normal stable v0.8.0 publication and plain die update.
Release coordinator worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_89057c53
(branch recorded by git; source head 54f24fc8c6d9aca601844e31b8629266c8a72326).
Remote develop e6f0597570881f186d625f8fcd6549e0894d7353 is an ancestor;
push must remain fast-forward, preserving all parent commits. v0.8.0 absent at preflight.
Independent review: task_394e7ce8, branch
die/independent-stable-release-packaging-rev-394e7ce8, worktree
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_89057c53-a86675007a5e-task_394e7ce8.

To honor gates-before-tag, Release now also runs on develop push, using the exact
same native helper, release matrix, and actual Mac/updater gates. Publication is
explicitly tag-only; develop produces workflow artifacts, never a GitHub release.
No prerelease workflow or user install added. Stable tag will rerun all gates.
Local locked Bun 1.4.1 install, format, lint, typecheck and focused release/updater/
Live Lab tests: 67 pass, 0 fail, 567 assertions. Logs artifacts/release-local.
Full CI and real Mac evidence pending at this point. No audio/API used, and no
local installation. Physical acoustic/provider validation and signing/notarization
remain unclaimed. Values unchanged: existing truthful-evidence and simple-design
rules cover this release; no new general lesson yet.

### First real gate result and fix

39ebe0f safely fast-forwarded develop from e6f0597. Release gate run
https://github.com/tnfssc/die/actions/runs/35909683064 passed actual Mac native
sanitizers/build/self-test/protocol, Linux format/lint/typecheck/build/deterministic
tests/smoke, then failed a portable file(1) text-match: Linux says "Mach-O 64-bit
arm64 executable", Mac says "Mach-O 64-bit executable arm64". Downloaded actual
helper artifact confirms Linux output; accept both word orders. Binary header
validation in nativeHelperPlugin remains unchanged and strict.
Independent review's macos-15 Intel concern is disproved by current upstream
runner-images README (macos-15 = arm64, Intel = macos-15-intel) and successful
actual arm64 Mac build gate. Its old-updater caveat is valid: exact pinned source
is compiled with current Bun, NOT the historic published full v0.7.1 executable.
No tag created; publication skipped as designed.

## Final publication proof — 2026-09-23

- Release: https://github.com/tnfssc/die/releases/tag/v0.8.0
- GitHub release ID: 395012775; published 2026-09-23T20:00:15Z.
- Annotated v0.8.0 tag targets c5b6101a708a7e1f560002ad95299f05b2c089dd.
- Integration: 54f24fc source, 39ebe0f pre-tag develop gates, c5b6101 portable
  file(1) correction. Develop fast-forwarded safely; no force pushes, tag moves,
  prerelease changes, or local installation.
- CI passed: https://github.com/tnfssc/die/actions/runs/35910725281
- Pre-tag full Release gates passed (publication correctly skipped):
  https://github.com/tnfssc/die/actions/runs/35910725315
- Tag/publication run all four jobs passed:
  https://github.com/tnfssc/die/actions/runs/35911787187
  Native Mac sanitizer/helper tests, Linux full build/test/web/PTY/release matrix,
  actual Mac raw executable/updater/embedded-helper smoke, then publish.
- Logs confirm Linux and Mac exact pinned v0.7.1 updater source compiled in the
  current toolchain preserves the executable on checksum failure, atomically
  replaces it with staged bytes, verifies SHA256 and compiled --version 0.8.0.
  This is NOT a test of the historic published full v0.7.1 binary.
- Mac release executable self-test + protocol v1 passed with clean HOME and
  unrelated cwd. Embedded helper SHA256:
  71092e078150d443bc0d2761813decfa76bb15ad2002e738b32c78f32f99717b.
- /releases/latest verified v0.8.0, prerelease=false, draft=false. All 12 expected
  assets nonempty: four raw binaries, four SHA256 files, LICENSE,
  THIRD_PARTY_NOTICES.md, THIRD_PARTY_LICENSES.txt, SOURCE.txt. Downloaded checksum
  files match GitHub binary digests; downloaded metadata sizes/digests match API.
  SOURCE.txt identifies exact tag/commit, T3 revision/patch and native helper hash.

| Raw asset | Bytes | SHA256 |
| --- | ---: | --- |
| die-linux-x64 | 200963552 | 51171f5bcb08db2dd2f71af49b076d37200dc9acda05ffa894135f2824c45e59 |
| die-linux-arm64 | 200853800 | d5f9fa2226c5f5669ef66ed385c12d1baa440e3e7df81cf2b5581337f179756c |
| die-darwin-arm64 | 182979170 | 65fc54c386072e1f85aec0a8920bdf2307a9f33d5e8a00064b43a54768418beb |
| die-android-arm64 | 208074496 | 5f07d798adc61e6a92161ac16ec082fbabcc07ff0afb620bdb42cc1ba778b58b |

Update: run plain die update, then die --version (0.8.0) and start a fresh die
session. Mac arm64 helper is embedded, no separate installation. Optional
die --live-lab-self-test uses no devices; explicitly opt into /live-lab only
when ready. /live-lab remains experimental voice-only, separate from /live.

Physical microphone/speaker behavior, acoustic echo quality, interruption latency,
real provider sessions, signing/notarization remain **not validated**. No real
audio, secrets, paid provider calls, or user-local installation were used here.
Linux/Android bundled native helper support is not promised. Values unchanged:
truthful evidence, bounded ownership and simple design already cover this work.

Final artifact comparison: downloaded stable-release-assets from publication run
35911787187 (artifact ID 10773643997, ZIP metadata digest
84db531a8a017cfaecd9e072c28fa0a9fbd1dc754786b11e3a0a56f19f975c54).
All 12 extracted file sizes and locally calculated SHA256 hashes exactly match
published release API assets. Downloaded metadata/checksums verified separately.
Local evidence: artifacts/release-local/{latest.json,publication-run.json,
publication.log,published-artifacts.json,verification.txt,published,workflow-assets}.
Artifacts are ignored and workflow retention is finite; durable proof is this
note, release assets and linked workflow runs. No published binary installed locally.
