# Worktree terminal log basename fix

## Result

Fixed the async setup terminal failure that blocked work. The fix was made in canonical source `.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e`.

- `apps/server/src/terminal/Manager.ts` keeps short base64url filename components unchanged. It replaces any encoded ID component longer than 120 ASCII bytes with an unambiguous `~sha256-<64 hex>` identity.
- The maximum terminal transcript basename is 254 bytes (`terminal_` + two 120-byte components + separator + `.log`), below the 255-byte filesystem limit.
- Thread-prefix cleanup uses the same bounded identity. So close/delete-history still removes every terminal transcript for a long thread ID.
- Legacy default-terminal lookup/removal is skipped when its legacy basename would exceed 255 bytes, avoiding a second `ENAMETOOLONG` path.
- Existing short transcript names and legacy migration behavior are unchanged.

## Regression coverage

The focused `Manager.test.ts` lifecycle test uses long, nearly identical nested delegated thread IDs and ordinary `native-acceptance-setup` terminal IDs. It verifies open, write, persisted read and reopen, restart, clear, and close/delete. It also verifies distinct bounded basenames, the 255-byte limit, and the long default-terminal legacy lookup path.

## Validation

From `apps/server`, using restored local dependencies only:

- `../../node_modules/.bin/vp test run src/terminal/Manager.test.ts` — PASS, 85/85 tests.
- `../../node_modules/.bin/tsc --noEmit` — PASS (existing Effect language-service suggestions only).
- `git diff --check -- apps/server/src/terminal/Manager.ts apps/server/src/terminal/Manager.test.ts` — PASS.

No build, install, commit, harness, patch/export, or unrelated source change was performed.
