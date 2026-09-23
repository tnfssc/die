# v0.2.14 release preparation

- The compaction fix was committed on its own as dd651e4. The user confirmed recovery after a restart and fresh capture.
- One executable contains the native Bun CLI and web app, an embedded compressed runtime, and private atomic cache extraction. A Bun-native PTY replaces the incompatible node-pty path on Bun. The old Node path stays compatible upstream.
- Packaging candidate d8de9e58... passed chat, terminal, Mode, model, and Stop checks with no Node, Bun, or npm on PATH. It also passed 616 tests. Details: `single-binary-packaging.md`.
- Main built the 0.2.14 baseline at `dist/die`, SHA-256 176aad5c71330df72a4e0535756c9aff8efbe38c08eba1cd7cf1852e6f88081a. Format and check passed. Tests had 616 passes, 14 skips, and no failures. Integrated browser chat and terminal with a fake provider passed. Logs: `artifacts/release-v0214-*.log`.
- The final TUI readiness change uses a shared 30-second condition deadline and a 60-second timeout for the first test. A harmless command must be accepted before real start. There is no blind readiness sleep. The controlled slow fixture stays at 5.5 seconds.
- Preparing commit, tag, and push. The failed v0.2.13 tag is immutable and must not move. The latest official release is v0.2.12. No user web server or process was stopped.

# v0.2.14 release monitor

- Release workflow run: **34873549248**, completed **failure** for tag `v0.2.14` at `fe7403ed78e3b5cefcdfe9f12928e8a171617e58`.
- Status URL: https://github.com/tnfssc/die/actions/runs/34873549248
- Required watch output: `artifacts/release-v0214-run.log`.
- Failed job/step: Linux x64 release / **Validate web backend**. The workflow `tsc --noEmit` validation reported:
  - `src/terminal/BunPtyAdapter.ts:72,73`: TS1294 — parameter-property syntax is disallowed with `erasableSyntaxOnly`.
  - `src/terminal/BunPtyAdapter.test.ts:1,2,4`: TS377057 — direct `node:child_process`, `node:fs`, and `node:path` references violate the Effect nodeBuiltinImport diagnostic.
- Build, tests, and packaging setup passed. Checksum, source-info, and publish steps did not run. No release assets were published. No edits, retries, tag changes, commits, or pushes were made.

Follow-up: the native PTY adapter was added after the earlier backend check. The final core check does not typecheck ignored T3 sources. Worker task_958849b1 owns two backend files and the canonical patch. Main adds backend `tsc` to `buildWeb` before packaging and adds real native PTY tests to CI and release. Prepare v0.2.15 because the failed v0.2.14 tag cannot move. Installed v0.2.14 still works and stays untouched during the fix.
