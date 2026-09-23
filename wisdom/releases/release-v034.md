# v0.3.4 release

The user chose to keep GitHub runners after learning that Blacksmith needs organization ownership. They approved releasing the shared-memory prompt change. CI runners do not change.

The release includes the approved value in `src/prompts/memory.md` at 8a45421: code and notes belong together so the next person can pick up the work. It also includes a prompt delivery regression test.

The v0.3.4 candidate built with the existing checked T3 web archive. Core results: 640 passed, 14 skipped, 0 failed (artifacts/release-v034-tests.log). Final frozen install, typecheck, formatting, release-tag validator and focused release/memory/prompt tests passed (artifacts/release-v034-final-checks.log). Candidate --version 0.3.4.

Next: commit the package version, tag, push, watch release CI, and check the official binary checksum and version. The user did not ask for an install. Commit and push the final publication result with the notes. Do not leave it only on this machine.

Release tag v0.3.4 pushed at89958be. CI35379368883 running (artifacts/release-v034-ci.log, watch task_ac5c7ee6). While it runs, user requested README advertising die web and first-class Herdr integration. Added both to intro, die web command, Web UI and Herdr sections. Claims match src/web/launcher.ts, src/herdr-agent-state.ts and wisdom/integrations/herdr.md; docs link exists, format/diff checks pass. README change goes on develop after immutable release tag.

Complete. https://github.com/tnfssc/die/releases/tag/v0.3.4 published; releaseCI35379368883 success. All four platform binaries/checksum pairs and licenses/source present. Official Linux x64 downloaded to artifacts/official-v034; SHA25606267cb1eaecccd7ccd188c7ec99139dc86c114c3875824d9bf913c0bd34b0b1 verified, isolated HOME/PATH=/nonexistent --version0.3.4. SOURCE matches release commit89958be. Release notes updated. README+notes follow-up f398f06 already pushed on develop; tag unchanged. Installed binary not changed (not requested). Final status notes committed/pushed with this update. No work remains.
