# Pi 0.87.1 dependency update

Date: 2026-09-23

## Scope

The four direct earendil-works Pi dependencies moved from 0.87.0 to the current stable 0.87.1 releases:

- `@earendil-works/pi-ai@0.87.1`
- `@earendil-works/pi-coding-agent@0.87.1`
- `@earendil-works/pi-server@0.87.1`
- `@earendil-works/pi-tui@0.87.1`

The new `bun.lock` also moves the resolved Pi packages `chord`, `pi-agent-core`, `pi-protocol`, and `pi-telemetry` to 0.87.1. `bun outdated` found no other root updates. No T3 source pin, patch, web dependency manifest, or vendored upstream source changed. The normal build only fetched and built the existing pinned T3 revision in ignored cache and output directories.

## Compatibility and notices

Pi 0.87.1's `dist/core/session-manager.js` is byte-for-byte the same as 0.87.0. The guarded SHA-256 stays `d365ffb5a189915c3af93953daf751bff45fe46222b05c426f8d8b845946bebf`. The explicit package-version guard moved forward after that check. Typecheck and tests needed no runtime compatibility change. Notice generation and its release test now name 0.87.1. The curated Pi license was compared byte-for-byte with the upstream `v0.87.1` LICENSE and did not change.

This work does not add or change CLI last-used-model behavior. That feature is separate.

## Validation

- `bun outdated`: no root updates left
- `bun run generate:notices`: passed; 124 production packages, 539199 bytes
- `bun run check`: passed
- `bun run format:check`: passed
- `bun run lint`: exit 0 with 276 existing warnings and 476 informational diagnostics
- `git diff --check`: passed
- `bun run test`: passed; 719 pass, 14 skip, 0 fail (733 tests / 99 files)

The test process set `MISE_TRUSTED_CONFIG_PATHS=$PWD/mise.toml` only in its own environment. It did not run `mise trust`, install a global executable, or change user state. An earlier suite run lacked that setting. Mise wrote its untrusted-config warning into child shell output, which broke 10 exact-output tests. Focused reruns passed with the process-only setting.

## Location and remaining concerns

- Worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_65e8e889`
- Branch: `die/update-project-dependencies-65e8e889`
- No live paid-provider or LLM test ran.
