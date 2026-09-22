# v0.2.4

- Add project-local Markdown memory and explicit /memory consolidation through a managed fast/normal subagent. Empty notes launch no worker. Cooperative leases, verified save receipts, and bounded reads preserve retryable notes on failure. Automatic consolidation remains disabled.
- Add history.search and history.read inside execute: original transcript references, bounded pagination, active-branch defaults, current shake exclusions, and explicit read-only cross-session access. Includes FIFO rejection and Unicode offset corrections.
- Extend /ps with an explicit inspection view and target-safe tiny-terminal layouts.
- Harden partial subagent batch cleanup, completion ownership, nonfatal UI refresh, diagnostic restoration, and bridge frame limits.
- Reconcile documentation with implemented behavior. Ask-user forms and generated API help remain proposals only.

## Limits

Memory locking is cooperative, not protection against arbitrary filesystem writers. Uncertain dispatch failures retain the lock for manual recovery. History rejects oversized inputs rather than weakening exclusions. Diagnostic persistence is best effort and not a transaction. No dependency changes or paid provider probes for this release.
