# Disk-backed history storage validation

Validated 2026-09-18 against the concurrently implemented adapter in `src/history/session-manager.ts`. I did not edit the adapter or its store.

## Compatibility coverage

`tests/history-storage.test.ts` keeps the global SDK monkey patch isolated in subprocesses. Its main scenario runs twice in fresh processes and compares the adapted result with an **unpatched Pi 0.85.1 SessionManager baseline**, after removing nondeterministic IDs/timestamps from the result. It covers:

- deferred persistence before the first assistant and atomic first-assistant flush (no advertised file after a user append; then header + both messages),
- `open` and `continueRecent` resume,
- ordinary append parent links,
- `branch`, `resetLeaf`, and branch-file creation (including the SDK rewrite path),
- `forkFrom` contents and parent-session header,
- `newSession` reset and its new first-assistant flush,
- compaction references to the original kept ID and rewritten cache-affine compaction details surviving reopen,
- original full text available through `getEntry` after reopen,
- compacted context containing summary/kept/tail text but not the older original body.

This is API behavior validation, not merely an internal cache-size assertion. The direct compaction scenario also verifies the authoritative JSONL is larger than the original body.

## Runtime retention probe

Command:

`bun scripts/history-storage-probe.ts`

The probe creates isolated temporary sessions, runs native and adapted modes in separate subprocesses, forces full collection with `Bun.gc(true)`, and deletes the temporary files. Each mode appends **136 MiB of generated original text** across 136 large messages and performs 17 compactions. Snapshots include process/JSC heap, RSS, entry count, estimated resident metadata bytes, full message bytes directly retained in the manager's `fileEntries`, configured cache bound, and compacted-context bytes. It then drops the manager, reopens the 136 MiB JSONL, verifies the first original by SHA-256, and samples again after that on-demand read.

Observed run:

| measurement | native SDK | adapted |
| --- | ---: | ---: |
| authoritative JSONL | 136.03 MiB | 136.03 MiB |
| original generated text | 136.00 MiB | 136.00 MiB |
| reopen heap growth over baseline | 136.19 MiB | 0.32 MiB |
| full text retained in manager metadata after reopen | 136.00 MiB | 0 bytes |
| metadata estimate after reopen (172 entries incl. header) | 16,623 B | 16,624 B |
| configured body cache bound | unbounded/native | 4,194,304 B |
| compacted context | 0.24 KiB | 0.24 KiB |
| original survived reopen/hash check | yes | yes |

Selected adapted snapshots after forced GC:

| snapshot | heap | metadata | retained full text | context |
| --- | ---: | ---: | ---: | ---: |
| baseline | 17.00 MiB | 163 B | 0 B | 50 B |
| after compaction 1 | 20.07 MiB | 1,216 B | 0 B | 244 B |
| after compaction 8 | 20.19 MiB | 7,957 B | 0 B | 245 B |
| after compaction 17 | 20.25 MiB | 16,624 B | 0 B | 248 B |
| reopened | 17.32 MiB | 16,624 B | 0 B | 248 B |
| after one 1 MiB original read | 18.33 MiB | 16,624 B | 0 B | 248 B |

The cache itself is private to the adapter, so the probe reports its exported/configured 4 MiB limit rather than claiming a fabricated exact occupancy. The after-read heap increase (about 1 MiB) is direct runtime evidence that one requested body becomes resident while the 136 MiB transcript does not. Metadata remains intentionally O(entries); the context remains compaction-sized.

The adapted subprocess has hard assertions that original bytes are at least 128 MiB, the reopened original hash matches, retained full text in manager metadata is zero, compacted context is below 1 MiB, and reopened heap growth is below 64 MiB.

## Commands run

- `bun test tests/history-storage.test.ts` — 2 pass, 0 fail (15 assertions)
- `bunx tsc --noEmit --pretty false` — pass
- `bun scripts/history-storage-probe.ts` — pass; figures above

The earlier audit reproduction is `scripts/leak-audit/session-journal.ts`; it is in-memory and only 32 MiB. The new probe is persisted, exceeds the requested 128 MiB threshold, exercises many compactions and reopen, and includes a native subprocess baseline.
