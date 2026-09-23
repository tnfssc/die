# Structured worktree live validation

## 2026-09-21 — initial harness written, awaiting source readiness

I owned only `scripts/t3-v2-production/worktree-acceptance.ts` and this wisdom file. I did not edit product, backend, web, prompt, or doc source.

Initial harness now:
- fails closed on orchestrator-gave executable SHA-256 and canonical T3 checkout HEAD before allocating state;
- copies only the reviewed executable into a private `/var/tmp/die-worktree-acceptance-*` tree (mode 0700), uses private HOME/XDG/Pi/T3 state, and binds model/backend only to `127.0.0.1`;
- uses a deterministic OpenAI-compatible model with the real packaged Die, real backend and PiAdapter, plus a second Die process with no T3 MCP route for local JobService coverage;
- creates a pinned Git fixture with dirty tracked/untracked parent state, a `t3.json` setup declaration and setup audit;
- requests native batch children and local children from the same base, checks distinct paths/branches/cwd, child probes/transcripts, parent completion delivery, setup failure/cancellation retention, batch explicit-branch rejection, and process teardown;
- writes a private JSON proof and never installs, contacts network services, or mutates user state.

Static validation completed: repository Biome formatted the owned harness; `bun build ... --target=bun` parsed/bundled it to a disposable `/var/tmp` output.

Pending integration against ready source:
1. Confirm final task/workspace result shapes and adapt evidence assertions (now mostly filesystem/lifecycle based to avoid guessing field names).
2. Confirm backend setup selection for delegated children. The fixture now supplies portable `t3.json` with `async:false`. If native mode intentionally uses imported backend action settings, seed the private backend setting through its exact project identity instead.
3. Add the explicit background (`async:true`) and missing-script fixture passes. Current initial pass covers awaited success, nonzero failure and cancellation. It does not yet claim background/missing.
4. Verify the native parent model routing with multiple completion wakes and the final backend schema. Tighten exact sibling result/status checks after source lands.
5. Run only after the orchestrator gives the exact new dist path/hash and declares CLI + backend source coherent.

The current canonical target named by coordination is `dist/die-worktree-production`. But the harness still requires the exact path through `T3_WORKTREE_DIE_BINARY` and digest through `T3_WORKTREE_EXPECT_SHA256`. It does not use installed `die`.

## 2026-09-21 — harness completion against native design (static only)

Preserved the initial harness and completed the pending source-side work without running any executable:

- fixed both harness TypeScript errors by narrowing Bun's piped stdout/stderr before constructing `Response` readers;
- read the canonical backend implementation in `.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e` and the now-available `wisdom/worktrees/worktree-native-implementation.md`. The harness follows the durable `die_task_launch` path, deferred run preparation, `ThreadLaunchService.prepare`, and `ProjectSetupScriptRunner` action semantics rather than simulating them;
- split the fixture's portable local `t3.json` action from the native web action. The browser now explicitly creates `./native-setup.sh` through the real project-action UI, verifies it was persisted to private backend settings, and verifies the distinct `./local-setup.sh` declaration was not auto-imported;
- added native configured awaited, configured background, and no-config/missing-script passes. The harness proves background provider start precedes setup completion, later observes background completion, and proves the missing case executes no native setup action;
- retained nonzero setup failure and cancellation, asserted native launch workspace/base/branch/background-delivery result fields, and tightened setup owner/cwd/branch/at-most-once receipts, distinct worktree/branch checks, pinned clean-base checks, child transcript/context checks, and lifecycle evidence;
- added explicit parent completion delivery plus an editable/sendable composer probe after each native suite. So a completed child cannot leave the main thread stalled;
- kept the local path on the actual packaged Die/JobService and the native path on the actual backend/PiAdapter. No permissive backend, MCP, workspace, or process mock was added.

Static validation after these changes:

- repository Biome formatted the owned harness;
- `bun build scripts/t3-v2-production/worktree-acceptance.ts --target=bun` parsed and bundled to disposable `/var/tmp` output;
- repository TypeScript reports no errors for `worktree-acceptance.ts` (other concurrent source work is outside this ownership).

Still pending and intentionally not attempted: live execution. Wait for the coordinated coherent source declaration and exact new packaged `dist/die-worktree-production` path/SHA-256 plus canonical checkout HEAD. The harness continues to fail closed on all three identities and never falls back to an old or installed binary.

## 2026-09-21 harness recovery

- Took ownership of `scripts/t3-v2-production/worktree-acceptance.ts` live completion.
- Diagnosed prior failure as harness-only UI coupling: Playwright waited for a nonexistent `Project actions` button before any native child launch. The backend itself had started successfully.
- Replaced action-configuration UI automation with a real private `userdata/settings.json` `defaultProjectScripts` seed written before backend startup, alongside `providerInstances`. Native uses `./native-setup.sh`. Local is still the distinct repository `t3.json` `./local-setup.sh`.
- Background and missing-script phases now stop only the owned detached backend process group, verify its captured descendants are gone, update the real private settings file while stopped, restart on the same private port/base-dir, and reload the browser. Database and retained worktrees are preserved.
- Live execution against exact coordinated binary/hash and canonical checkout is starting. No product-source changes made.

## Final live result — PASS (2026-09-21T13:27:05Z)

- Exact command completed with exit 0 using `T3_WORKTREE_ACCEPT=1`, binary `/home/tnfssc/Code/die/dist/die-worktree-production`, expected/actual SHA256 `2ee093e1928fc1e12d67423c14fa01857ed962582532695063f2499678520e29`, canonical checkout `.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e`, and expected/actual HEAD `a9b49a7df0a4261dcc438d4493cc3154a1d9819e`.
- Final log: `/var/tmp/worktree-live.log`. Final proof: `artifacts/worktree-acceptance/proof.json` (`passed: true`, completed `2026-09-21T13:27:05.509Z`).
- Evidence: actual private backend + PiAdapter + relocated Die. Five-child native default-base batch. Five-child local default-base batch; 14 distinct retained child worktrees before cleanup; 13 unique child-worktree setup attempts. Native awaited/background/missing behavior. Failed/cancelled retention and provider fencing. Local/native setup distinction. Pinned common base. No dirty parent copy. Child probes/transcripts. Native parent-result delivery. Explicit batch branch rejection.
- Cleanup-enabled run removed its private temp directory and owned backend/model descendants. One stale retained diagnostic temp from an earlier KEEP run was also removed after confirming no matching processes.

### Product bug observed (not changed)

Async project setup uses `openTerminal` and derives a terminal log basename by base64-encoding the full delegated thread identifier. With a nested project-thread parent and an ordinary script id (`native-acceptance-setup`), the basename was 335 bytes and `FileSystem.access` failed with `ENAMETOOLONG`. The child was then reported as workspace-preparation failed before provider start. The harness avoids this unrelated defect with a one-character real script id and by continuing the original short parent thread across owned-backend restarts. Production source/backend/patch was not modified.
