# History storage I/O validation

Focused tests live in `tests/history-storage-io.test.ts` for the disk-backed entry store.

## Covered invariants

- `scanJsonl` propagates exceptions from its visitor; only malformed JSON records may be ignored.
- UTF-8 content (including multibyte text crossing the 64 KiB scanner boundary), CRLF records, malformed intervening records, and a valid final unterminated record scan correctly. Opening and appending repairs the final delimiter so the tail and appended record both survive reopen.
- `writeSync` short writes are retried until every byte is persisted. This uses a generated test in an isolated Bun subprocess so `mock.module("node:fs")` cannot pollute the main test process or other suites.
- A failed flushed replacement (forced through JSON serialization failure) does not discard a pending spool. The same store remains appendable and can publish the original header/body plus the later assistant record.
- Duplicate IDs preserve distinct physical records when materialized by metadata, while string ID lookup resolves to the last physical record. Cache hits cannot substitute one duplicate body for another.

## Failure observations

All four direct tests failed against the first concurrent store draft:

1. scanner visitor exceptions were swallowed;
2. append concatenated onto a valid unterminated final JSON value;
3. failed replacement deleted the pending backing file (subsequent publish target was absent);
4. duplicate-ID cache lookup returned the first body for the second physical record.

The adapter worker changed the store while these checks ran. Those cases now pass. The isolated short-write test passes too.

## Commands

- `bun test tests/history-storage-io.test.ts`: **5 pass, 0 fail**.
- `bunx tsc --noEmit --pretty false` could not run because the checkout lacks the configured `bun` type package (TS2688). This is an environment/dependency availability issue, not a test diagnostic.
