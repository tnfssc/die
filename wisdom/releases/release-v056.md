# v0.5.6 empty homepage cost fix

The user asked for a push and release instead of a PR. Starting HEAD 9628eaf on develop, clean. Latest release 0.5.5. Fix 3591aa2 hides native cost summary when both own/subtree turn counts are zero; four focused tests plus web/root typechecks and exact source verification passed.

Release plan: version 0.5.6, wisdom/releases/release-v0.5.6.md, include focused UI test in release workflow web tests. Run local checks, push `develop` and the tag, and watch CI with explicit Bash because the default shell is Fish. Check the publication and assets, then set the release notes. Do not download binaries automatically or install locally.

Pushed release commit fdfbbaf360086e385d644f2b76c36626dcc0fefe and signed tag v0.5.6. Local format/lint (warnings only), typecheck/tag/diff checks pass. Release workflow 35720633622, CI 35720629554. Explicit-bash watcher jobs task_39c4bc25 and task_e90dfa66 launched; log paths /var/tmp/die-v056-{release,ci}-watch.log. On success verify publication/assets, set docs release notes, and record result.

## Published
Release workflow https://github.com/tnfssc/die/actions/runs/35720633622 and CI https://github.com/tnfssc/die/actions/runs/35720629554 both SUCCESS. Published https://github.com/tnfssc/die/releases/tag/v0.5.6 at 2026-09-22T11:27:35Z; draft=false, prerelease=false. Confirmed all 12 expected assets (four platform binaries/checksums and four license/source documents), set notes from wisdom/releases/release-v0.5.6.md. No automatic binary download or local install. No release blocker remains.
