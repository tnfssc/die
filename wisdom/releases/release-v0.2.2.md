# v0.2.2

## Operational diagnostics and safety

- Add /diagnostics and /diagnostics durable with allowlisted, bounded metadata and visible logging-health counters.
- Show each native compaction fallback check on its own. Keep the main failure when usage logging fails, without duplicate inference or cost records.
- Do not let rejected HTTP responses refresh cache estimates. Match observations carefully against Pi's real HTTP and WebSocket event contracts.
- Keep job stop causes, IPC failure groups, and shutdown ownership history. Keep existing job-output inspection working.
- Limit corrupt child identities. Make corrupt goal or mode restore failures visible. Keep attention monitoring after short-lived inspection errors.
- Harden fast-mode and shake persistence-failure handling, and reject stale native compaction work after session switches.
- Provider, UI, and Herdr diagnostics stay optional and cannot cause the main work to fail. New diagnostic metadata excludes prompts, credentials, headers, payloads, tool output, and arbitrary exception text.

## Limits

Diagnostics are bounded and best effort. They are not a full audit trail. See wisdom/quality/diagnostics.md for retention, dropped-write counters, and session history behavior. The protected job lifecycle index uses Linux x64 libc advisory locking; when locking is not supported, Die drops records instead of writing unsafely. Historical jobs are not reattached after restart. Actual service tier, provider billing, and cache residency are not inferred from a dispatch event.

Supported release binary: Linux x64. This release made no paid provider calls and did not check performance or billing. Existing automatic compaction defaults and opt-in native fast-mode policy remain unchanged.
