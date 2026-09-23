# v0.2.12 release underway

This follows the unpublished v0.2.11. Move the T3 build cache outside `node_modules` so Node does not refuse type stripping. The user approved push, release, and install. The package is now 0.2.12.

Task task_c9534fb7 owns the helper, workflow, gitignore, and a real fresh default build. Task task_4cc19a47 owns core check, build, and tests. Wait for both. Then check the fresh backend, commit and tag without moving v0.2.11, push, watch the release, install the published CLI and sidecar, and run real browser checks. The current install is 0.2.11 with a tested local backend. User state is unchanged.

The fresh default build passed with `DIE_T3_SOURCE` unset under `.cache/die-t3code`. The reverse patch check passed, and all 351 symlinks stay inside the bundle. Core results: 610 passed, 14 skipped, 0 failed. Format, lint, check, and build passed. The matching default smoke source-cache path was updated. Ready to commit, tag, and push 0.2.12. v0.2.11 stays unpublished and its tag stays unchanged.

Pushed commit 882fd527f4a35e46a1d00be91d87bc6a0f3bb665 and annotated tag v0.2.12. Release run 34850093931 is running. Watch it, then download, check, and install the published CLI and web bundle. Run the real browser Stop and model checks.

## Published and installed successfully

Release: https://github.com/tnfssc/die/releases/tag/v0.2.12 . Release workflow 34850093931 passed. Both code CI runs for 882fd527 passed. Downloaded the published CLI and web bundle. Their checksums and SOURCE passed, as did all 351 internal symlink checks. Installed both under `~/.local/bin`.

The installed CLI reports 0.2.12. CLI SHA-256: 9b439c6a6f248c2ce81306f485f0540392e84d3e505aa5ad770cfc29fc73ae7b. Web archive SHA-256: e972a0a8748f5d885f9b9e350d6995ee7218afc5a2a0b0932d62d7cd1789f15d. The published assets passed real browser Stop in task_383205c6 and model, no-auth, and origin checks in task_bedbd24e. The shell got TERM and its PID disappeared. The background subagent stream aborted, and follow-up history stayed intact. The backup was removed after success. User servers were not touched. Restart `die web` to load the update. The release body includes web highlights and the Node 24 runtime need. The v0.2.11 tag stays unpublished and is replaced by v0.2.12.
