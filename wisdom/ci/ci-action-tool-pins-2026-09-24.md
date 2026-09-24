# CI/action/tool pin audit — 2026-09-24

Worktree branch: `die/ci-and-tool-version-audit-3ae322be`

Scope: only .github workflows, `mise.toml`, runtime attribution script, associated tests and this audit. No push, tag, publish or manifest/lockfile edits. All workflow actions are pinned to immutable **commit** SHA (the pnpm v6.1.0 annotated tag resolves to a different tag-object SHA, not used as the action ref). Checked official GitHub release endpoints and refs, action.yml/README at corresponding tags on 2026-09-24:

| Action | Official release | Commit pin | Runtime |
| --- | --- | --- | --- |
| [actions/checkout](https://github.com/actions/checkout/releases/tag/v7.0.1) | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | node24 |
| [actions/setup-node](https://github.com/actions/setup-node/releases/tag/v7.0.0) | v7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` | node24 |
| [actions/upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) | v7.0.1 | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | node24 |
| [actions/download-artifact](https://github.com/actions/download-artifact/releases/tag/v8.0.1) | v8.0.1 | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` | node24 |
| [pnpm/action-setup](https://github.com/pnpm/action-setup/releases/tag/v6.1.0) | v6.1.0 | `ea17c68df8912ef543352723c149a84f56e3d413` | node24 |
| [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun/releases/tag/v2.2.0) | v2.2.0 | `0c5077e51419868618aeaa5fe8019c62421857d6` | node24 |

Tool versions: [Node v24.21.0](https://github.com/nodejs/node/releases/tag/v24.21.0) (latest release on v24 line; v26.10.0 latest overall), [pnpm v11.27.1](https://github.com/pnpm/pnpm/releases/tag/v11.27.1) (latest v11; v12.5.1 latest overall), [Bun bun-v1.4.2](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2) (latest release). `mise.toml` and workflow Bun pins agree. Bun 1.4.2 upstream `LICENSE.md` fetched from the tag was byte-for-byte identical to existing `third_party/bun/LICENSE.md`, so only the attribution runtime/version URL changed; no vendored license rewrite.

Compatibility: node24 actions require Actions Runner >=2.327.1 ([checkout README at v7.0.1](https://github.com/actions/checkout/blob/v7.0.1/README.md)); checkout's Docker-container-action credential integration additionally requires >=2.329.0, not used here. These workflows use GitHub-hosted ubuntu-24.04/macos-15, not self-hosted runners. checkout v7 stores persisted credentials in RUNNER_TEMP rather than .git/config; existing workflows use their own checkout and do not read .git/config tokens. setup-node v7 is ESM and no longer exports dummy NODE_AUTH_TOKEN; no workflow relies on it. download-artifact v8 ESM is transparent to action callers. upload-artifact v7 adds direct-upload option, but default `archive: true` preserves zipped upload/download; jobs continue to transfer the raw release asset directory via same-run named artifacts. upload/download v4+ already had GHES limitations; this repository uses github.com. pnpm/action-setup v6 supports pnpm 11; setup-bun v2.2.0 moves to node24. No write token was granted to testing or artifact jobs; the publish job alone retains contents:write under the existing tag guard.

Deferrals: Node v26 and pnpm v12 cross major versions and need separate dependency/T3 validation; no change to lockfiles or package manifests. No GH-hosted macOS/Linux CI run from this worktree, so runner-level compatibility remains for parent PR CI to establish. No release/tag created.

Checks: `bun test tests/release-workflows.test.ts --test-name-pattern "workflow|CI is|tag release|stable publication|macOS Live"`: 5 passed, 7 filtered, 0 failed (local installed Bun 1.4.1). Full file: 10 passed, 2 failed because this isolated worktree has no `node_modules` for notice generation/vendor file tests. `git diff --check` passed. Run full CI and release workflow gates in PR before relying on binary production behavior.

Values unchanged: existing [know what a change means](../values.md) and [leave user's work safe](../values.md) already cover runtime major analysis and scoped pin updates; this audit is local CI guidance.
