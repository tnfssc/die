# Values derived from project wisdom

These are decision guides, not immutable rules or a replacement for the user's current instructions. Feature notes retain the evidence and operational details. Prefer newer verified evidence over historical plans. [Domain principles](wisdom-system/domain-principles.md) · [Review coverage and maintenance](wisdom-system/derived-values.md).

## 1. Finish the user's workflow, not just the component

Judge success at the boundary the user depends on: integrated behavior, usable output, recovery, and handoff. A passing helper test is not proof that the shipped experience works. Test the actual artifact when packaging or integration is the risk; do not require expensive live checks for every small edit.

Evidence: [packaging](packaging/single-binary-packaging.md), [live acceptance](releases/final-live-validation.md), [lifecycle acceptance](t3/t3-v2-production-lifecycle-final.md).

## 2. Make claims no stronger than the evidence

Separate observed facts, hypotheses, skipped checks, and unresolved failures. One credible required-path blocker outweighs a large passing count; investigate whether the fault is in product, harness, or environment. Choose validation that answers a real question, not ritual that merely repeats earlier proof.

Evidence: [resource judgment](resources/memory-resource-judgment.md), [harness correction](packaging/packaged-probe-final-fix.md), [release verification preference](releases/release-verification-preference.md).

## 3. Give state and side effects one clear owner

Name the authority for creation, mutation, completion, cancellation, and cleanup, including failure and partial-start paths. Other layers may display or forward state, but should not independently recreate the action. Keep derived indexes and caches rebuildable from authoritative records. Shared execution needs explicit ownership boundaries; a second competing scheduler or writer is not a reliability fallback.

Evidence: [execution ownership](t3/t3-thread-execution-research.md), [continuation ownership](t3/t3-v2-production-lifecycle-final.md), [cancellation](t3/t3-v2-production-cancellation.md), [authoritative history](history/disk-backed-history.md).

## 4. Make interrupted work recoverable

Across process/network boundaries, use stable identity, durable intent, replay-safe effects, and explicit acknowledgment. Distinguish accepted, running, completed, delivered, and acknowledged. Inspect ambiguous outcomes rather than blindly repeating work. Add persistence where recovery requires it, not to every local operation.

Evidence: [production requirements](t3/t3-v2-production-requirements.md), [replay and acknowledgment review](t3/t3-v2-production-backend-review-fixes.md), [worktree lifecycle](worktrees/worktree-cli-lifecycle-investigation.md).

## 5. Bound resources without silently destroying meaning

For retained output, queues, retries, and subscribers, bound the layer where accumulation occurs and choose explicit overflow behavior. Preserve recoverable originals when trimming working context. Normal active memory and durable storage are not automatically leaks; measure before adding eviction machinery. Bounded RAM does not promise unlimited storage.

Evidence: [resource judgment](resources/memory-resource-judgment.md), [queue review](t3/t3-v2-production-queue-resources.md), [process lifecycle](t3/t3-v2-production-process-resources.md).

## 6. Respect the user's state and authorized scope

Preserve unrelated work, preferences, and recoverable history. Isolate independent edits; clean up only resources we own. An unavailable or denied capability must not silently become a more powerful fallback. When safety-critical identity, privacy exclusions, or ownership are uncertain, stop or surface uncertainty rather than weaken the boundary. Apply the actual current permission model rather than inventing approval ceremony or treating old policy as universal.

Evidence: [PR hygiene](quality/pr-hygiene-final.md), [first-launch defaults](packaging/die-only-first-launch.md), [native interface](t3/t3-v2-production-interface.md), [current worktree design](t3/t3-worktree-design.md), [history privacy](history/searchable-history.md).

## 7. Prefer the smallest design that solves the real problem

Reuse established contracts and configuration before introducing parallel mechanisms. Add state, layers, safeguards, and compatibility only for a demonstrated need. Simplicity means fewer competing responsibilities, not omitting required durability or safety. Current explicit scope wins over speculative roadmaps.

Evidence: [worktree design](t3/t3-worktree-design.md), [resource triage](resources/memory-resource-judgment.md), [CI deduplication](ci/ci-trigger-dedup.md).

## 8. Show truth, including uncertainty

UI, tools, and diagnostics should expose actual state and capabilities. Unknown is not zero; a summary is not a transcript; observing is not steering; transport success is not task completion. Make gaps and failures legible without letting optional diagnostics change primary behavior.

Evidence: [task UI semantics](t3/t3-task-ui-research.md), [empty cost summary](t3/t3-preview-hide-empty-cost-summary.md), [diagnostics](quality/diagnostics.md).

## 9. Change semantics deliberately

Dependency upgrades and architecture replacements change contracts, not just names or versions. Identify which user-visible invariants still matter, test those boundaries, and make intentional removals explicit. Do not preserve obsolete behavior merely because it existed. Stage risky adoption separately; small reversible changes need less ceremony.

Evidence: [Pi upgrade](dependencies/pi-0.87-upgrade.md), [production preservation](t3/t3-v2-production-preservation.md), [staged preview adoption](t3/t3-preview-compatibility.md).

## 10. Leave work understandable and resumable

Code, evidence, decisions, and remaining work belong together. Delegate clear responsibilities, then integrate and verify the whole result. Let asynchronous work finish while doing useful independent work or yielding, not busy-waiting. Keep durable work in persistent locations and record how to resume it. Condense repeated lessons into principles instead of copying whole conversations or accumulating status notes forever.

Evidence: [shared-memory value](prompts/shared-memory-value.md), [project wisdom](wisdom-system/project-wisdom.md), [PR hygiene](quality/pr-hygiene-final.md).

## Regular consolidation

- Before substantial work: read these values and the relevant feature wisdom.
- At substantial completion or handoff: compare new lessons with existing values; revise or merge before adding.
- After releases or broad reviews: look across affected systems for recurring lessons and contradictions.
- Link supporting evidence and state the tradeoff. A repeated cross-system lesson may become a value; a local recipe stays a domain principle or feature note.
- At completion, briefly report: wisdom reconciled; values updated, or reviewed with no change needed and why.
- Keep this set small. Qualify or retire contradicted values. If the evidence changes nothing, leave this file alone.

Consolidation is an agent responsibility in the standing wisdom prompt, not a background timer or an automatic claim that every note was reviewed.
