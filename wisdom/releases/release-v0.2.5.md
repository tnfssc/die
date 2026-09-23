# v0.2.5

- Add project-local Markdown memory. `/memory` starts a managed fast or normal subagent to combine it. Empty notes launch no worker. Cooperative leases, checked save receipts, and bounded reads keep notes that can be retried after failure. Automatic consolidation remains disabled.
- Add history.search and history.read inside execute. They use original transcript refs, bounded pages, active-branch defaults, current shake exclusions, and explicit read-only access across sessions. Includes FIFO rejection and Unicode offset corrections.
- Add an inspection view to /ps and layouts that stay target-safe in tiny terminals.
- Harden partial subagent batch cleanup, completion ownership, nonfatal UI refresh, diagnostic restoration, and bridge frame limits.
- Make docs match the code. Ask-user forms and generated API help remain proposals only.

## Limits

Memory locking depends on cooperation. It cannot stop any filesystem writer. Uncertain dispatch failures retain the lock for manual recovery. History rejects oversized inputs rather than weakening exclusions. Saving diagnostics is best effort, not a transaction. No dependency changes or paid provider probes for this release.

The v0.2.4 workflow stopped before publishing because a regression test depended on local profile settings. This release isolates that fixture. The v0.2.4 tag stays unchanged.
