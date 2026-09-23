# v0.2.9 publication status

Installed the tested \u00A7dist/die\u00A7 to \u00A7~/.local/bin/die\u00A7. It reports 0.2.9. Commit 11d77d4 was pushed to \u00A7develop\u00A7, and annotated tag v0.2.9 was created. Push task_fb904d2f exited 0.

The first tag command omitted \u00A7-m\u00A7 and opened a fresh editor. It failed without creating a tag. The corrected command was \u00A7git tag -a v0.2.9 -m Release\u00A7. The first push then failed because the ref was missing; the retry passed. The worktree is clean except for ignored pending notes.

Worker task_71b9a26a watches the Release workflow and checks the published asset checksum, version, and SOURCE. Do not start another release or move the tag. Final report: \u00A7artifacts/release-v029-publication.json\u00A7. The full local suite had 581 passes, 14 skips, and 0 failures. The installed app needs a restart.

Publication verified. Release workflow 34821145815 passed. https://github.com/tnfssc/die/releases/tag/v0.2.9 is public, not a draft or prerelease. The downloaded asset reports 0.2.9. SHA-256 87faf99b315770d5e9a38949892bc6512d8f2e866d9e005ea47afb1b4beeca0b matches the manifest and GitHub digest. SOURCE has full commit 11d77d4bfec3a0ceb5ff188ec38af6d67904fe80. The worker removed its check temp files. The requested install, push, and release are done.
