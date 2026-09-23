# Footer history optimization

- Footer history now keeps one total number and the old native-fast flag in a `WeakMap` keyed by the session manager.
  No entries/messages are retained.
- Cache identity is session ID + leaf ID.
  The cache stores only the current position (not one value per leaf), so branching back to a previously visited leaf recomputes after intervening appends.
  A manager with either identity method missing gets no cache.
- Detailed and compact views now scan history once when the position changes. Each render still checks live native-fast status.
- Coverage verifies unchanged compact/detailed renders share one read, live status behavior, and append/reset/branch invalidation including revisiting an old leaf.

Validation:
- `bun test tests/footer.test.ts`
- `bun run check`
