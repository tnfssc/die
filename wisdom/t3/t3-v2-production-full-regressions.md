# T3 v2 production full-suite regression triage

Status: complete (2026-09-21)

## Edit ownership / concurrency

This worker edited only the candidate checkout `.cache/die-t3code-v2-production` files listed below. Did not change native acceptance, root implementation source, browser/web source, or build configuration. Browser work was concurrent.

## Baseline

Broad root-config run `/var/tmp/t3-production-candidate-full-tests.log`: **18,077 passed, 9 failed**, plus 6 suite/config failures.

## Candidate fixes

- `apps/server/src/mcp/OrchestratorMcpToolkit.integration.test.ts`
  - Updated both post-cancel durable delegated-task expectations from `interrupted` to `cancelled`. Provider runs are interrupted first, but the new durable task terminal is deliberately `cancelled`. Kept checks that completion delivery is disposed.
- `packages/shared/src/t3McpToolPresentation.ts`
  - Added complete presentation/summary definitions for all four published native Die tools. This closes the actual catalog/schema invariant failure rather than weakening `core.test.ts`: every published object-root, reference-free tool schema still must resolve to non-null lifecycle metadata.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts`
  - Preserved the production allowlist. Read-only annotations do **not** automatically grant native Die APIs to Claude; `die_task_*` is an intentionally privileged namespace. The mapping test now excludes it and explicitly asserts no Die API is pre-approved.
- `apps/server/src/provider/Layers/ProviderRegistry.test.ts`
  - Scoped Codex reprobe assertions to Codex commands and separately needs the expected new `die` provider probe. This preserves both behaviors instead of hiding the new probe.
- `apps/server/src/orchestration-v2/ProviderSessionManager.ts`
  - Raised the still-bounded per-subscriber event burst budget from 256 to 2,048. The deterministic proposed-plan Codex recording normalizes to more than 1,024 events synchronously; 256 and 1,024 both caused the explicit overflow path and failed the provider turn. 2,048 passes while retaining dropping-queue overflow failure semantics (no silent loss/unbounded queue).

## Replay diagnosis

`proposed_plan/codex` was not an expected-output drift. Instrumenting the redacted provider failure showed the exact cause: `Provider event subscriber exceeded 256 queued events`. It had already produced the proposed plan, then durable run finalization recorded a generic provider failure. A 1,024 trial still overflowed; 2,048 passed. Temporary diagnostics were removed.

## Configuration/environment classifications

- Three `.github/scripts/*.test.cjs` files are Node `node:test` suites, not Vitest suites. Root `vp test` reports “No test suite found”; correct command `node --test ...` passes **34/34**.
- Ghostty web WASM failures came from running web tests under root Vite config, which parsed `*.wasm?inline` as JS. Running from `apps/web` with its unit project passes **76/76**. No web source/config change made.
- Both Git failures were root-run interference/config effects. Running from `apps/server` passes **98/98**. No Git expectation/source change made.
- WSL remains an environment-fixture failure (**48 pass, 2 fail**) even under `apps/desktop`. Both failing tests fake an active runtime with `sh -c "sleep 30" "$runtime/t3"`; on this Linux host the inner shell execs `sleep`, so `/proc/*/cmdline` no longer contains the runtime path. The production prune script so correctly sees no path-owned process. This is test process simulation portability, not the candidate runtime behavior, and was not loosened.
- One later rerun initially hit `ENOSPC` because `/tmp` tmpfs was full of week-old `runtime-recheck-*` directories; stale directories were removed and replay reruns proceeded.

## Verification

- Core toolkit + Claude mapping + ProviderRegistry: **174/174 passed**.
- Orchestrator MCP integration: **2/2 passed**.
- Proposed-plan/Codex replay with 2,048 bound: **passed**.
- Web Ghostty package-config rerun: **76/76 passed**.
- Git package-config rerun: **98/98 passed**.
- GitHub Node suites: **34/34 passed**.
- `git diff --check` was clean for owned edits; a concurrently edited `ProviderSessionManager.test.ts` later acquired trailing whitespace and an unrelated exact-PID timing failure, which this worker did not alter.

## Files owned by this triage

- `.cache/die-t3code-v2-production/apps/server/src/mcp/OrchestratorMcpToolkit.integration.test.ts`
- `.cache/die-t3code-v2-production/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts`
- `.cache/die-t3code-v2-production/apps/server/src/orchestration-v2/ProviderSessionManager.ts` (capacity constant/comment only)
- `.cache/die-t3code-v2-production/apps/server/src/provider/Layers/ProviderRegistry.test.ts`
- `.cache/die-t3code-v2-production/packages/shared/src/t3McpToolPresentation.ts`
