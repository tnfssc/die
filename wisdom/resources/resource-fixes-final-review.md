# Resource fixes v0.4.0 — final release review

## Verdict

**No remaining release blocker found.** The integrated history publication/cleanup followups address the previously demonstrated inconsistent collision and pending-spool leaks, and the release/version/docs surface is coherent for v0.4.0. No publish, tag, install, or product-source edit was performed in this review.

## Reviewed

- Read `resource-fixes-release.md` and `resource-fixes-history-followup.md`; inspected the current history store/manager and agent-session ownership paths plus their regressions.
- First-assistant publication now commits indexes/manager state only after exclusive publication succeeds; collision rollback preserves both the prior pending state and destination, and retry is covered.
- Known temporary managers are explicitly disposed across preparation, open/continue replacement, branch/fork, and failure paths; finalization remains only an abandoned-owner fallback.
- `package.json`, generated `runtime-assets/package.json`, and the compiled candidate report `0.4.0`; `validate-release-tag.ts v0.4.0` passes. No local `v0.4.0` tag exists yet, as expected before release.
- Release workflow still validates tag/package agreement, builds all four advertised targets, checks the x64 binary version, creates per-asset checksums/source metadata, and now gates the added backend/client resource regressions. Workflow YAML parses.
- README and history/resource docs consistently describe v0.4.0 behavior without claiming flat total RSS or deleting durable history. The pinned Pi version/hash guard and canonical web patch are present; `web/t3.patch` SHA-256 is `60243189e9169193a3b4d4724a16c4413ac15b455ea922a4220b4636f7abf3cd`, matching the integration record.

## Validation (`TMPDIR=/var/tmp`)

- Focused history suites: **14 pass, 0 fail**.
- Final current-source build plus full deterministic suite: **675 pass, 14 skip, 0 fail** across 95 files.
- Standalone smoke from the final build: **pass**; compiled `dist/die --version`: **0.4.0**.
- Typecheck, format check, lint (warnings only), `git diff --check`, and v0.4.0 tag validation: **pass**.

Local caveat only: this checkout's default `.cache/die-t3code` is stale and is intentionally rejected by the source-pin guard. Final build/smoke used the documented current `DIE_T3_SOURCE=.cache/die-t3code-v0042`. The release workflow starts from a clean runner and fetches the pinned revision, so this is not a release defect. Official CI asset/checksum check remains the normal post-tag publication step.
