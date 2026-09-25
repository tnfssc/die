# Production-v2 historical archive

`archive/` is a byte-for-byte relocation of tracked historical inputs and probes. The old `scripts/t3-v2-production/{build-candidate,export-candidate,export-worktree}.ts` are under `archive/scripts/`; candidate patch, pin, export metadata, and README are under `archive/.agents/patches/`; lifecycle rollback snapshots are under `archive/.agents/rollback/t3-v2-lifecycle/`. Other tracked .agents items (including the general rollback index) remain where they were.

`archive/scripts/die-web-{mode,model,smoke,stop}-smoke.ts` use the old `.cache/die-t3code` checkout. `archive/scripts/leak-audit/` holds older source probes tied to pin `719a76ca1dbf5490f1aa33ffb9966301e02be9a9` and `web/t3.patch`, plus the old stale-checkout probes. Their “current” labels describe the era they were written in, not the current production pin. They retain original relative paths and references; moving them does not make them runnable from this location. Port intentionally before reuse. No archived script is a release gate.

Canonical released inputs, build, and maintained offline T3 probes live in
[integrations/t3](../../../integrations/t3/README.md). Generic CLI probes stay
under `scripts/leak-audit/`. The archived candidate builder is deliberately not
part of current build source guards. No archive is executed automatically.
