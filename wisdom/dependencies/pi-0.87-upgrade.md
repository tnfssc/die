# Pi 0.87 upgrade

Integration worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_6de63bb9`
Branch: `die/implement-pi-0.87-compatibility-6de63bb9`

Baseline HEAD was 8d8f068e90d580b7a53583fdc41e7636926ea346 with Pi 0.85.1. This upgrade owned four dependencies, the lockfile, the SessionManager source-hash guard, source changes, and SDK tests. It did not own a T3 upstream pin change, push, tag, or release.

Delegated worktrees used the same path prefix with these suffixes:

- History adapter and parity: `-a86675007a5e-task_7bb3d9d3`, branch `die/migrate-disk-backed-pi-history-7bb3d9d3`.
- Compaction and continuity: `-a86675007a5e-task_0c845e39`, branch `die/migrate-compaction-and-instruction-conti-0c845e39`.
- Patched web audit: `-a86675007a5e-task_7e0d8b25`, branch `die/audit-patched-web-pi-integration-7e0d8b25`.

Early findings:

- The provider stream boundary accepts branded `TranscriptContext` with messages only. Use `normalizeContext` to build old-style contexts. Use `getCurrentSystemPrompt` and `getCurrentTools` replay helpers to inspect them. Structural typing can hide runtime breaks in prompt preview, goals SDK, and prompt-delivery tests.
- Pi 0.87 removes `openai-codex` `gpt-5.4-mini` from its catalog. The negative allowlist test now passes an explicit model fixture.
- `JsonObject` and `JsonValue` are stricter. Test fixtures now use JSON-safe types.
- The SessionManager guard hash moved to the installed 0.87 source. Review and parity checks were still needed before acceptance.

Validation later finished. Disposable detailed logs are under `/tmp/pi-*.log`.

## Integrated findings

- The history adapter now implements `buildSessionProjection` and `appendContextEdit` with lazy metadata. Isolated subprocess tests compare it with the unchanged SDK. Coverage includes replacement and omission, custom and tool messages, reopened projections, unchanged originals, branch isolation, bad targets, repeated compactions, system checkpoints, and thinking and model state.
- Instruction continuity now keeps Pi 0.87 run prompt options instead of changing readonly state. Compaction uses normalized transcript messages. System-only histories are rejected. Input budgets count the system and tool frame once.
- Shake accounting passes through the new recovery tool-results argument. A real SDK regression covers interrupted assistant and tool-result context edits; it fails if the forwarding is removed. The recovery fixture uses real OpenAI overflow text and enough context for Pi 0.87's cautious durable-projection estimate.
- TUI fixtures pass `--no-approve` and ignore project-local resources. This avoids the new trust prompt only in isolated test projects. Production trust behavior stays the same.
- Notices use the upstream Pi v0.87.0 LICENSE, checked byte-for-byte against the curated copy. It did not change. The version pin and source URL changed. New `proxy-agent-negotiate@1.1.0` has no published or upstream package-level license file. `third_party/README.md` records the curated MIT text and author metadata.

## Web review

T3 stays pinned at a9b49a7df0a4261dcc438d4493cc3154a1d9819e. Pi RPC declarations are byte-for-byte the same as 0.85.1. Runtime `steer` and `follow_up` now call extension input hooks with source `rpc`. Our generated extension does not add such a hook. Generated MCP schema typing now derives the `registerTool` parameters type. The worker checked patched-server TypeScript, four extension-source tests, generated-extension typecheck against real Pi 0.87, and one RPC `get_state` smoke. No paid model or real MCP tool round trip ran. Third-party input hooks can still change or block steering.

## Validation environment

`/tmp` was a nearly full 16 GiB tmpfs because of unrelated data. Early standalone copy tests failed with `ENOSPC`. Final checks used `TMPDIR=$PWD/.cache/test-tmp` on disk. Temporary test projects were disposable and ignored. They were not implementation worktrees.

The history SDK soak passed with 512 original messages, 16 real compactions, a 128 MiB journal, and 0.99 MiB final heap growth.

## Final validation

- `TMPDIR=$PWD/.cache/test-tmp bun run test` passed. It included the full web build and server typecheck, standalone compile, and all tests: **741 pass, 14 skip, 0 fail**, 755 tests in 101 files. Skips were opt-in live or model tests.
- `bun run check` passed.
- `bun run lint` exited 0 with 277 warnings and 454 informational diagnostics, and no errors.
- `bun run format` and `bun run format:check` passed.
- `bun run generate:notices` passed: 124 production packages and 539199 bytes.
- `git diff --check` passed.
- The history SDK soak and delegated web checks passed as described above.
- No push, tag, release, main-worktree change, or T3 pin update happened.

All component commits were squashed into one integration-branch commit. It can be cherry-picked as the full upgrade.
