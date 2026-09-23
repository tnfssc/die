# Context recovery: decisions and deferred ideas

## Current decision

Build explicit /shake command. Keep automatic compaction default, including current-context plaintext and provider-native Codex behavior. This adds no automatic shaking. Do not change compaction trigger policy.

Shake drops execution traces from active context. It does not sum up or rewrite dialogue. Full transcript stays on disk. Pruning needs no inference request.

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

Use stable transcript refs. Search current branch by default. Bound pages and keep provenance. Prefer original evidence over repeated summaries, handoffs, and retrieval echoes. Keep delivery deterministic and testable without provider.

### Verbatim intent plus execution-state summary

Earlier idea: keep user messages word for word next to generated summary of current state. Exact words keep conditions, fixes, priorities, and withdrawals. Later design must keep this value even if summary format changes.

Later shake idea keeps user input and assistant conversational/final replies. It drops tool traces and thinking. Both ideas can work together: verbatim dialogue plus optional state summary.

### Recovery manifest / handoff

Small index of trusted notes, goals, open questions and job/history IDs may help recovery. User was unsure. It is not committed scope. Any index must be previewable, editable and traceable. It must not become second hidden truth store.

### Automatic shake as a possible future default

Automatic shake was discussed to replace automatic compaction. Latest choice leaves switch for later. Long threads may become mostly verbatim dialogue with little tool output to remove. Shake alone may not control context growth.

Possible future UX:
- Quiet automatic pruning when effective, with a compact before/after estimate.
- Detect diminishing returns; avoid repeated ineffective shakes.
- Warn early when the thread is mostly dialogue.
- Offer continue while safe, compact once with explicit authorization, or continue in a linked new thread.
- Later, preview selective archival of older dialogue without deleting it from history.
- Pause before a predictably oversized request instead of silently summarizing or dropping dialogue.

### Cache-aware policy

Prompt caches usually need matching prefixes. Dropping old tool trace may invalidate much later conversation. Unchanged system/tool prefixes may still be reusable. Shaking every turn can trade token count for repeated cache misses.

Possible later policy: estimate gain before change. Keep append-only cached prefixes while room remains. Batch cuts into rare large shakes. Offer explicit force option. Compare uncached-input cost before and after. This is research, not current requirement.

## Posthorse research context

Reviewed pi-posthorse v0.4.5 source at 6cdb50a42a3474a9b89d6fed1e86c831425ed9e2 and Pi fork base f9b06177e565f70cd243a785d088d1c491830dbd. It combines fresh windows, notes/history, exact retrieval, optional internal workers, and token budgets. Useful ideas: searchable history, original text retrieval, semantic summaries as aids, and staged context reduction. Do not copy parts or add embeddings/workers without separate design and license review.

Sources:
- https://github.com/fitchmultz/pi-posthorse/tree/6cdb50a42a3474a9b89d6fed1e86c831425ed9e2
- https://github.com/fitchmultz/pi/tree/f9b06177e565f70cd243a785d088d1c491830dbd
