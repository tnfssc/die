# Maintained T3 acceptance harnesses

These scripts check the canonical T3 source pinned by `integrations/t3/upstream/source.json` with
`integrations/t3/upstream/die.patch`. Retained harnesses default to the revision-keyed checkout:

`<repository>/.cache/die-t3code-<integrations/t3/upstream/source.json revision>`

Set `T3_V2_CANDIDATE` only to review an equivalent checkout elsewhere. Harnesses
never install dependencies. Prepare the pinned checkout and its dependencies first.
All live harnesses use private temporary state beneath `TMPDIR`, or the platform
`os.tmpdir()` when `TMPDIR` is unset. An explicit reviewed binary and SHA-256 are
required where noted.

## Manual offline probes

- `bun integrations/t3/gates/launcher-runtime.ts`: Linux local fake-backend lifecycle
  and exact owned-PID cleanup; requires a built `dist/die`.
- `bun integrations/t3/gates/rpc-smoke.ts`: compiled CLI RPC with a loopback fake
  model and T3 task events, no provider API. `--serve` intentionally keeps the fixture
  server running for manual browser work.

Neither probe uses a source checkout or a hardcoded upstream pin. They are manual
resource investigations, not automatically discovered release tests.

## Canonical checkout identity

```bash
REVISION=$(bun -e 'console.log((await Bun.file("integrations/t3/upstream/source.json").json()).revision)')
CHECKOUT="$PWD/.cache/die-t3code-$REVISION"
HEAD=$(git -C "$CHECKOUT" rev-parse HEAD)
test "$HEAD" = "$REVISION"
```

The checkout must be exactly the pinned HEAD plus the canonical patch. The build
pipeline's source verifier decides whether it passes.

## Deterministic static contract

`contract-conformance.ts` checks the shared fixture against the root Zod schemas and
the real candidate Effect schemas:

```bash
bun integrations/t3/gates/contract-conformance.ts
```

Keep `integrations/t3/fixtures/native-task-contract.json` with this harness and its root
consumer, `tests/t3/t3-native-routing.test.ts`.

## Browser and native acceptance

Both launchers fail closed unless checkout HEAD, binary path, binary hash, and the
explicit acceptance flag are given. They do not install, build, or release.

```bash
BIN=/absolute/path/to/reviewed/die
SHA=$(sha256sum "$BIN" | cut -d' ' -f1)
T3_V2_ACCEPT_CANDIDATE=1 \
T3_V2_DIE_BINARY="$BIN" \
T3_V2_EXPECT_CHECKOUT_HEAD="$HEAD" \
T3_V2_EXPECT_BINARY_SHA256="$SHA" \
bun integrations/t3/gates/browser-acceptance.ts

T3_V2_ACCEPT_CANDIDATE=1 \
T3_V2_DIE_BINARY="$BIN" \
T3_V2_EXPECT_CHECKOUT_HEAD="$HEAD" \
T3_V2_EXPECT_BINARY_SHA256="$SHA" \
bun integrations/t3/gates/native-acceptance.ts
```

Browser acceptance also needs Chromium and `playwright-core` already
available. Optional overrides are documented by the `T3_V2_*` constants at the top
of each script. Native acceptance needs the candidate's
`NativeDieIntegration.production.test.ts` and prepared dependency tree.

## Migration acceptance

The migration harness tests the historical pre-adoption production source
`a9b49a7df0a4261dcc438d4493cc3154a1d9819e`, with the pre-adoption canonical
patch from `c6fe280`, upgrading in place to the preview revision in
`integrations/t3/upstream/source.json` plus `integrations/t3/upstream/die.patch`. Each checkout needs its own prepared dependency tree. Its installed lockfile must exactly match
`pnpm-lock.yaml`. The harness never clones or installs and never writes package
caches. Override checkout or patch paths with
`T3_V2_MIGRATION_PRODUCTION`, `T3_V2_MIGRATION_PREVIEW`,
`T3_V2_MIGRATION_PRODUCTION_PATCH`, and
`T3_V2_MIGRATION_PREVIEW_PATCH`.

The production runner creates a native V2 event/projection graph. It includes a run and
nodes, normalized usage and cost, provider session/thread/turn identity, a
completed native subagent job, two-message history and turn items, and encoded
server settings with a provider instance and price override. The preview runner
opens that same database and settings file, validates them through preview domain
readers/schemas, then starts a second time and compares a semantic snapshot. This
is an upgrade/restart compatibility gate. Both revisions currently report schema
migration 54. The gate does not claim that a new numbered migration ran.

```bash
TMPDIR=/var/tmp \
T3_V2_MIGRATION_PRODUCTION=/absolute/path/to/patched-a9b49a7 \
T3_V2_MIGRATION_PREVIEW=/absolute/path/to/patched-b488c57 \
bun integrations/t3/gates/migration-acceptance.ts
```

The two tracked fixture templates are copied temporarily beneath their matching
checkout only for workspace package resolution and removed in `finally`.
When no production patch is given, the harness rebuilds and hash-checks it from repository
history. Before running, it checks that each checkout is exactly its pinned HEAD
plus the expected patch.

## Packaged, preservation, and worktree gates

- `packaged-smoke.ts` is a black-box relocation/security smoke. It uses only
  supported Node/Bun built-ins. No transitive `ws` package is needed.
- `preservation-acceptance.ts` validates same-server shell-card and completion
  preservation against an exact packaged binary.
- `worktree-acceptance.ts` validates local and native structured-worktree behavior.
  It needs `T3_WORKTREE_ACCEPT=1`, `T3_WORKTREE_DIE_BINARY`,
  `T3_WORKTREE_EXPECT_SHA256`, and `T3_V2_EXPECT_CHECKOUT_HEAD`.

These live gates write proof only to their configured artifact paths. Proof files,
logs, screenshots, browser profiles, generated binaries, and private state are review
evidence, not source inputs.

## Historical research is not a gate

Candidate builders/exporters and their inputs are preserved under
`experiments/t3/production-v2/archive/`. They are historical, not alternate
ways to build or update the canonical inputs. No archive is run automatically.
