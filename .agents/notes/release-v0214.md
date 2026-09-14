# v0.2.14 release preparation

- Compaction fix committed separately as dd651e4; user confirmed recovery after restart/fresh capture.
- One executable: native Bun CLI+web, embedded compressed runtime, private atomic cache extraction. Bun-native PTY replaces incompatible node-pty path on Bun. Legacy Node path remains upstream-compatible.
- Packaging candidate d8de9e58... passed no-Node/Bun/npm PATH chat/terminal/Mode/model/Stop and 616 tests. Details: single-binary-packaging.md.
- Main version0.2.14 baseline build SHA256176aad5c71330df72a4e0535756c9aff8efbe38c08eba1cd7cf1852e6f88081a (dist/die). Main reran format/check, 616pass14skip0fail, integrated browser fake-provider chat+terminal; all passed. Artifacts release-v0214-*.log.
- TUI readiness final main adjustment: shared30s condition deadline, first test60s timeout, harmless command accepted before real start; no arbitrary readiness sleep. Controlled slow fixture remains5.5s.
- Preparing commit/tag/push; v0.2.13 failed immutable tag must not move. Last official release currently0.2.12. No user web server/process stopped.
