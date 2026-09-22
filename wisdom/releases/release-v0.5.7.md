# v0.5.7

- Rename project memory/notes to project wisdom in prompts, commands, source names, and user-facing guidance.
- Store durable project context in root `wisdom/`, organized by feature/system instead of `.agents/notes` or `docs`.
- Remove the pending/index/consolidation memory flow; agents now write useful wisdom directly where future work can find it.

No model/provider behavior changes beyond the project wisdom guidance.
