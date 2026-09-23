# Domain lessons from wisdom

Use these lessons in their own area. They are not rules for all work. [Shared values](../values.md) say what matters across the project. Keep exact commands, limits, versions, and support lists in feature notes or code.

## Execution and distributed lifecycle

- A job has steps: admit, run, finish, deliver, acknowledge. Test stops between them. Stable IDs and deduplication make retries safe, not just first runs.
- Cancel must block late starts and late settlement. It must be safe to repeat and must target owned resources. A closed scope does not prove its children stopped.
- Native option not supported? Reject it. Do not quietly run it locally or ignore an option and call that success.

Sources: [backend review](../t3/t3-v2-production-backend-review-fixes.md), [cancellation](../t3/t3-v2-production-cancellation.md), [process resources](../t3/t3-v2-production-process-resources.md), [interface](../t3/t3-v2-production-interface.md).

- Monitoring and projection events stay out of model talk. Only add them when the runtime means to send a completion or attention turn. A transcript may come back after restart. That does not mean its live process or stream comes back.

More sources: [task event contract](../web/die-web-task-contract.md), [agent mapping](../web/die-web-agent-mapping.md).

## Resources and what we can see

- Put the bound where data piles up. A downstream window does not bound an upstream queue. A per-item cap does not make a total budget.
- Say what happens on overflow: show truncation, replay, send a fresh snapshot, apply backpressure, or fail clearly. Quiet normal completion can leave a live consumer stuck.
- Test the thing that starts the bug: stalled consumer, ignored signal, publication collision, or canceled waiter. Successful churn is not enough.
- Keep data needed for correctness apart from best-effort diagnostics. Logs must not hide the main error or become the source of truth for billing.

Sources: [terminal follow-up](../resources/resource-fixes-terminal-followup.md), [history review](../resources/resource-fixes-history-review.md), [resource limits](../resources/resource-limits.md), [diagnostics](../quality/diagnostics.md).

## Releases, packaging, and dependencies

- Test the artifact and place where the risk shows up: moved install, packaged runtime, restart, native dependency, or browser. Keep the test harness portable too.
- Tie acceptance to the source or artifact that was reviewed. Check publication and expected assets. Do not change the identity of a published release.
- Release CI passed? No need download binaries only to check the checksums again. Do more runtime checks when there is a real risk or the user asks.
- A dependency change is more than a version edit or matching shape. Review its contract and integration behavior. Keep locks, notices, and real-SDK tests in sync.
- Keep format, lint, and type checks honest. Do not weaken a useful check just to make it green.

Sources: [packaging](../packaging/single-binary-packaging.md), [PR hygiene](../quality/pr-hygiene-final.md), [release identity](../releases/release-v052.md), [verification preference](../releases/release-verification-preference.md), [Pi migration](../dependencies/pi-0.87-upgrade.md), [quality gates](../quality/code-quality.md).

## UI and capability contracts

- A lifecycle summary is not a full transcript. First result transfer is not ongoing sync. Keep those apart.
- No activity, known zero, and no measurement are different states. Keep the difference.
- Reload and direct links are part of the feature, not polish around the happy path.

Sources: [task UI](../t3/t3-task-ui-research.md), [follow-up capabilities](../t3/t3-child-followup-research.md), [cost summary](../t3/t3-preview-hide-empty-cost-summary.md), [browser acceptance](../t3/t3-v2-production-browser-final.md).

## Security and incident fixes

- Name the real boundary for a powerful local feature. Web access, provider secrets, and running project code are different concerns. Loopback-only with no auth does not allow open remote access.
- Fix the proven mismatch. Keep nearby safety guards. Normalize only fields shown to have no meaning. Keep content, identity, order, and boundary checks.
- Setup approval belongs to that product. CLI worktree setup is automatic now. Do not bring old gates back from superseded research.

Sources: [web access boundary](../web/die-web-upgrade-auth.md), [compaction incident](../native/native-compaction-current-incident.md), [Stop fix](../web/die-web-stop-fix.md), [current workspace contract](../native/native-workspace-final-pr.md).

## History, compaction, and preferences

- The journal is the source of truth. Derived indexes should be rebuildable. Shrink live working data without quietly deleting the durable original.
- History search has a privacy boundary. Keep exclusions, stable refs, and explicit permission for cross-session reads. Being able to fetch stored data does not mean it may all be shown.
- Keep provider-native opaque state and tool identity through compaction. Never run tool calls returned while making a summary. Check the real serialized conversation; do not guess that an internal form is the same.
- A user choice is not a restore event, child route, or automation. Only an intended user change should rewrite a default.

Sources: [disk-backed history](../history/disk-backed-history.md), [search/privacy](../history/searchable-history.md), [compaction research](../compaction/compaction-research.md), [model preference follow-up](../models/last-used-model-followup.md).

## Working together and saved knowledge

- Research can share a checkout. Separate edits need separate workspaces that stay around. Record branch, path, decisions, checks, and next work so someone else can resume.
- Work async. Do useful work or yield. Do not poll just to stay active. Started job is not finished result.
- Keep evidence when merging lessons. Old design proposal is not current policy. Local recipe is not always a project-wide value.

Sources: [worktree design](../t3/t3-worktree-design.md), [asynchronous validation](../resources/phase3-validation.md), [shared memory](../prompts/shared-memory-value.md), [project wisdom](project-wisdom.md).
