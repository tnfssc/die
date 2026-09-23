# Native compaction current incident (read-only diagnosis)

Date: 2026-09-14

## Evidence

- Source: src/tasks/native-compaction.ts:763-797 computes nativeFallbackCode(); when coverage fails it records coverage_incomplete, clears the native capture, returns without cancelling, and lets the later cache-affine handler run.
  With an existing opaque checkpoint the same branch is blocked/cancelled instead (lines 765-779), preserving the checkpoint.
- The current coverage predicate (lines 426-441) is ordered subsequence matching of all messages-to-summarize plus turn-prefix messages, followed by the first-kept-entry/leaf boundary guard.
  It isn't a projection or “newer messages” test.
- The prior investigation’s concrete mismatch is real: live custom messages carry a runtime Date.now() timestamp, while session reconstruction uses the persisted entry timestamp.
  The captured request and reconstructed compaction event can so differ by 1 ms.
  Before the current source’s coverageMessageKey() normalization, whole-message JSON keys differed and coverage returned false.
  The suspected first turn-prefix task-complete custom message was entry 2a1463ed (task_1f86111); persisted time was 1789368711432, while 1789368711431 is inferred from adjacent live evidence.
  The live capture is memory-only, so that exact runtime value can't be proven from the JSONL.
- Session metadata confirms incident compaction entry a67410ef at 2026-09-14T07:09:13.397Z.
  Its details are cache-affine-plaintext metadata (version 5, priorPayloadAffine false); no opaque/native checkpoint was written there.
  Later JSONL metadata contains native entries at lines 1802 and 2461, but no plaintext/ciphertext/auth material was read.
- The source now strips only top-level timestamp for role custom; all other message fields, roles, ordering, multiplicity, and the boundary check stay strict.
  This is the minimal safe correction and doesn't bypass guards or create a plaintext fallback for an opaque checkpoint.

## Retry/fallback mechanism

The warning repeats because native failure is normal fall-through: the native hook clears its capture and returns, then the registered cache-affine compaction hook owns the same session_before_compact event.
A later automatic compaction/context pass can capture a new provider request and repeat the check.
It isn't evidence that native HTTP was repeatedly dispatched: this coverage failure has dispatch none; no native request is safe to send.
Existing opaque checkpoints take the conservative blocked path and don't fall through.

## Minimal safe fix

Keep the current narrowly scoped semantic coverage key for reconstructed custom messages (ignore only their nonsemantic top-level timestamp), plus a regression test for live-vs-persisted custom timestamps.
Do not weaken content/order/boundary checks, bypass the opaque-checkpoint guard, or use plaintext when an opaque checkpoint exists.
No source edits, provider calls, installs, server kills, or packaging were performed during this diagnosis.

## Remaining uncertainty

The source-level timestamp reconstruction defect is confirmed.
The exact unseen live timestamp in the memory-only capture is inferred instead of directly recoverable from the session JSONL.
The JSONL gives event/entry metadata only; it doesn't independently establish the in-memory captured request.

## Main correction/current evidence

The worker conclusion above repeats the old 07:09 plaintext incident.
It doesn't show the current cause.
The main scan found native checkpoints `d9e961ca` at 10:15:52Z and `54709353` at 13:09:12Z.
The newest durable diagnostics were from 09/13 at about 19:51.
The 128-record durable budget was exhausted, so JSONL could not show the newest in-memory reason.

The generic opaque-block message covers several fallback codes.
Do not conclude this was `coverage_incomplete`.
The main agent asked the user for the latest `/diagnostics` component compaction code, which contains metadata only.
Packaging paused.
The guard must stay.
Code-only worker `task_eda7b808` checked capture lag, safe boundaries, and other causes.
No fix had been made.

## Confirmed narrowed cause/fix (main)

The user posted live `/diagnostics`.
It showed repeated `coverage_incomplete` with no dispatch between fresh responses.
A read-only SDK replay at 15:15:25 found 472 required messages and 518 available messages.
Raw reconstruction matched.

Required index 352 was an assistant error at timestamp 1789396082526 (14:28:02.526Z), with `content[]` and usage 0.
SDK `agent-session._prepareRetry` removes a failed assistant from live agent state but keeps it in the journal.
Replaying that prune reproduced first missing index 352.
Excluding only the empty assistant error restored coverage without changing the boundary.

No plaintext, messages, or ciphertext were output.
Metadata-only proof is in `artifacts/native-coverage-confirmed.log`.
Main process PID 168303 was still running 0.2.10 since 10:38 UTC from a deleted old inode.
Its binary already had the timestamp fix.
Any new fix needed a restart and resume.

`src/tasks/native-compaction.ts` now filters only records with role `assistant`, stop reason `error`, and an empty content array.
It still protects partial replies, signatures, and tool calls.
Test worker `task_2b12ba50` owned `tests/native-compaction.test.ts`.
No install or release had happened.
Packaging stayed paused.

The fix was validated and installed locally. `task_96732165` passed typecheck, build, and 612 tests with 14 skipped, 0 failed, 3,849 assertions, and 87 files.
The 38 focused native tests covered the empty failed retry, partial text, encrypted `thinkingSignature`, tool-call rejection, and blocking missing user or tool results.
The main offline proof showed that first missing index 352 disappeared only after the empty failed-assistant filter.
The boundary didn't change.

The CLI-only install to `~/.local/bin/die` was atomic.
Version 0.2.13 was an unpublished development fix, and its `dist` SHA matched.
The web sidecar and user server didn't change.
Live parent PID 168303 still used the old 0.2.10 inode.
The user had to exit and resume the conversation to load the new code.
The diagnosis didn't change existing journals or checkpoints.
There was no commit, tag, or release.
Bundling stayed paused.

After restart, the user still saw the generic compaction refusal and the expected `/shake` opaque refusal.
New parent PID 442354 used installed fix SHA `1f1f3558a0de4c68e1f578caf78c74af7ff6df6dc0bde4fc9198354d7e7f9623`.
The latest fallback code was unknown. `capture_missing` right after restart was possible but not confirmed.
A normal exchange should create a fresh capture.
The user needed to retry `/compact` after a reply.
If it still failed, the next step was the newest `/diagnostics` component compaction code.
Do not conclude `coverage_incomplete` from generic UI text or bypass the guard.

User confirms resolved after fresh exchange: "ok. now we done. continue".
Single-binary work authorized to resume.
Patched process verified; no additional compaction changes needed now.
