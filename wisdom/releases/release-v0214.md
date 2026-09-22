# v0.2.14 release preparation

- Compaction fix committed separately as dd651e4; user confirmed recovery after restart/fresh capture.
- One executable: native Bun CLI+web, embedded compressed runtime, private atomic cache extraction. Bun-native PTY replaces incompatible node-pty path on Bun. Legacy Node path remains upstream-compatible.
- Packaging candidate d8de9e58... passed no-Node/Bun/npm PATH chat/terminal/Mode/model/Stop and 616 tests. Details: single-binary-packaging.md.
- Main version0.2.14 baseline build SHA256176aad5c71330df72a4e0535756c9aff8efbe38c08eba1cd7cf1852e6f88081a (dist/die). Main reran format/check, 616pass14skip0fail, integrated browser fake-provider chat+terminal; all passed. Artifacts release-v0214-*.log.
- TUI readiness final main adjustment: shared30s condition deadline, first test60s timeout, harmless command accepted before real start; no arbitrary readiness sleep. Controlled slow fixture remains5.5s.
- Preparing commit/tag/push; v0.2.13 failed immutable tag must not move. Last official release currently0.2.12. No user web server/process stopped.

# v0.2.14 release monitor

- Release workflow run: **34873549248**, completed **failure** for tag `v0.2.14` at `fe7403ed78e3b5cefcdfe9f12928e8a171617e58`.
- Status URL: https://github.com/tnfssc/die/actions/runs/34873549248
- Required watch output: `artifacts/release-v0214-run.log`.
- Failed job/step: Linux x64 release / **Validate web backend**. The workflow `tsc --noEmit` validation reported:
  - `src/terminal/BunPtyAdapter.ts:72,73`: TS1294 — parameter-property syntax is disallowed with `erasableSyntaxOnly`.
  - `src/terminal/BunPtyAdapter.test.ts:1,2,4`: TS377057 — direct `node:child_process`, `node:fs`, and `node:path` references violate the Effect nodeBuiltinImport diagnostic.
- Build, tests, and packaging prerequisites passed; checksum/source-info and publish steps were skipped. No release assets were published. No edits, retries, tag changes, commits, or pushes made.

Main followup: native PTY adapter was added after earlier backend check; final core check does not typecheck ignored T3 sources. Worker task_958849b1 owns two backend files/canonical patch. Main adds backend tsc to buildWeb BEFORE packaging, adds actual native PTY tests to CI/release; preparing v0.2.15 (v0.2.14 immutable failedtag). Installed0.2.14 remains functional and untouched duringfix.
