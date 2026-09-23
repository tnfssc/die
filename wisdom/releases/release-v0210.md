# v0.2.10 release underway

The user approved a new release and install. It adds automatic shake before compaction when serialized-message characters fall by at least 75%. It also adds a read-only capture preview guard and continuation and regression tests. Preparing and running rows now share the label \u2026 executing. \u00A7package.json\u00A7 is now 0.2.10.

Worker task_39b9705b runs the full release checks with a neutral \u00A7/var/tmp\u00A7 and \u00A7HERDR_ENV=0\u00A7. Its log is \u00A7artifacts/release-v0210-validation.log\u00A7. Main will install the tested \u00A7dist\u00A7 atomically, commit the changes, and create an annotated tag with \u00A7-m\u00A7. Running \u00A7git tag\u00A7 without \u00A7-m\u00A7 opens an unusable editor. Then main will push \u00A7develop\u00A7 and the tag, watch the \u00A7release.yml\u00A7 workflow, and check the downloaded version, checksum, and SOURCE. The last good release was v0.2.9 at commit 11d77d4. Do not move old tags.

Validation passed in task_39b9705b: 591 passed, 14 skipped, 0 failed, and 3777 assertions. Format, lint, check, build, smoke, and tag checks passed. The atomic install finished, and \u00A7~/.local/bin/die --version\u00A7 reports 0.2.10. Next: commit, tag, push, and check publication.
