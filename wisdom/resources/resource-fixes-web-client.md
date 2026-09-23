# Web client resource fixes (current pin 719a76ca)

This work only touched `.cache/die-t3code-v0042/apps/web/**`.
We left the desktop recording timeout alone. Normal Die web cannot reach it.
We also left the tiny navigation, error, favicon, and icon caches alone. The audit found no real cost there.
We did not rebuild the patch.

## Implemented

- `src/lib/syntaxHighlighting.ts`
  - Unsupported arbitrary language labels are removed from the promise cache when resolution fails and fall back through the canonical `text` entry.
  - Concurrent/repeated supported-language requests remain deduplicated while cached.
  - Successful/pending language keys and remembered unsupported labels each use a 64-entry LRU bound, preventing built-in, custom, or arbitrary labels from making module state unbounded.
  - Tests cover supported-language deduplication, unsupported-label retirement/canonical text reuse, and bounded eviction.
- Pull request handoff prompts
  - Added a 128-entry LRU bound for full prompt strings remembered by draft.
  - Updating a draft makes it recent again. Active and recent drafts keep the same prompt replacement and handoff behavior.
  - Tests cover the bound, oldest-entry eviction, and refresh behavior.

## Validation

- Targeted unit tests: 2 files, 115 tests passed.
- Web TypeScript check: passed (existing Effect suggestions only).
- Formatter check for the five changed web files: passed.
- `git diff --check` for the five changed web files: passed.
- No temporary test files remain. Tests were added directly to existing suites.

## Changed web files

- `apps/web/src/lib/syntaxHighlighting.ts`
- `apps/web/src/lib/syntaxHighlighting.test.ts`
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx`
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts`
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts`
