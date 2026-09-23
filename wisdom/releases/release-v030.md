# v0.3.0 release

The user said "install push release." Base feature commit e5978be is local and not pushed yet. The last release, v0.2.15 at cd15b04, published successfully.

Main changed the package to 0.3.0 and changed the README to say it is available. Task task_57d3b3fa runs a fresh baseline build with backend `tsc`, format and check, all core tests, and browser chat and terminal smoke with a fake provider. Logs: `artifacts/release-v030-*.log`. After it passes: install only the CLI, commit the version, docs, and notes, push `develop`, tag v0.3.0, watch release CI, and check the official asset. Never stop the user's server on port 13773 or rewrite an old tag.

The installed binary stays at official v0.2.15 with SHA-256 424be6c6a87c8b6f7f49dd575075492ae8b5f76bc8d1493ed442b1952c60e809 until the new checks pass. All updater tests use private fixtures and mocked HTTP, not the installed Die. There are no live provider calls. Use `TMPDIR=/var/tmp HERDR_ENV=0` because `/tmp` is full.

Checks passed: 635 core tests passed, 14 skipped, and 0 failed. All 121 backend tests passed with no skips. The fresh baseline build included required backend `tsc`. Format, check, and browser chat and terminal with 4 fake-provider requests passed. Local build SHA-256: d056f15589caf12bd5812a9020393572fed93ff08625bd25ca9140b313b86dba. Main is installing only the CLI and pushing the release. No user web server was stopped.

Installed local 0.3.0. Commit 09de47e and annotated tag v0.3.0 were pushed. Task task_ee83e0c4 watches release CI 34881274920. Deterministic tests have passed. Release build, smoke, backend, and publish are still pending. https://github.com/tnfssc/die/actions/runs/34881274920

Published. Release CI 34881274920 passed. https://github.com/tnfssc/die/releases/tag/v0.3.0 . Task task_6916eab2 is checking the official artifact in a private directory: download, checksum, version, real metadata-only `die update`, and browser chat and terminal. After it passes, install the official binary atomically. The locally checked 0.3.0 is installed for now. No servers were stopped.

Final official checks passed. The binary checksum and version 0.3.0 match. Live GitHub `die update` said 0.3.0 is already current. Browser chat and terminal smoke passed. The official CLI binary was installed atomically. SHA-256: 22ad0713d3d567eb407164e40806e2213bba661df4b91c8cb39f803922e10a46 for `die-linux-x64`. The user's install, push, and release request is done.
