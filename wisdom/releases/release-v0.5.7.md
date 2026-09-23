# v0.5.7

- Rename project memory and notes to project wisdom in prompts, commands, source names, and user guidance.
- Store lasting project context in root `wisdom/`. Group it by feature or system instead of using `.agents/notes` or `docs`.
- Remove the pending, index, and consolidation memory flow. Agents now write useful wisdom where later work can find it.

Model and provider behavior do not change. Only the project wisdom guidance changes.
