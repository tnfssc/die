# Web runtime ffi-rs optional dependency portability fix

User reported `die web` on macOS arm64 failed with missing `@yuuang/ffi-rs-darwin-arm64` from extracted embedded web runtime. Root cause: Die builds and embeds the T3 pnpm deploy output on Linux, and upstream `pnpm-workspace.yaml` limited `supportedArchitectures` to current/linux x64 glibc. pnpm therefore omitted ffi-rs optional native packages for darwin arm64.

Changes made:
- `web/t3.patch`: patches T3 `pnpm-workspace.yaml` supportedArchitectures to include darwin/linux/win32, x64/arm64/ia32, glibc/musl.
- `scripts/build-web.ts`: after `pnpm deploy --prod --legacy`, verifies the deployed web runtime contains required `@yuuang/ffi-rs-*` optional packages, including `@yuuang/ffi-rs-darwin-arm64`. This prevents rebuilding a Linux-only archive silently.

Validation:
- `bun run check` passed.
- Applied `web/t3.patch` to a fresh archive of pinned T3 HEAD with `git apply --check`: passed.
- Parallel research confirmed pnpm supportedArchitectures is preferred for reproducible cross-platform optional deps; CLI alternatives are repeated `--os/--cpu/--libc` flags.

Not done:
- Did not run full `bun run build:web`/full web rebuild (expensive). Current `dist/die-web` is still old Linux-only output until rebuilt. A release/install should rebuild and verify extracted cache hash changes.

## Release and independent recheck in progress
User authorized release then requested independent double check. Earlier agent mistakenly created v0.4.1 from stale feature branch ff12e46; canceled run 35631726516, deleted tag before publication. Correct release worktree /tmp/die-release-051 based on origin/develop 0f8a32e (v0.5.0 already published). Commit 88601988af280e1bf9a95415401cffd55c86293b, tag v0.5.1 pushed. Run 35631908982 underway, watch job task_a8ffc9ef. No local install. Worktree format/lint/check passed. Original workspace remains old feature branch, do not release from it.
Recheck workers task_2f471097 (static independent native dependency audit) and task_245d2637 (isolated install/deploy/archive extraction actual native binary resolution). Need collect results, address real issues and verify official artifacts before saying fixed. Guard currently checks ffi-rs package.json only, not actual binary; --reuse-web bypasses guard. Architecture matrix includes unnecessary Windows/ia32 but omits Android despite Android executable asset; investigate reachability rather than assuming supported web. No macOS execution yet.

Independent focused reproduction PASS: task_245d2637 used exact release pnpm 11.10.0 via Corepack, isolated /var/tmp/die-ffi-audit.8bu4JK. Frozen install + legacy prod deploy contains all nine ffi packages and all eight fff-bin companions. ffi darwin module resolves FROM ffi-rs index; fff companion likewise. Both Mach-O arm64. Archive/extract via production helper preserves resolution and SHA256 after existing t3 self-symlink adjustment. This is focused fixture evidence, not full release binary or macOS execution. Static worker still running.

Static audit task_2f471097: mac/Linux fix sound but not universal portability: Android omitted and upstream fff lacks Android implementation; pre-existing web issue, not fixed. Guard covers manifests only, not fff-bin companions or module loadability; reproduction independently verifies current Mac artifacts. Unnecessary Windows/ia32 dependencies increase shared archive size; node-pty Linux host addon nonportable but Bun PTY path bypasses it. SOURCE native asset label host-only is misleading. v0.5.1 run 35631908982 succeeded/published; official artifact validation task_a0e2f17e running (checksum/version/isolated web startup/extracted Mac dependency resolution), not installed. Need persist final release evidence in release worktree as well.

Official release verification task_a0e2f17e PASS: downloaded v0.5.1 Linux x64 and darwin arm64 assets/checksums; isolated Linux web started; extracted runtime resolves both darwin ffi-rs and fff-bin companion from actual package contexts; both Mach-O arm64. Darwin executable static arch verified, not executed on Linux. Owned process stopped/temp dir removed. No install. User now reports Pi no usable models; traced upstream warning incorrectly says pi/~/.pi, while Die runtime metadata uses ~/.die/agent and DIE_CODING_AGENT_DIR. Suggested die /login then restart web; auth investigation task_4a99fe61 active.

Standalone T3 isolation audit task_13bcfacb complete: confirms separate settings/DB/secrets/worktree data by explicit Die base-dir; browser prefs can share ONLY same exact origin; global provider CLI config/env/Git/SSH and repo t3.json shared; ambient T3CODE vars active except explicit overrides. Important qualify audit generic Pi config statement: embedded Die uses ~/.die/agent, not standalone Pi ~/.pi/agent (auth worker confirmed); sharing Pi config requires same Die binary or explicit matching override.
