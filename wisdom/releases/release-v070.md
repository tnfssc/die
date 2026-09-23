# v0.7.0 release preparation

## Ownership and remote facts

User requested release now. Parent owns integrating these commits, pushing develop, tagging, publication, and watching CI. This worktree does not push, tag, publish, or install a local binary.

- Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5b29bf6c
- Branch: die/prepare-and-publish-live-feature-release-5b29bf6c
- Base: 5682f88bd1aa686e661e31c36512e21e1df6ec81 (Live and consent-first onboarding integrated).
- gh repo view confirmed tnfssc/die default branch develop. gh release view confirmed latest v0.6.0, published 2026-09-23T08:21:31Z, neither draft nor prerelease.
- git ls-remote confirmed remote develop at b0fdd55dfee0c2de59f19facaa0eec7119b15196. v0.6.0 annotated tag object is 9d822c636e78ae88c9e160e2aaac110c31d77fd1, peeled commit 33698a4dad9fd82ab24200e243e21dabfaeb6858. No v0.7.x tag; gh matching-refs endpoint also returned []. SSH transport printed a local key warning and failed one query; gh and the subsequent git query succeeded. Recheck remote before publishing.
- Choose 0.7.0: new opt-in user feature, not a patch-only change. package.json owns version; lockfile unchanged after frozen install. Notes follow wisdom/releases/release-v0.6.0.md convention in release-v0.7.0.md.
- Preparation commit e4dd77b also fixes the one whole-repo formatter blocker in the skipped Live acceptance test; no behavior change.

## Local environment and gates

Use bash wrappers: shell starts fish here. Prefix PATH with /home/tnfssc/.local/share/mise/installs/bun/1.4.1/bin and /home/tnfssc/.local/share/mise/installs/node/24.15.0/bin. Bun 1.4.1, Node 24.15.0, pnpm 11.10.0. CI uses Node 24.13.1. No mise trust change was needed.

Build used existing pinned source checkout via DIE_T3_SOURCE=/home/tnfssc/Code/die/.cache/die-t3code-b488c57f3f9f1688e31c53daee99e29dd1d0baa2. Build verifies revision and patch, installs frozen dependencies, typechecks patched backend, builds web client/server, deploys portable dependencies, and embeds archive in compiled CLI.

Passed:

- bun install --frozen-lockfile (131 packages; no lockfile change).
- bun run format:check, bun run check, bun run lint (exit 0; lint reports 281 warnings and 485 infos, no errors).
- bun scripts/validate-release-tag.ts v0.7.0.
- bun run build (full web build, not reuse-web).
- Compiled standalone smoke: copy dist/die to temporary directory; env -i HOME=<temporary>/home PATH=/nonexistent; --version equals 0.7.0; --help contains die header; .die exists, .pi does not. Same assertions as scripts/smoke.sh without redundantly rebuilding.
- All web validation blocks from CI and Release workflows, under env -i with isolated temporary HOME: CI backend 260 tests; focused web model 158; contracts 26; projection 9; release backend 67; cache 135; terminal client 38. Backend, web client, and client-runtime typechecks passed. Groups overlap; do not present their sum as unique tests.
- env -i HOME=<temporary> PATH=<explicit toolchain> DIE_RUN_LLM_TESTS=0 bun test ./tests: 787 pass, 15 skip, 0 fail, 4,901 assertions, 110 files (80.27 seconds). Optional paid Live acceptance stayed skipped; environment had no real credentials.
- git diff --check.

Logs and exact extracted web commands are retained in this worktree's ignored artifacts/release directory. All requested local gates and the compiled onboarding smoke passed.

## Compiled Live onboarding and private import

Review worker task_634bad4f used /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5b29bf6c-a86675007a5e-task_634bad4f, branch die/review-release-live-packaging-and-offlin-634bad4f. Its commit 93b8f0e adds scripts/live-onboarding-smoke.ts and bun run smoke:live-onboarding; integrated here as bc6a0d6.

Reviewed the harness and ran it against this worktree's full dist/die (version 0.7.0), not just a module probe. It copies the compiled CLI outside the repository, starts it via tmux under env -i with isolated HOME and fake-only PATH, opens /live setup, selects import and explicitly confirms it, and checks canonical auth.json has exactly the fake Google key at mode 0600. The legacy source remains unchanged at mode 0600. Fake rec/play commands record any use and none were executed. It never chooses Start Live or the paid connection test.

This executes the bundled private AuthStorage static import and its locked write through the actual wizard with no external node_modules resolution; the package seam works in the full Linux compiled binary. Source inspection confirms ModelRuntime shares that storage with refreshOnCreate:false and allowModelNetwork:false. Offline credential tests cover resolving the stored key, OAuth preservation, races, and cancellation. There is no provider/network or physical-device acceptance claim.

After integrating the harness, reran whole-repo format:check, check, lint, smoke:live-onboarding, and git diff --check successfully. No application code changed after the full build/test gates.

The smoke is opt-in, not added to CI workflows in this prep. Run bun run build first, then bun run smoke:live-onboarding (tmux required). DIE_LIVE_SMOKE_BINARY can select another local compiled binary. Do not use it to test a downloaded release merely for hash reassurance.

## Release steps for parent

1. Integrate preparation and final validation commits onto develop. Inspect final diff and recheck tag/version and remote state. Keep integrated feature history.
2. Push develop; watch CI. Create annotated v0.7.0 at the integrated release commit and push that tag (no replacement of v0.6.0).
3. Watch Release workflow. It checks version/tag, gates and four compiled targets, then creates release with generated notes. Once published: gh release edit v0.7.0 --notes-file wisdom/releases/release-v0.7.0.md.
4. Confirm latest release is published, not draft/prerelease, correct tag/commit, and all 12 nonempty assets: four platform binaries/checksums plus LICENSE, THIRD_PARTY_NOTICES.md, THIRD_PARTY_LICENSES.txt, SOURCE.txt. Query dedicated assets endpoint if release detail is briefly stale.
5. Do not download binaries solely to recheck hashes. No local install needed. Cross-target binaries remain CI's validation responsibility; local executed artifact is Linux x64.

## Scope and lessons

Live is opt-in, Linux local SoX only, needs Gemini credentials and can incur paid usage. Headphones recommended; no echo cancellation. Current-session handoff is nonblocking and UI stays a simple status line. /live setup imports only after consent; optional setup-only provider test needs separate approval. Other platform targets retain the rest of die.

No real user credentials were read or imported for runtime checks; tests use isolated HOME/fake credentials. No paid acceptance, physical microphone/speaker, acoustic quality, or end-to-end real coding-agent voice acceptance was run for this release.

Values reviewed and unchanged: existing real-path checks, safe ownership, truthful proof, and clear handoff principles cover this work. No new recurring principle found.

## Parent publication

Integrated through 7ea0853 on develop. Parent checked notes/version diff, clean diff, and v0.7.0 tag validation. Remote default is develop, latest is v0.6.0, and v0.7.0 tag was absent. Preparing push and annotated tag; publication is not yet confirmed.
