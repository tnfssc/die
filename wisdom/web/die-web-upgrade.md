# Official T3 upgrade (in progress)

## Ownership
Upgrade orchestrator owns ONLY /home/tnfssc/Code/die-research/t3code-upgrade and this wisdom file. Main owns launchers/packaging/canonical pin+patch/install after validation. Old dirty t3code and installed ~/.local/bin/die{,-web} are read-only and untouched.

## Fetched baseline
Official https://github.com/pingdotgg/t3code.git HEAD fetched 2026-09-14T11:04:23Z (HTTPS with global git rewrite disabled), exact clean pin **6f00d3881a197dd33c2cb43c6a11a9e759e56089**, commit date 2026-09-14T16:15:43+05:30 (=10:45:43Z), subject fix(web): remember panel width for each thread (#11310). Detached separate checkout, no old fork history applied.

## Port work
Official has no native Pi driver. Provider architecture now uses per-instance Drivers and modern Effect APIs; old fork integration must be adapted. Worker task_a254b4c5 owns server provider/**; task_32371773 owns packages/** and web/**. Orchestrator owns outer server startup/settings wiring. task_5516993a read-only audits new CLI/build contract. Pi RPC behavior copied surgically from read-only working old tree including canonical six-file Die fixes; sparse task start/completion only, native Agents, real models, no optional MCP in explicit Die mode, original-turn late completions.

Local pnpm frozen-lock install underway, TMPDIR=/var/tmp/die-web-upgrade HERD=0. No credentials or external model calls. Packaging/runtime details and validation results to follow.

## Early packaging/runtime contract (verified source)
- **Keep --base-dir PATH**, not --home: apps/server/src/cli/config.ts:34 defines base-dir; T3CODE_HOME remains equivalent, userdata/settings.json layout unchanged. Exact fetched HEAD contradicts anticipated --home change.
- No subcommand needed: bin.ts root handler calls runServerCommand(flags), same as start; serve forces headless pairing output. Current forwarded --host/--port/--no-browser remain supported.
- Seed modern providerInstances.pi = {driver:"pi",enabled:true,config:{binaryPath:absoluteDie}} while preserving unrelated settings. Port worker may maintain legacy providers.pi recognition, but instance config is canonical. DIE_WEB_DIE_BINARY stays explicit Die-mode marker.
- Existing pnpm --filter @t3tools/web build and pnpm --filter t3 build:bundle script names remain; underlying tools now vp build/vp pack. Keep apps/web/dist -> apps/server/dist/client and production deploy externals. dist/bin.mjs still correct entry, Node engine ^22.16 || ^23.11 || >=24.10 (launcher execve requires sufficiently recent Node). Native externals maintained in scripts/lib/cli-external-packages.ts.
- Frozen local dependency installation succeeded. Startup Pi actual-default port added; 18 startup tests passed. Early full server typecheck caught in-flight provider port errors and extra test context requirements; not final result.

Startup validation: 22 tests passed across serverRuntimeStartup.test.ts and orphanedProviderSessionStartup.integration.test.ts. Modern project.create ignores defaultModelSelection; in explicit Die mode newly bootstrapped projects receive project.meta.update carrying actual discovered Pi model, then thread.create uses same selection. Explicit existing server/project defaults remain honored. New auth/config files appeared in checkout from another owner (not orchestrator or either assigned worker): auth/DieWebAuth*, EnvironmentAuth.ts, cli/config.ts, config.ts. Leaving them untouched; main must coordinate capture.

## Completed port and validation (2026-09-14T11:15Z)
- Pi driver registered in current builtInDrivers; Pi RPC client/schema/session-file/model handling and adapter/provider tests ported from old working tree. No old fork commits cherry-picked. Current native provider instance model selector and Agents runtime event contracts retained.
- PiSettings + modern schema integration, Pi UI metadata/icon recognition, native selector tests completed by contracts/web worker.
- Orchestrator added PiTextGeneration.ts and seven fixture-only tests, modern Schema decoding APIs. Root actual-model bootstrap uses explicit settings when present; otherwise Pi refresh + actual discovered default, no invented model. Newly created Die workspace default stored via project.meta.update because modern project.create ignores old seed.
- Frozen pnpm install PASS. Contracts typecheck PASS, web typecheck PASS (worker). Full server typecheck PASS (exit 0, upstream Effect suggestions only): /var/tmp/die-web-upgrade/server-typecheck-final.log.
- Contracts/UI targeted tests: 187 PASS (worker). Combined server provider/RPC/startup/text-generation/integration run: 119 PASS in 8 files; additional PiSessionFile tests: 4 PASS. See combined-tests.log, sessionfile-test.log. Earlier provider worker run 92 PASS; later combined run includes its final driver test additions.
- Web production build PASS (large chunk/plugin timing warnings only): web-build.log. Server bundle PASS: server-build.log. Copied web dist into external apps/server/dist/client only; no deployment/install performed. Bundled CLI --help PASS, confirms --base-dir not --home: cli-help.log.
- Formatting and git diff --check PASS. Provider targeted lint PASS (worker); outer lint result follows.

## Deliverable snapshot
External checkout HEAD remains exact official **6f00d3881a197dd33c2cb43c6a11a9e759e56089**. Complete working diff captured to **/var/tmp/die-web-upgrade/t3-upgraded.patch**, 365284 bytes / 34 files including 17 new/untracked files, timestamp ~11:14Z. Captured tracked diff plus each git ls-files --others --exclude-standard file; no untracked port file omitted. Verified git apply --cached --check against exact HEAD using isolated /var/tmp/die-web-upgrade/validation.index (real checkout index unchanged). Snapshot includes concurrently supplied auth/config changes; this owner did NOT implement those. Main should recapture after its auth/browser work if further edits occur. Status inventory: working-status.txt.

## Remaining main validation/ownership
No known Pi-port build/typecheck blocker. Main still owns installed-equivalent browser verification, launcher/providerInstances seed/auth contract decisions, canonical pin+patch/build/install. No claim of browser/runtime acceptance yet; no installation or user server touched, no real credentials/API/model calls used. All non-note core repo files and old dirty t3code checkout remain untouched by this owner/workers.

Outer startup/text-generation/integration targeted lint PASS (exit 0): /var/tmp/die-web-upgrade/outer-lint.log. All owned jobs complete.
