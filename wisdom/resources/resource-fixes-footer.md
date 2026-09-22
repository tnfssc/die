# Footer history optimization

- Reduced footer history to one numeric aggregate plus the historical native-fast flag in a `WeakMap` keyed by the session manager. No entries/messages are retained.
- Cache identity is session ID + leaf ID. The cache stores only the current position (not one value per leaf), so branching back to a previously visited leaf recomputes after intervening appends. Managers missing either identity method remain uncached.
- Detailed and compact renders now scan history once per changed position; live native-fast unavailable status is still checked every render.
- Coverage verifies unchanged compact/detailed renders share one read, live status behavior, and append/reset/branch invalidation including revisiting an old leaf.

Validation:
- `bun test tests/footer.test.ts`
- `bun run check`
