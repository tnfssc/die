# Isolated memory/resource audit probes

See [the audit report](../../wisdom/resources/memory-resource-audit.md) for results and limitations. These harnesses help with manual investigation. They do not fix the product automatically. Run from repository root on Linux with Bun 1.4.1 / Node 24 and the repository dependencies installed. Native/backend probes need the existing current patched web checkout/dependencies. Bundled probes require a built `dist/die`.

## CLI / execute

- `bun scripts/leak-audit/session-journal.ts`: 32 MiB synthetic original-history retention across compaction, then reset/GC.
- `bun scripts/leak-audit/bridge-retention.ts`: 10,000 real in-memory bridge requests. Listener and heap counts before/after closure.
- `bun scripts/leak-audit/execution-runtime.ts`: execute success, spill, timeout, abort, and owned-descendant cleanup.
- `bun scripts/leak-audit/web-launcher-runtime.ts`: repeated normal launcher exits plus intentionally stubborn/orphaning **test backends**. Exact owned PID cleanup.
- `DIE_SOAK_CYCLES=2000 bun scripts/leak-audit/cli-rpc-soak.ts`: real CLI with local fake model. Add `DIE_SOAK_NEW_ONLY=1` for session-replacement isolation.

## Web investigation harnesses

**Historical assertion warning:** `current-web-provider.mjs` and the custom missing-recording-trigger case were written to show the v0.3.4 findings, not to assert v0.4.0 fixed behavior. The copied-provider instrumentation may no longer match after the fix. Do not use its old retention assertions as release gates. Use the product regression suites (TaskManager/capture/history plus backend logger/PiAdapter/SubscriberStream and client RPC tests) for fixed behavior. The server runtime probes still give useful lifecycle measurements.

These source probes verify pin `719a76ca1dbf5490f1aa33ffb9966301e02be9a9` and the canonical patch in `.cache/die-t3code-v0042`.

- `node scripts/leak-audit/current-web-provider.mjs`: temporary current-source-copy retention tests with read-only private-state observers.
- `bash scripts/leak-audit/current-web-provider-tests.sh`: provider cleanup regression suites.
- `node scripts/leak-audit/current-web-client-tests.mjs`: browser/client lifecycle suites plus native recording timeout reproduction (not a full browser heap soak).
- `bash scripts/leak-audit/current-web-server-check.sh`: current-source checks, focused suites, rebuild and Node-instrumented server probe.
- `node scripts/leak-audit/current-web-server-runtime.mjs`: isolated current backend under Node/V8 with explicit GC/handle measurements. `LEAK_SEQUENTIAL=3000` selects a longer sequential run. See companion note for other options.
- `node scripts/leak-audit/bundled-web-runtime.mjs`: **actual compiled Bun** `dist/die web`, separate temporary HOME/cache/state, real subscription churn, /proc measurements, owned-process shutdown.

Tests use temporary state and exact owned PIDs. Do not replace cleanup with process-name matching, pkill, or killall. Some native child commands deliberately ignore termination. Keep each harness's finally cleanup. RSS alone is not proof of a live-object leak.

## Historical only

`web-runtime-probe.mjs` and `server-shutdown-probe.mjs` target the **stale** `.cache/die-t3code` checkout. Their archived measurements do not show current-release behavior. Use `current-web-*` and `bundled-web-runtime.mjs` instead.

## v0.4.0 history and core regression entry points

- `TMPDIR=/var/tmp bun scripts/history-sdk-probe.ts`: real offline SDK compaction/resume soak.
- `TMPDIR=/var/tmp bun scripts/history-storage-probe.ts`: native/adapted retained-memory comparison.
- `TMPDIR=/var/tmp bun test tests/history-storage.test.ts tests/history-storage-io.test.ts tests/history-storage-lifecycle.test.ts tests/history-disk-retrieval.test.ts`: history compatibility/fault tests.
- After rebuilding `dist/die`, `TMPDIR=/var/tmp bun test ./tests`: full deterministic core suite (live API tests stay opt-in).

`TMPDIR=/var/tmp` avoids small/full tmpfs mounts on Linux. These paths still use uniquely owned temporary directories and cleanup.
