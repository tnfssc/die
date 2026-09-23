# v0.2.1

- Make execute previews use the configured conversation padding.
- Reduce duplicate gaps between user and assistant messages; group consecutive collapsed execute/task-status rows without extra blank lines.
- Keep paragraph breaks, expanded output, image spacing, editor layout, and mouse hit areas.
- Remove detached UI wrappers during teardown, but keep third-party wrappers.
- Preserve worker error messages even when Error.stack omits them; diagnostics stay bounded and handle accessors that throw.

A compiled regression covers the missing-message stack shape from the earlier CI failure. We still have not confirmed the Bun condition that caused that stack.

No change to default automatic compaction, manual /shake behavior, or opt-in native fast-mode policy. Supported release binary: Linux x64. No paid check measured model performance.
