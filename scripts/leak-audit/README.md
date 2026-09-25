# Offline resource investigation probes

See [the historical audit report](../../wisdom/resources/memory-resource-audit.md) for results and limitations. These are manual investigation harnesses, not release gates. No API/device/live probe is part of this move.

## Maintained offline entry points (left under scripts)

- `session-journal.ts`: synthetic history retention and reset/GC.
- `bridge-retention.ts`: in-memory bridge requests and listener/heap counts.
- `execution-runtime.ts`: execute success, spill, timeout, abort, owned-descendant cleanup.
- `web-launcher-runtime.ts`: normal launcher exits and intentionally stubborn local test backends.
- `cli-rpc-soak.ts`: CLI using a local fake model; optional `DIE_SOAK_CYCLES` and `DIE_SOAK_NEW_ONLY`.
- `scripts/die-web-rpc-smoke.ts`: local loopback OpenAI-compatible model RPC smoke, not a historical T3 pin check.

These probes do not assert an old web source pin. Keep the generic CLI probes in place. The web-launcher probe (and, if desired, the offline die-web RPC smoke) may be moved/adapted by the integrations/t3/gates owner after preserving their local-process cleanup and test discovery; they are not historical pin evidence. Do not move them as-is into an excluded tree and silently lose TypeScript coverage.

## Historical web evidence (moved without rewriting)

The historical `current-web-*`, `bundled-web-runtime.mjs`, `web-runtime-probe.mjs`, and `server-shutdown-probe.mjs` now reside in [the production-v2 archive](../../experiments/t3/production-v2/archive/scripts/leak-audit/). The first group hardcodes old pin `719a76ca1dbf5490f1aa33ffb9966301e02be9a9` and/or its `.cache/die-t3code-v0042` checkout and `web/t3.patch`; “current” was historical, not a claim about today's canonical pin. The last two use the older `.cache/die-t3code` checkout. The old `scripts/die-web-{mode,model,smoke,stop}-smoke.ts` are archived alongside them because they also use `.cache/die-t3code`. Embedded source-relative paths and evidence remain unchanged; do not invoke them from the new location without porting and revalidating against the current source. Prior measurements remain historical, not current-release assertions.

Use the maintained product tests and current T3 gate owners for production behavior. Preserve exact owned-PID cleanup in any adapted harness; do not replace it with process-name matching, pkill, or killall. RSS alone is not proof of a live-object leak.
