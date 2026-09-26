# CLI pending-question rendering proof (2026-09-26)

Read `wisdom/values.md`, persistent-questions proposal and architecture survey. Value 8 already covers durable visibility; no values edit needed.

- Built the actual CLI with `bun scripts/build.ts --reuse-web`, then ran `bun scripts/tui-harness.ts start qfixture --extension /tmp/die-question-fixture-1012981.ts` under a real tmux PTY. Fixture extension set `die-questions = "2 questions pending"` on session start and registered `/qfixture` to change it to `"1 question pending"`. This exercises real footer layout and runtime status updates, **not** backend persistence.
- Initial `frame qfixture` showed composer prompt `` immediately above a single footer row beginning `2q $0.000 C0% ...`. After `send qfixture /qfixture`, frame showed one `Answer saved for q1` transcript message, prompt, then footer beginning `1q $0.000 C0% ...`. No modal/focus transfer. Session stopped with `bun scripts/tui-harness.ts stop qfixture`.
- Raw artifacts: `artifacts/tui/qfixture-2026-09-26T08-58-14.627Z/transcript.ansi` (ignored locally). The shell emitted mise's untrusted-config warning at startup; the CLI nevertheless rendered and accepted the fixture command.
- Automated checks: `bun test tests/footer.test.ts tests/questions-extension.test.ts` and `bun run check`. The footer test covers narrow widths, status competition and Live; extension test covers list/detail/answer, status restoration, and no repeated background notifications. Real backend question lifecycle still requires service integration proof.
