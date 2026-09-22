# v0.2.1

- Align execute previews with the configured conversation padding.
- Reduce duplicate gaps between user and assistant messages; group consecutive collapsed execute/task-status rows without extra blank lines.
- Preserve paragraph breaks, expanded output, image separation, editor layout and mouse hit areas.
- Release detached UI wrappers and preserve third-party wrappers during teardown.
- Preserve worker error messages even when Error.stack omits them; diagnostics are bounded and tolerate throwing accessors.

The missing-message stack shape from the earlier CI failure is covered by a compiled regression. The original Bun condition that produced that stack remains unconfirmed.

No change to default automatic compaction, manual /shake behavior, or opt-in native fast-mode policy. Supported release binary: Linux x64. No paid model-performance validation was performed.
