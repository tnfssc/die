# Wisdom rename design discussion

The user wants the durable project context system called **wisdom**. Prompt language should drive the design, not the old wisdom/memory code.

Current direction:
- Call it wisdom in concepts and user-facing text, not memory or notes.
- Location should be root `wisdom/`, not `wisdom/`.
- Organize wisdom by feature or system, not into decision, audit, and handoff buckets.
- Do not require an index. Agents should find and read the feature wisdom they need.
- Do not add a pending queue or consolidation ceremony. Agents write straight to the relevant wisdom files.
- `docs/` is confusing as an agent storage target; durable written project context should live in wisdom. Source/tests/config stay in their normal locations.
- Prompt style must follow existing vetted prompts: short, direct, operational. Do not derive language from current wisdom/index mechanics.

Candidate prompt replacement:
```md
Next agent not hear whole talk. Save decisions, reasons, and where work stopped. No need copy whole conversation.

Work not done if next person cannot pick it up. Leave code and wisdom together, where others can get both. Say what finished and what still needs care.

Project wisdom lives in wisdom/. Put it with the feature or system it explains. Need past context? Read the wisdom that helps with this task.
```

Implementation implications noticed:
- Current `src/memory/*` mainly supports `/memory`, pending notes, consolidation receipts, topic index.md files, and safety checks.
- Tests: `tests/memory-store.test.ts`, `tests/memory-extension.test.ts`, `tests/memory-extension-integration.test.ts` are tightly coupled to pending/index/consolidation.
- Avoid blanket replacement: many "memory" uses are RAM/in-memory/resource memory and should stay.
- Historical records may keep old names when true at the time; live prompts/current framing should change.

## Implementation pass 2026-09-22

Installed the prompt-first wisdom model:
- Added `src/prompts/wisdom.md` with vetted short operational language.
- Added `src/wisdom/extension.ts`; root agents get wisdom guidance and `/wisdom` reports the location.
- Removed pending/index/consolidation implementation files and memory extension tests.
- Replaced memory prompt references in task registration with project wisdom.
- Moved tracked `wisdom/` and `docs/` Markdown into root `wisdom/`; renamed the old mandatory `index.md` to `project-history.md`. Existing historical prose may still mention old names where true at the time.
- Moved old untracked pending Markdown files directly into `wisdom/` and removed the pending folder.

Validation so far: `bun run format:check && bun run check` passed; focused wisdom/prompt/main SDK tests passed. Full `bun test ./tests` without rebuild reached tests but CLI tests failed because dist was stale. `bun run test` attempted rebuild but failed in web-source verification with out-of-diskspace writing `/tmp/die-web-source-*/index.lock`; this is an environment/storage blocker, not a TypeScript failure. `bun run lint` exited 0 with existing warnings.

Cleanup: removed the failed build cache directory `.cache/die-t3code-b488c57f3f9f1688e31c53daee99e29dd1d0baa2` after the out-of-diskspace build failure.

## Organization pass 2026-09-22

Organized root wisdom files into feature/system folders such as prompts, worktrees, t3, web, native, resources, history, releases, tasks-ui, compaction, packaging, and wisdom-system. Updated README/CONTRIBUTING/script links and Markdown links inside wisdom. Link check found 0 broken Markdown links after the move. Validation: `bun run format:check && bun run check` passed.
