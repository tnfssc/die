# Worktree subagent prompt review

Read-only review complete. `task_b210d06d` owned the implementation. I changed no prompts, source, or tests. I ran no build or shared server. This wisdom file was my only change.

## Sources reviewed

- `wisdom/prompts/prompts.md`, `wisdom/prompts/system-instructions.md`
- `src/prompts.ts` and all `src/prompts/*.md`
- `scripts/prompt-preview.ts`, `src/prompt-preview.ts`, and prompt/system/delivery tests
- September prompt review/iteration/shared-memory notes
- active workspace brief plus worktree design, CLI lifecycle, setup/config, web integration, and investigation conclusions
- current dirty implementation/API seams, without editing them

The project voice points to a small change. Keep the exact API in `execute.md`. Put one short judgment in role prose. Do not hide prose in TypeScript or add a long rule list.

## Minimal recommended prompt changes

### 1. Keep the exact API in `src/prompts/execute.md`

Update the launch signature to the final built shape, for example:

`await subagent({ type?, title?, prompt, workspace?, waitSeconds?, timeoutSeconds? })`

Beside it, document the type exactly rather than explaining it loosely:

- `title`: optional short task label.
- `workspace`: `{ kind: "inherit" } | { kind: "worktree", baseRef?, branch? }`; defaults to `{ kind: "inherit" }`.

Keep `prompts: string[]` batch wording, but say exactly whether one supplied `title`/`workspace` applies to every child. The approved behavior says each worktree child is separate and the batch base is pinned once; that is runtime/API behavior worth documenting if the final schema supports a batch with these fields.

Do not put setup implementation detail into the signature bullet. Add at most two capability bullets, phrased by execution context rather than internal product/code names:

- Worktree launch creates a Git worktree and starts the child there. In CLI use, repository `t3.json` supplies worktree setup when configured. In configured web use, the web project's configured setup applies.
- Worktree launch needs a Git repository. State any other current unsupported combinations from the final implementation exactly; do not freeze phrases such as “server-scoped native”, internal task IDs, or backend ownership if those distinctions are already changing.

The current native-limitations bullets in `execute.md` are precise for today's native async feature but are likely to become stale around this combined PR. Recheck them against the final routing matrix. Describe observable behavior: which options are accepted, whether launch is async-only, and which `jobs.*` calls work. Avoid architecture labels when a user-facing condition such as “configured web session” is sufficient.

Do not teach agents Git commands, branch naming recipes, setup ordering, cleanup, or PR procedure here. The structured option requests the workspace; runtime owns safe preparation.

### 2. Add one judgment sentence only to delegation-capable role prose

Use the same short sentence in `main-orchestrator.md` and `orchestrator.md` (or a single shared assembly source if implementation already has one):

> Independent code or PR work? Give it a worktree. Research or shared edits? Keep the current workspace.

This captures the requested choice without making tools a mandatory workflow. It also avoids telling fast/normal leaves about a tool they cannot use. No change is needed in `system.md`, `fast.md`, or `normal.md`.

“Independent” means file changes that should not collide and work intended to become its own branch/PR. “Inherit” is still right for read-only investigation and deliberately coordinated edits in the parent's checkout. These explanations belong in project docs/tests if more detail is needed, not as more model rules.

### 3. Update documentation mirrors, not assembly code

After final runtime names and limitations settle:

- update `wisdom/prompts/system-instructions.md` so its assembled reference shows the exact new API and current limitations;
- update the source/inclusion map in `wisdom/prompts/prompts.md` only if source or inclusion conditions changed;
- do not add hardcoded workspace prose to `src/prompts.ts`.

CLI setup and web setup are deliberately different sources: CLI directly uses Git and the repository's existing `t3.json` declaration without starting/reading the web server or DB; web uses the already configured project setup. Say “when configured” so absence of setup is not represented as failure or as a hidden shared setting. Do not promise import/export, a new config format, auto cleanup, sidebar grouping, PR automation, or repeated follow-up sync.

## Offline verification without a paid model

The existing preview is the correct end-to-end boundary: it uses production Pi assembly and extension hooks, replaces the model stream locally, reports `networkRequests: 0`, and captures exact `systemPrompt`, tools, and messages.

Manual inspection commands after edits:

`bun run prompt:preview -- --role root --mode orchestrator`

`bun run prompt:preview -- --role orchestrator`

`bun run prompt:preview -- --role normal`

For override behavior, create a temporary project with `.die/SYSTEM.md` and `.die/APPEND_SYSTEM.md`, then run:

`bun run prompt:preview -- --project /path/to/temp --role orchestrator`

Check the captured JSON, not terminal presentation:

- exact `subagent` signature/type/default and setup/capability prose appear once where intended;
- root orchestrator and child orchestrator contain the isolation judgment;
- fast/normal child role injection is still correct and does not gain orchestrator judgment;
- custom base replaces Die's base as today, append is still appended, while extension-owned role/API injection follows the existing contract;
- no network/model request occurs.

Add focused assertions to `tests/prompts.test.ts` for source text/API/default and role guidance, and to `tests/prompt-preview.test.ts` for real assembly across root orchestrator, child orchestrator, normal child, and custom SYSTEM/APPEND. Keep schema/runtime acceptance tests with the implementation owner (local CLI, configured web, batch propagation, invalid workspace fields, Git/setup behavior). Existing `tests/prompt-delivery.test.ts`, `tests/system-prompt.test.ts`, and `tests/provider-prompt.test.ts` cover delivery boundaries and provider serialization; include them in the offline run if touched.

Suggested targeted run:

`bun test tests/prompts.test.ts tests/prompt-preview.test.ts tests/prompt-delivery.test.ts tests/system-prompt.test.ts tests/provider-prompt.test.ts tests/subagent-extension.test.ts tests/job-bridge.test.ts`

No `DIE_RUN_LLM_TESTS`, credentials, paid provider, build, install, or live web server is needed for prompt confidence.

## Decisions / cautions

No new user decision is needed for prompt wording. The current request resolves the earlier note conflict in favor of structured `workspace.kind` with optional `baseRef`/`branch`, default inherit.

One implementation fact must be confirmed before final prose lands: the exact accepted combinations and limitations for root/local/configured-web/nested orchestrator and batch calls. This is not a product-feature question; derive it from the merged schemas and tests, then document only what is true. If implementation and approved behavior differ, ask the user rather than papering over the mismatch in prompt text.
