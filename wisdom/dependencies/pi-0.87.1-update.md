# Pi 0.87.1 dependency update

Date: 2026-09-23

## Scope

Updated the four direct earendil-works Pi dependencies from 0.87.0 to the current stable 0.87.1 releases:

- `@earendil-works/pi-ai@0.87.1`
- `@earendil-works/pi-coding-agent@0.87.1`
- `@earendil-works/pi-server@0.87.1`
- `@earendil-works/pi-tui@0.87.1`

The regenerated `bun.lock` also moves the resolved Pi family packages `chord`, `pi-agent-core`, `pi-protocol`, and `pi-telemetry` to 0.87.1. `bun outdated` reports no remaining root dependency updates. No T3 source pin, patch, web dependency manifest, or vendored upstream source was changed; the normal build only fetched/built the existing pinned T3 revision in ignored cache/output directories.

## Compatibility and notices

Pi 0.87.1's distributed `dist/core/session-manager.js` is byte-identical to 0.87.0 (the guarded SHA-256 remains `d365ffb5a189915c3af93953daf751bff45fe46222b05c426f8d8b845946bebf`). The explicit package-version guard was advanced after that comparison. Typecheck and tests required no runtime compatibility changes. Notice generation and its release test now identify 0.87.1. The curated Pi license was byte-compared with the upstream `v0.87.1` LICENSE and is unchanged.

This deliberately does not implement or alter CLI last-used-model behavior; that feature is handled separately.

## Validation

- `bun outdated`: no remaining root updates
- `bun run generate:notices`: passed; 124 production packages, 539199 bytes
- `bun run check`: passed
- `bun run format:check`: passed
- `bun run lint`: exit 0 with 276 existing warnings and 476 informational diagnostics
- `git diff --check`: passed
- `bun run test`: passed; 719 pass, 14 skip, 0 fail (733 tests / 99 files)

The test environment used `MISE_TRUSTED_CONFIG_PATHS=$PWD/mise.toml` only as a process environment variable; it did not run `mise trust`, install a global executable, or alter user state. An initial suite run without that environment emitted mise's untrusted-config warning into spawned shell stdout and caused 10 output-exactness tests to fail; all affected tests passed in focused reruns with the process-local setting.

## Location and remaining concerns

- Worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_65e8e889`
- Branch: `die/update-project-dependencies-65e8e889`
- No live paid-provider/LLM test was run.
