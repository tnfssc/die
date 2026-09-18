# v0.3.4 release

User approved retaining GitHub runners and releasing shared-memory prompt change after learning Blacksmith requires organization ownership. No CI runner changes.

Release includes approved value in src/prompts/memory.md (8a45421): code and notes belong together so next person can pick up work. Prompt delivery regression included.

Validation: v0.3.4 candidate built with existing verified T3 web archive; 640 core tests passed /14 skipped /0 failed (artifacts/release-v034-tests.log). Final frozen install, typecheck, formatting, release-tag validator and focused release/memory/prompt tests passed (artifacts/release-v034-final-checks.log). Candidate --version 0.3.4.

Preparing package version commit/tag/push, then monitor release CI and verify official binary checksum/version. No installation requested. Final publication result must be committed/pushed with notes, not left local.

Release tag v0.3.4 pushed at89958be. CI35379368883 running (artifacts/release-v034-ci.log, watch task_ac5c7ee6). While it runs, user requested README advertising die web and first-class Herdr integration. Added both to intro, die web command, Web UI and Herdr sections. Claims checked against src/web/launcher.ts, src/herdr-agent-state.ts and docs/herdr.md; docs link exists, format/diff checks pass. README change goes on develop after immutable release tag.

COMPLETE: https://github.com/tnfssc/die/releases/tag/v0.3.4 published; releaseCI35379368883 success. All four platform binaries/checksum pairs and licenses/source present. Official Linux x64 downloaded to artifacts/official-v034; SHA25606267cb1eaecccd7ccd188c7ec99139dc86c114c3875824d9bf913c0bd34b0b1 verified, isolated HOME/PATH=/nonexistent --version0.3.4. SOURCE matches release commit89958be. Release notes updated. README+notes follow-up f398f06 already pushed on develop; tag unchanged. Installed binary not changed (not requested). Final status notes committed/pushed with this update. No work remaining.
