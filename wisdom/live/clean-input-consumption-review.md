# Historical intermediate review — resolved

This review applied to first implementation 7951c06, not the final tree. Admission acknowledgment, concurrent reservation, permanent context filtering, and overlapping-fragment factual rendering were subsequently implemented. See clean-gpt-model-input-evidence.md and clean-agent-input-work.md for final proof.

Reviewed production commit `7951c06` read-only. The new consumed-fragment selection prevents the sequential pull → follow-up → stop replay, and replayed delegation IDs remain deduplicated. I found these remaining bugs:

1. **Admission can consume speech that never reaches the agent.** `extension.ts:445–468` returns `{queued:true}` without awaiting `owner.delegate()`. The bridge then consumes the selected fragments (`gpt-live-delegation.ts:152–155`), even if the owner rejects before dispatch—for example, because the branch changed. The same ID cannot retry, and the next delegation lacks that speech.
2. **Concurrent distinct IDs can dispatch the same speech twice.** Both `handleCreated()` calls select fragments before either asynchronous `submitContextual()` settles; consumption occurs afterward. Same-ID deduplication does not cover this.
3. **Legacy transcript JSON remains model-visible after voice off/reload.** Removing new `sendContext()` writes does not filter previously persisted `live-transcript` custom messages. `main-owner.ts` still passes transformed history to the model, with no legacy-message filter.
4. **Fresh overlapping deltas can become a fabricated command.** `extension.ts:440–450` concatenates fragment text without boundaries and drops the provisional/uncertain qualification. Corrections remain eligible, but competing fragments within one delegation can read as one definitive utterance.

The stale-result path does consume its captured selection after an actual `{queued:true}`, as intended; that does not resolve the premature-admission case above.