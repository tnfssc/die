# Shared local / CI checks (2026-09-25)

Worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_e6f73e2d`; branch `die/share-local-and-ci-check-runner-e6f73e2d`.

Run `bun run ci` before pushing to run the Linux CI gate locally. `bun run ci:macos` is the separate device-free macOS Live lane; running it on Linux does **not** prove macOS behavior. Both workflows invoke these same commands. `scripts/ci.sh` owns ordering, frozen install, checks, pinned web test selection, deterministic test env, compiled offline probe, and smoke. Linux stops at first failed command, records stdout/stderr in `artifacts/ci/*.log`, and GitHub uploads those logs on failure. Workflow YAML retains tool setup, PTY package installation, checkout and artifact upload.

Local prerequisites for Linux parity: Bash, Bun 1.4.2 (`mise.toml`), Node 24.21.0, pnpm 11.27.1, tmux, network access for locked installs / pinned T3 web checkout and the full Git history/tags used by updater tests. CI pins these via actions and Ubuntu 24.04. Building the web runtime may populate `.cache` and `dist`; local dirty files/caches and OS/architecture can differ from clean GitHub Linux x64. Use a clean checkout and matching versions for closest comparison. The runner resolves `web/t3-source.json` relative to the repository unless `DIE_T3_SOURCE` is set; this is the same default as `scripts/build-web.ts`. Release gates remain separate and were not changed.

Regression proof: `bun test tests/ci-runner.test.ts` covers ordered Linux/macOS lanes, web working directory, deterministic env, first failure exit status and saved log. `bun run format:check`, `bun run lint`, `bun run check`, and `bash -n scripts/ci.sh` passed locally. Full Linux gate and actual macOS execution remain for integrated PR CI; next step run `bun run ci` with prerequisites / inspect its logs, then verify both workflow lanes.

Values unchanged: existing [one thing, one clear owner](../values.md), [say what proof shows](../values.md), and [finish what user needs](../values.md) cover this change; no new general rule needed.
