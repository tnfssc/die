# Context recovery: decisions and deferred ideas

## Current decision

Implement an explicit /shake command. Keep existing automatic compaction as the default, including current-context plaintext and provider-native Codex behavior. No automatic shake, compaction disablement, or silent fallback policy in this change.

Shake prunes execution traces from active context without summarizing or rewriting dialogue. Preserve the full transcript on disk. Pruning itself needs no inference request.

## Manual shake requirements

- Retain user input and conversational assistant replies verbatim and in order, preserving attachments where applicable.
- Remove eligible completed tool calls/results and intervening thinking together, never orphan protocol messages or prune active/unresolved work.
- Distinguish final/conversational replies using actual SDK evidence; preserve ambiguous dialogue rather than silently discard it.
- Preserve system/project/custom instructions, durable goals, job ownership and notifications. Assistant replies remain claims, not proof of successful actions.
- Persist branch-scoped pruning state without deleting JSONL history. Test reopening and branch behavior.
- Treat existing compaction conservatively: never flatten opaque native state, claim already-compacted dialogue is recoverable verbatim, or break provider replay. Refuse unsupported cases clearly.
- Report removal and remaining context with labeled estimates; no-op when nothing is eligible. Avoid stale pre-shake usage triggering misleading UI or unnecessary automatic compaction.
- Warn of possible prompt-cache invalidation. Do not promise token-price savings. No paid request, retry, model change, installation or release is implied.

## Deferred ideas

### Searchable original history: priority follow-up

Stable transcript references, branch-local search by default, bounded paged reads and provenance. Prefer original evidence over repeated summaries, handoffs and retrieval echoes. Preserve deliberate context exclusions; explicitly scope access to other sessions. Retrieved material enters the selected provider's context. These controls protect excluded/private material, not hide the user's own instructions.

### Verbatim intent plus execution-state summary

Earlier proposal: retain user messages verbatim alongside a generated summary of current state. Exact wording preserves conditions, corrections, priorities and withdrawals. Later instructions can supersede earlier ones; preserved does not mean still applicable. Avoid duplication/nesting over repeated compactions. Expose capacity limits rather than silently truncate text labeled verbatim.

The subsequent shake proposal retains both user input and assistant conversational/final replies, while dropping tool traces and thinking. These approaches can complement each other, but shake itself does not generate a summary.

### Recovery manifest / handoff

A small index of authoritative notes, goals, unresolved questions and job/history IDs could help recovery. The user was uncertain about this; it is not committed scope. A previewable/editable handoff for a deliberately chosen new thread is a separate possible UX. Mechanically assembled emergency records and worker claims are not verified current state.

### Automatic shake as a possible future default

Discussed replacing automatic compaction with automatic shake, but the latest decision defers that switch. Long threads may become mostly verbatim dialogue, leaving little removable trace.

Possible future UX:
- Quiet automatic pruning when effective, with a compact before/after estimate.
- Detect diminishing returns; avoid repeated ineffective shakes.
- Warn early when the thread is mostly dialogue.
- Offer continue while safe, compact once with explicit authorization, or continue in a linked new thread.
- Later, preview selective archival of older dialogue without deleting it from history.
- Pause before a predictably oversized request instead of silently summarizing or dropping dialogue.

### Cache-aware policy

Prompt caches generally depend on matching prefixes. Removing an old tool trace can invalidate much of the following conversation, though unchanged system/tool prefixes may remain reusable. A 90% to 70% reduction may still require processing a large uncached prompt. Smaller context is not automatically cheaper; cache behavior, TTL and prices vary by provider.

Possible future policy: estimate yield before mutation, preserve append-only cached prefixes while there is room, batch reductions into occasional substantial shakes, and offer explicit choices for weak reductions. No universal savings promise or fixed percentage claimed as optimal. Aim for enough headroom for useful continued work at reasonable cost, not minimum token count.

## Posthorse research context

Source-reviewed pi-posthorse v0.4.5 at 6cdb50a42a3474a9b89d6fed1e86c831425ed9e2 and Pi fork baseline f9b06177e565f70cd243a785d088d1c491830dbd. It combines fresh windows, notes/history and mechanically assembled recovery records. No-summary automatic rollover is conditional; otherwise Pi compaction may proceed. Logical batch atomicity is not a crash-safe filesystem transaction. Our installed Pi 0.85 lacks its native context-window APIs despite the matching version. No installation, runtime validation, fork adoption or compaction replacement was approved.

Sources:
- https://github.com/fitchmultz/pi-posthorse/tree/6cdb50a42a3474a9b89d6fed1e86c831425ed9e2
- https://github.com/fitchmultz/pi/tree/f9b06177e565f70cd243a785d088d1c491830dbd
