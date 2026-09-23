# Domain principles derived from wisdom

Apply these within their domain, not as universal requirements. [Shared values](../values.md) explain the underlying priorities. Exact commands, limits, versions, and support matrices remain in feature notes/code.

## Execution and distributed lifecycle

- Separate admission, execution, terminal outcome, delivery, and acknowledgment; test interruption between them. Stable IDs and deduplication protect retries, not just happy-path launches.
- Cancellation must fence late creation and settlement, be repeatable, and target owned resources. A closed scope is not proof that descendants stopped.
- Reject unsupported native options explicitly. Do not silently switch to local execution or ignore parameters to simulate success.

Sources: [backend review](../t3/t3-v2-production-backend-review-fixes.md), [cancellation](../t3/t3-v2-production-cancellation.md), [process resources](../t3/t3-v2-production-process-resources.md), [interface](../t3/t3-v2-production-interface.md).

- Keep monitoring/projection events out of the model conversation unless the authoritative runtime intentionally admits a completion/attention turn. Recoverable transcripts do not imply recoverable live processes or streams.

Additional sources: [task event contract](../web/die-web-task-contract.md), [agent mapping](../web/die-web-agent-mapping.md).

## Resource management and observability

- Bound the layer where accumulation occurs: downstream windows do not bound upstream queues, and per-item limits do not establish aggregate budgets.
- Define overflow recovery: truncation notices, replay, resnapshot, backpressure, or explicit failure. Silent normal completion can strand a live consumer.
- Test the triggering mechanism: stalled consumer, ignored signal, publication collision, canceled waiter—not merely successful churn.
- Keep correctness-critical persistence separate from best-effort diagnostics. Logging must not replace primary errors or become authoritative billing.

Sources: [terminal follow-up](../resources/resource-fixes-terminal-followup.md), [history review](../resources/resource-fixes-history-review.md), [resource limits](../resources/resource-limits.md), [diagnostics](../quality/diagnostics.md).

## Releases, packaging, and dependencies

- Test the artifact and environment that expose the risk: relocation, packaged runtime, restart, native dependencies, or browser integration. Keep acceptance harnesses portable too.
- Tie acceptance to the reviewed source/artifact identity. Confirm publication and expected assets; do not rewrite published release identity.
- Ordinary successful release CI does not require downloading binaries just to recheck its checksums. Extra runtime checks need a concrete risk or explicit request.
- Review dependency contract changes and integration semantics; version edits and structural type compatibility alone are insufficient. Keep locks, notices, and real-SDK tests coherent.
- Keep formatting, linting, and typechecking honest; do not weaken meaningful checks merely to report green.

Sources: [packaging](../packaging/single-binary-packaging.md), [PR hygiene](../quality/pr-hygiene-final.md), [release identity](../releases/release-v052.md), [verification preference](../releases/release-verification-preference.md), [Pi migration](../dependencies/pi-0.87-upgrade.md), [quality gates](../quality/code-quality.md).

## UI and capability contracts

- Distinguish lifecycle summaries from full transcripts and initial result transfer from continuing synchronization.
- Preserve meaningful distinctions between no activity, known zero, and unavailable measurements.
- Treat reload and direct-link behavior as part of the feature, not decoration around the happy path.

Sources: [task UI](../t3/t3-task-ui-research.md), [follow-up capabilities](../t3/t3-child-followup-research.md), [cost summary](../t3/t3-preview-hide-empty-cost-summary.md), [browser acceptance](../t3/t3-v2-production-browser-final.md).

## Security and incident fixes

- Define the actual boundary for powerful local features: web access, provider credentials, and project execution are separate concerns. Loopback-only no-auth is a specific contract, not permission for unauthenticated remote exposure.
- Fix the proven semantic mismatch without bypassing nearby safety guards. Normalize only fields demonstrated nonsemantic; preserve content, identity, ordering, and boundary checks.
- Setup approval policy is product-specific. Current CLI worktree setup is automatic; do not reintroduce gates based on superseded research.

Sources: [web access boundary](../web/die-web-upgrade-auth.md), [compaction incident](../native/native-compaction-current-incident.md), [Stop fix](../web/die-web-stop-fix.md), [current workspace contract](../native/native-workspace-final-pr.md).

## History, compaction, and preferences

- Keep the journal authoritative and derived indexes rebuildable; reduce resident working data without silently deleting durable originals.
- Treat history search as a privacy boundary: preserve exclusions, stable references, and explicit cross-session permission. Retrieval is not permission to expose everything stored.
- Preserve provider-native opaque state and tool identity through compaction; never execute returned tool calls while summarizing. Check the actual serialized conversation rather than assuming an internal representation matches it.
- Separate explicit user preference changes from restore events, child routing, and automation; only intended user choices should rewrite defaults.

Sources: [disk-backed history](../history/disk-backed-history.md), [search/privacy](../history/searchable-history.md), [compaction research](../compaction/compaction-research.md), [model preference follow-up](../models/last-used-model-followup.md).

## Collaboration and retained knowledge

- Research can share a checkout; independent edits need isolated persistent workspaces. Record branch/path, decisions, validation, and next work so another agent can resume.
- Work asynchronously: do useful independent work or yield rather than poll merely to stay active. A started job is not a completed result.
- Preserve evidence while consolidating lessons. A dated design proposal is not current policy; a local recipe is not automatically a universal value.

Sources: [worktree design](../t3/t3-worktree-design.md), [asynchronous validation](../resources/phase3-validation.md), [shared memory](../prompts/shared-memory-value.md), [project wisdom](project-wisdom.md).
