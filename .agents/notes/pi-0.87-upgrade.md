# Pi 0.87 upgrade

Integration worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6de63bb9
Branch: die/implement-pi-0.87-compatibility-6de63bb9

Baseline HEAD: 8d8f068e90d580b7a53583fdc41e7636926ea346 (Pi 0.85.1).
Upgrade owns four dependencies, lockfile, SessionManager source hash guard, source and SDK tests. No T3 upstream pin change, push, tag, or release.

Delegated worktrees (prefix above + suffix):
- History adapter/parity: -a86675007a5e-task_7bb3d9d3, die/migrate-disk-backed-pi-history-7bb3d9d3.
- Compaction/continuity: -a86675007a5e-task_0c845e39, die/migrate-compaction-and-instruction-conti-0c845e39.
- Patched web audit: -a86675007a5e-task_7e0d8b25, die/audit-patched-web-pi-integration-7e0d8b25.

Findings:
- Provider stream boundary accepts branded TranscriptContext, messages only. Use normalizeContext for legacy construction, replay helpers getCurrentSystemPrompt/getCurrentTools for inspection. Context structural typing can conceal runtime breakages (prompt preview, goals SDK, prompt-delivery tests).
- Pi 0.87 removes openai-codex gpt-5.4-mini from catalog; negative allowlist test now supplies an explicit model fixture.
- JsonObject/JsonValue tightened: test fixtures now use JSON-safe types.
- SessionManager guard hash updated for installed 0.87 source; review/parity delegated before final acceptance.

Validation completed; final results below. Disposable detailed logs are under /tmp/pi-*.log.

## Integrated findings

- History adapter now implements buildSessionProjection and appendContextEdit using lazy metadata; parity tested against unmodified SDK in isolated subprocesses. Coverage includes replacement/omission, custom and tool messages, reopened projections, immutable originals, branch isolation, invalid targets, repeated compactions, system checkpoints, thinking/model state.
- Instruction continuity now preserves Pi 0.87 run prompt options instead of mutating readonly state. Compaction uses normalized transcript messages. Reject system-only histories and count the system/tool frame once in input budgets.
- Shake accounting forwards the new recovery tool-results argument. Real SDK regression verifies interrupted assistant and tool-result context edits; removing forwarding makes it fail. Recovery fixture uses actual OpenAI overflow text and sufficient context for Pi 0.87's conservative durable-projection estimate.
- TUI fixtures explicitly ignore project-local resources with --no-approve to bypass the new interactive trust prompt only in isolated test projects. Production trust behavior is unchanged.
- Notices: upstream Pi v0.87.0 LICENSE fetched and byte-compared to curated copy (unchanged). Updated version pin and source URL. New proxy-agent-negotiate@1.1.0 lacks a published/upstream per-package license file; curated MIT text and metadata author attribution documented in third_party/README.md.

## Web review

T3 remains pinned at a9b49a7df0a4261dcc438d4493cc3154a1d9819e. Pi RPC declarations are byte-identical to 0.85.1; runtime steer/follow_up now invoke extension input hooks with source rpc. Our generated extension does not install such a hook. Generated MCP schema typing fixed to derive registerTool parameters type. Worker verified patched server tsc, 4 extension-source tests, generated extension typecheck against actual Pi 0.87 and an RPC get_state smoke. No paid model or real MCP tool round trip was run; third-party input hooks can transform/block steering.

## Validation environment

/tmp is a nearly-full 16 GiB tmpfs (unrelated existing data); initial standalone copy tests failed ENOSPC. Final validation uses TMPDIR=$PWD/.cache/test-tmp on the disk filesystem. Temporary test projects remain disposable/ignored, not implementation worktrees. All implementation work is in persistent worktrees listed above.

History SDK soak passed: 512 original messages, 16 real compactions, 128 MiB journal, 0.99 MiB final heap growth.

## Final validation

- Full `TMPDIR=$PWD/.cache/test-tmp bun run test`: passed, including full web build/server typecheck, standalone compile, and all tests: **741 pass, 14 skip, 0 fail**, 755 tests / 101 files. Skips are opt-in live/model tests.
- `bun run check`: passed.
- `bun run lint`: exit 0, 277 warnings / 454 informational diagnostics (no errors).
- `bun run format` and `bun run format:check`: passed.
- `bun run generate:notices`: passed, 124 production packages, 539199 bytes.
- `git diff --check`: passed.
- History SDK soak and delegated web validations passed as above.
- No push, tag, release, main-worktree modification, or T3 pin update.

All component commits are squashed into one final integration commit on the integration branch so it can be cherry-picked as a complete upgrade.
