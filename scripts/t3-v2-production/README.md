# T3-v2 production acceptance harnesses

These scripts validate the canonical T3 source pinned by `web/t3-source.json` with
`web/t3.patch`. Retained harnesses default to the revision-keyed checkout:

`<repository>/.cache/die-t3code-<web/t3-source.json revision>`

Set `T3_V2_CANDIDATE` only to review an equivalent checkout elsewhere. Harnesses
never install dependencies. Prepare the pinned checkout and its dependencies first.
All live harnesses use private temporary state beneath `TMPDIR`, or the platform
`os.tmpdir()` when `TMPDIR` is unset. An explicit reviewed binary and SHA-256 are
required where noted.

## Canonical checkout identity

```bash
REVISION=$(bun -e 'console.log((await Bun.file("web/t3-source.json").json()).revision)')
CHECKOUT="$PWD/.cache/die-t3code-$REVISION"
HEAD=$(git -C "$CHECKOUT" rev-parse HEAD)
test "$HEAD" = "$REVISION"
```

The checkout must be exactly the pinned HEAD plus the canonical patch. The build
pipeline's source verifier is authoritative for that check.

## Deterministic static contract

`contract-conformance.ts` checks the shared fixture against the root Zod schemas and
the real candidate Effect schemas:

```bash
bun scripts/t3-v2-production/contract-conformance.ts
```

Keep `tests/fixtures/t3-native-task-contract.json` with this harness and its root
consumer, `tests/t3-native-routing.test.ts`.

## Browser and native acceptance

Both launchers fail closed unless checkout HEAD, binary path, binary hash, and the
explicit acceptance flag are supplied. They do not install, build, or release.

```bash
BIN=/absolute/path/to/reviewed/die
SHA=$(sha256sum "$BIN" | cut -d' ' -f1)
T3_V2_ACCEPT_CANDIDATE=1 \
T3_V2_DIE_BINARY="$BIN" \
T3_V2_EXPECT_CHECKOUT_HEAD="$HEAD" \
T3_V2_EXPECT_BINARY_SHA256="$SHA" \
bun scripts/t3-v2-production/browser-acceptance.ts

T3_V2_ACCEPT_CANDIDATE=1 \
T3_V2_DIE_BINARY="$BIN" \
T3_V2_EXPECT_CHECKOUT_HEAD="$HEAD" \
T3_V2_EXPECT_BINARY_SHA256="$SHA" \
bun scripts/t3-v2-production/native-acceptance.ts
```

Browser acceptance additionally needs Chromium and `playwright-core` already
available. Optional overrides are documented by the `T3_V2_*` constants at the top
of each script. Native acceptance requires the candidate's
`NativeDieIntegration.production.test.ts` and prepared dependency tree.

## Migration acceptance

The migration harness needs prepared dependency trees for the pinned current checkout
and the historical `719a76ca1dbf5490f1aa33ffb9966301e02be9a9` checkout. It uses
`web/t3-source.json` and `web/t3.patch` by default and never installs packages.
The two tracked `migration-fixture-*.ts.txt` files are copied temporarily beneath
the matching checkout solely for package resolution and are removed in `finally`.

```bash
bun scripts/t3-v2-production/migration-acceptance.ts
```

## Packaged, preservation, and worktree gates

- `packaged-smoke.ts` is a black-box relocation/security smoke. It uses only
  supported Node/Bun built-ins; no transitive `ws` package is required.
- `preservation-acceptance.ts` validates same-server shell-card and completion
  preservation against an exact packaged binary.
- `worktree-acceptance.ts` validates local and native structured-worktree behavior.
  It requires `T3_WORKTREE_ACCEPT=1`, `T3_WORKTREE_DIE_BINARY`,
  `T3_WORKTREE_EXPECT_SHA256`, and `T3_V2_EXPECT_CHECKOUT_HEAD`.

These live gates write proof only to their configured artifact paths. Proof files,
logs, screenshots, browser profiles, generated binaries, and private state are review
evidence, not source inputs.

## PR inclusion boundary

Include the README, retained acceptance scripts, and both migration fixtures only as
a coherent set. Do **not** include `artifacts/`.

`build-candidate.ts`, `export-candidate.ts`, and `export-worktree.ts` are
research/export utilities, not portable acceptance harnesses. Exclude them from the
recommended PR stage list; they may refer to local review state or generate files.
Do not delete those local user files merely to prepare the PR.
