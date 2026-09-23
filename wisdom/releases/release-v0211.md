# v0.2.11 release underway

The user approved push, release, and install after web Stop acceptance. Version: 0.2.11.

This release adds optional \u00A7die web\u00A7 with official T3 pin 6f00d388 and the reviewed Pi, Die, no-auth, tasks, and Stop patch. It also adds the nearby backend launcher, an optional local installer, and a Linux web tarball. The CLI stays standalone. Web needs Node 24.

Source typecheck and 84 T3 tests passed. Core results: 607 passed, 14 skipped, 0 failed across 87 files. Check, build, and smoke passed. The canonical patch was checked against the clean pinned Git index. The installed build passed real Stop, model, no-auth, and origin checks before the version bump. The release binary still needs the same checks. No user servers were stopped. A restart is needed.

Main owns commit, tag, push, publication, and installing the published assets. Workflows add Node 24, pnpm 11.10.0 for release, the web tarball and checksum, SOURCE files, and the T3 license. Do not move tags.

Final checks passed: 610 core tests with 14 skips and no failures, plus 103 PiAdapter, EnvironmentAuth, and startup tests. Format, lint, typecheck, build, smoke, notices, and tag validation passed. Main installed the final 0.2.11 CLI and backend. Task task_1e923534 repeated real Stop and model, no-auth, and origin smoke tests. Both passed.

The final audit fixed explicit \u00A7--base-dir\u00A7 and \u00A7--host\u00A7 forwarding defaults and a stale README. It found that pnpm legacy deploy made a self-reference \u00A7t3\u00A7 link escape to the research checkout. The build helper now rewrites it to \u00A7../../..\u00A7. All 351 links stay inside the bundle after a real rebuild. The release workflow gets the T3 revision from the pin, includes both SOURCE files, and checks the T3 backend before publishing. Next: commit, tag, push, then download and check the published assets and install them.

Pushed commit 5e228da6652b36ddeba89a8f43f99213c1d485f4 and annotated tag v0.2.11. \u00A7develop\u00A7 and the tag were pushed atomically. Release workflow 34849330586 is running: https://github.com/tnfssc/die/actions/runs/34849330586 . Next: wait for publication, download the CLI, web tarball, checksums, and SOURCE, check and install them, then repeat the installed browser Stop and model checks. A locally built 0.2.11 is already installed and tested. Do not move the tag.

Publication failed before assets. Run 34849330586 hit Node \u00A7ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING\u00A7 because the default T3 checkout was under \u00A7node_modules/.cache\u00A7. Local overrides hid this. GitHub did not publish a release. Leave v0.2.11 unchanged. Follow-up v0.2.12 moves the default cache outside \u00A7node_modules\u00A7 and checks a real fresh default build. Worker task_c9534fb7 owns the helper, workflow, and gitignore changes.
