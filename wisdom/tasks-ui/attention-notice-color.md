# Normal-color task attention notices

Branch: `die/use-normal-color-for-task-attention-noti-044025a7`. Worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_044025a7`.

The CLI task notice renderer lives in `src/ui/execution-previews.ts` (`completionPreview`), registered by `src/agent/extension.ts`. Attention-only notices used the warning theme color in both collapsed and expanded form; mixed completion batches also colored individual attention indicators warning yellow. Render ordinary attention text without a theme color while keeping its visible ⚠ label and task ID. Do not change the notification scheduler or warning/error rendering for unresolved task status and failed tasks. A mixed batch can still show red failure and normally colored attention side by side.

Regression: `tests/execution-previews.test.ts` checks collapsed/expanded attention, mixed attention and omitted attention colors, and retained failure color. Focused test: 23 passed; `tsc --noEmit` and Biome format pass after `bun run prepare:assets`. This is a renderer-level check, not an interactive terminal screenshot.

Values review: this follows “show what is real” and “use simplest thing that works”; attention stays visible without falsely implying a warning. No values.md change: existing guidance covers this feature-local styling distinction.
