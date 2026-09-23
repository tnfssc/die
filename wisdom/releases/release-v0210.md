# v0.2.10 release underway

The user approved a new release and install. It adds automatic shake before compaction when serialized-message characters fall by at least 75%. It also adds a read-only capture preview guard and continuation and regression tests. Preparing and running rows now share the label … executing. `package.json` is now 0.2.10.

Worker task_39b9705b runs the full release checks with a neutral `/var/tmp` and `HERDR_ENV=0`. Its log is `artifacts/release-v0210-validation.log`. Main will install the tested `dist` atomically, commit the changes, and create an annotated tag with `-m`. Running `git tag` without `-m` opens an unusable editor. Then main will push `develop` and the tag, watch the `release.yml` workflow, and check the downloaded version, checksum, and SOURCE. The last good release was v0.2.9 at commit 11d77d4. Do not move old tags.

Validation passed in task_39b9705b: 591 passed, 14 skipped, 0 failed, and 3777 assertions. Format, lint, check, build, smoke, and tag checks passed. The atomic install finished, and `~/.local/bin/die --version` reports 0.2.10. Next: commit, tag, push, and check publication.
