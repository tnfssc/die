# v0.3.4 release

User approved retaining GitHub runners and releasing shared-memory prompt change after learning Blacksmith requires organization ownership. No CI runner changes.

Release includes approved value in src/prompts/memory.md (8a45421): code and notes belong together so next person can pick up work. Prompt delivery regression included.

Validation: v0.3.4 candidate built with existing verified T3 web archive; 640 core tests passed /14 skipped /0 failed (artifacts/release-v034-tests.log). Final frozen install, typecheck, formatting, release-tag validator and focused release/memory/prompt tests passed (artifacts/release-v034-final-checks.log). Candidate --version 0.3.4.

Preparing package version commit/tag/push, then monitor release CI and verify official binary checksum/version. No installation requested. Final publication result must be committed/pushed with notes, not left local.
