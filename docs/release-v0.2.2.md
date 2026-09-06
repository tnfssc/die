# v0.2.2

## Operational diagnostics and safety

- Add /diagnostics and /diagnostics durable with allowlisted, bounded metadata and visible logging-health counters.
- Explain native compaction fallback checks individually; preserve primary failures when usage logging fails, without duplicate inference or duplicate cost records.
- Stop rejected HTTP responses from refreshing cache estimates; correlate observations conservatively against Pi's actual HTTP/WebSocket event contracts.
- Preserve job termination causes, IPC failure categories, and shutdown ownership history. Keep existing job-output inspection intact.
- Restrict corrupt child identities, make corrupt goal/mode restoration inspectable, and retain attention monitoring after transient inspection errors.
- Keep optional provider/UI/Herdr diagnostics nonfatal. New diagnostic metadata excludes prompts, credentials, headers, payloads, tool output, and arbitrary exception text.

## Limits

Diagnostics are bounded and best effort, not a complete audit trail. See docs/diagnostics.md for retention, dropped-write counters, and session history behavior. The protected job lifecycle index uses Linux x64 libc advisory locking; unsupported locking drops records rather than writing unsafely. Historical jobs are not reattached after restart. Actual service tier, provider billing, and cache residency are not inferred from a dispatch event.

Supported release binary: Linux x64. No paid provider probes or performance/billing validation were performed for this release. Existing automatic compaction defaults and opt-in native fast-mode policy remain unchanged.
