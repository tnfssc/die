# Wisdom → values consolidation

## Decision (2026-09-23)

The user requested derived values/principles plus regular consolidation, then explicitly asked for deep parallel review covering most wisdom. Keep three layers:

- [Values](../values.md): ten small, cross-system decision guides with evidence and tradeoffs.
- [Domain principles](domain-principles.md): actionable rules whose scope matters.
- Existing feature wisdom: source evidence, decisions, incidents, and operational detail. No bulk deletion or rewriting of historical records.

Values are revisable guidance, not authority above current user instructions. Source links explain derivation; they do not endorse every historical prescription in a linked note.

## Coverage

Five read-only reviewers covered **all 223 pre-existing Markdown notes across 20 directories**. The memory reviewer also read this newly created consolidation note, making 224 reviewed files. Review depth was not uniform:

| Area | Markdown reviewed | Full/close reads | Structured/evidence skims |
| --- | ---: | ---: | ---: |
| Releases, packaging, CI, dependencies, quality | 47 | 47 | 0 |
| T3 | 59 | 4 | 55 |
| Resources | 33 | 20 | 13 |
| Web, tasks UI, native, execute | 35 | 35 | 0 |
| History, compaction, worktrees, prompts, wisdom system, models, goals, integrations, experiments | 50 | 50 | 0 |
| Total (including this new note) | 224 | 156 | 68 |

Non-Markdown probes/artifacts were not independently audited. This is a synthesis of recorded evidence, not a claim that every historical implementation was revalidated. The parent checked synthesis links, reviewed representative sources, and verified key supersession points. Repetition across incident reports counts as recurring evidence, not independent experiments.

Research job IDs: resources task_af112ee3, T3 task_4615ef2d, web/UI/native task_a115a14b, delivery task_62278bea, memory/workspaces task_4b613164. An initial representative review (task_159400e7) preceded broad coverage. All research used the current workspace with no edits by reviewers; no delegated implementation worktrees or branches exist for this task.

## Important conflicts resolved

- **Release ceremony:** [current preference](../releases/release-verification-preference.md) supersedes historical routine binary downloads/checksum rechecks. Confirm successful CI/publication; extra runtime validation needs a real risk or request.
- **Worktree setup:** [automatic setup final](../worktrees/worktree-auto-setup-final.md) and [workspace contract](../worktrees/subagent-workspaces.md) supersede older approval/digest-gate proposals. CLI setup is automatic; child trust and web configuration are separate concerns. Do not infer a universal approval policy from old security recommendations.
- **Compaction:** [active shake-first policy](../compaction/auto-shake-compaction.md) supersedes the older manual-only roadmap. Later current-conversation decisions within [compaction research](../compaction/compaction-research.md) supersede earlier captured-prefix restrictions. The threshold is product policy, not a universal value.
- **T3 adoption:** [lifecycle acceptance](../t3/t3-v2-production-lifecycle-final.md) supersedes early unavailable/NOT ADOPTED status. Keep the single-owner lesson, not obsolete assignments of which runtime owns continuation.
- **Resource findings:** [lead judgment](../resources/memory-resource-judgment.md) separates proven defects, normal retained data, scalability policy, and unreachable upstream bugs. [Terminal follow-up](../resources/resource-fixes-terminal-followup.md) replaces silent normal completion with visible failure/recovery. Do not universalize particular caps or speculative concurrency limits.
- **Packaging and harnesses:** [single-binary packaging](../packaging/single-binary-packaging.md) supersedes sidecar recipes. [Corrected probe](../packaging/packaged-probe-final-fix.md) supersedes the earlier WebSocket harness diagnosis.
- **Web architecture:** implemented pin-plus-patch and [loopback access boundaries](../web/die-web-upgrade-auth.md) supersede older fork/pairing proposals. Exact mechanisms remain domain policy, not universal architecture values.
- **Preferences:** [model persistence follow-up](../models/last-used-model-followup.md) supersedes the earlier conclusion that non-persistence was intentional. Preserve explicit user choices, not incidental restore/child events.
- **Knowledge maintenance:** [direct project wisdom](project-wisdom.md) supersedes the old pending queue/index/locking machinery. This request adds a derived layer and review habit, not a new scheduler, mandatory index, or consolidation service.

## Standing instructions and maintenance

Canonical src/prompts/wisdom.md now directs root agents to read values before substantial work and revisit lessons at substantial completion/handoff and after releases/broad reviews. Merge/revise before adding; retain source links and tradeoffs; qualify contradictions; leave values untouched when no evidence changes them. Missing values should be derived from available project evidence, not invented history.

The existing wisdom extension injects these instructions. Root-only delivery is unchanged; coordinating agents remain responsible for synthesis and can pass relevant principles to workers. This is an agent instruction, not guaranteed autonomous scheduled execution. The ten project values are not embedded into every project's global prompt.

## Validation and remaining scope

Focused prompt, extension, and real-SDK tests verify the new instruction reaches the assembled root request and does not change child injection policy. Validation passed: 22 tests (165 assertions), local Markdown links in the values/system documents, focused Biome formatting, and git diff --check. No full product suite was needed for this documentation/prompt-only change.

PR preparation authorized after the practice audit: branch feat/derived-wisdom-values in /home/tnfssc/Code/die, targeting develop. Added an explicit brief completion outcome to the standing prompt and updated project-wisdom.md to reference the canonical prompt instead of duplicating stale wording. No build, installation, or release performed; installed packaged binaries need a later rebuild/install or release to pick up the prompt change. No research jobs remain outstanding.
