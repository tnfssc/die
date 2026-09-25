# Web live removal release — 2026-09-25

User reports released web voice does not work, looks poor, and lacks model choice. User explicitly directs removal from web, CLI-only, and a new release. Do not polish/re-enable web voice or use live credentials. Planv0.12.1 corrective release.

Removal task_a57ec909 works from657612d in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_a57ec909, branch die/remove-web-live-voice-completely-a57ec909. Parent owns release/version/push. Remove route/UI/bridge/browser code, tests/scripts/screenshots and unused feature plumbing. Preserve CLI live providers/models and CLI cost tracking; preserve other web coding features. Pre-web feature baseline1d25174 allows exact canonical patch comparison.

Need review removal, full CI, built web no-voice proof, version/tag validator, remote CI+release dry run at exact candidate, then tagv0.12.1 and verify published assets. No old tag rewriting; v0.12.0 remains history. Existing no-redownload release preference applies. No paid calls authorized or performed by this removal request.

Lesson from failed release: passing fake routes, unit tests and packaging checks did not prove usable end-to-end user experience. Existing values1 and2 already require whole user path and honest evidence; no new value needed. Do not call a future device/provider feature ready without validating the actual product path or clearly keeping it unshipped.

Removalcf92e61 integrated in root. Diff against prefeature1d25174 now leaves only CLI cost callbacks/footer and generic CI binary-path fix in runtime/build files; canonical patch is byte-for-byte pre-web-voice. Root pinned checkout verified exact restored patch, avoiding stale feature cache. Package set0.12.1; release-tag validator and note selector pass. Full shared CI task_7b0ed9f9 runs from root with installed pnpm; independent removal review task_cbb033f2 underway. Need packaged no-route/UI check after rebuild, then push verified candidate.

Independent removal review found no issues. Parent rebuilt package matches restored patch SHA256672bf19d14f1ba9fe3d411855b1cb5d4795aaf80c886eb5307feea80935e5902. Isolated real packaged server loads; attempted /api/voice/ws WebSocket upgrade is not accepted (normal SPA fallbackHTTP200, not101). Scanned2224 builtJS/mJS files: no VoiceControls, Start voice, DIE_WEB_VOICE or /api/voice/ws markers. All probe processes stopped and temporary isolated homes removed. Initial probe accidentally used host process.execPath rather than Bun and exited; corrected explicit installed Bun, no product change. No paid calls. Full CI still pending at this checkpoint.

Full shared local Linux CI passed:1075 root tests,17 paid/opt-in skips,0 fail; all restored upstream stages, typecheck/build/format/lint and standalone smoke pass. Candidate can be pushed for exact-SHA remote CI/release dry-run. v0.12.1 tag not created yet.
