# Turning wisdom into values

## Decision (2026-09-23)

User asked for derived values and regular cleanup. User then asked for deep parallel review of most wisdom. Keep three layers:

- [Values](../values.md): ten small guides for choices across systems. Each keeps evidence and tradeoffs.
- [Domain lessons](domain-principles.md): useful rules that only fit some areas.
- Feature wisdom: source evidence, choices, incidents, and operating detail. Do not bulk-delete or rewrite old records.

Values can change. They do not beat the user's current instructions. Source links show where a value came from. A link does not approve every old rule in that note.

## Coverage

Five read-only reviewers covered **all 223 old Markdown notes in 20 directories**. The memory reviewer also read this new note. That makes 224 files reviewed. Not every read had the same depth:

| Area | Markdown reviewed | Full/close reads | Structured/evidence skims |
| --- | ---: | ---: | ---: |
| Releases, packaging, CI, dependencies, quality | 47 | 47 | 0 |
| T3 | 59 | 4 | 55 |
| Resources | 33 | 20 | 13 |
| Web, tasks UI, native, execute | 35 | 35 | 0 |
| History, compaction, worktrees, prompts, wisdom system, models, goals, integrations, experiments | 50 | 50 | 0 |
| Total (including this new note) | 224 | 156 | 68 |

Reviewers did not separately audit non-Markdown probes and artifacts. This sums up saved evidence. It does not claim every old implementation was tested again. The parent checked links, read sample sources, and checked key cases where newer work replaced old work. Repeat incident reports show a recurring issue. They are not separate experiments.

Research jobs: resources task_af112ee3, T3 task_4615ef2d, web/UI/native task_a115a14b, delivery task_62278bea, memory/workspaces task_4b613164. A first sample review, task_159400e7, came before the wide review. Reviewers used the current workspace and made no edits. This task made no worker branches or worktrees.

## Old and new facts that conflict

- **Release steps:** [Current preference](../releases/release-verification-preference.md) replaces old routine binary downloads and checksum checks. Confirm CI and publication. Do more runtime checks only for a real risk or when asked.
- **Worktree setup:** [Automatic setup final](../worktrees/worktree-auto-setup-final.md) and [workspace contract](../worktrees/subagent-workspaces.md) replace old approval and digest-gate plans. CLI setup is automatic. Child trust and web setup are separate. Old security notes do not make one approval rule for all setup.
- **Compaction:** [Active shake-first policy](../compaction/auto-shake-compaction.md) replaces the old manual-only plan. Later choices in [compaction research](../compaction/compaction-research.md) replace early captured-prefix limits. The threshold is product policy, not a value for all work.
- **T3 adoption:** [Lifecycle acceptance](../t3/t3-v2-production-lifecycle-final.md) replaces early unavailable/NOT ADOPTED status. Keep the single-owner lesson. Drop old claims about which runtime owns continuation.
- **Resource findings:** [Lead judgment](../resources/memory-resource-judgment.md) keeps proven bugs apart from normal held data, scale policy, and upstream bugs we cannot reach. [Terminal follow-up](../resources/resource-fixes-terminal-followup.md) replaces quiet normal completion with visible failure and recovery. Do not turn exact caps or guessed concurrency limits into broad rules.
- **Packaging and harnesses:** [Single-binary packaging](../packaging/single-binary-packaging.md) replaces sidecar recipes. [Corrected probe](../packaging/packaged-probe-final-fix.md) replaces the old WebSocket harness diagnosis.
- **Web architecture:** Built pin-plus-patch and [loopback access boundaries](../web/die-web-upgrade-auth.md) replace old fork and pairing plans. Exact mechanisms stay domain policy, not broad architecture values.
- **Preferences:** [Model persistence follow-up](../models/last-used-model-followup.md) replaces the old view that no persistence was intentional. Keep explicit user choices. Do not treat restore or child events as choices.
- **Knowledge upkeep:** [Direct project wisdom](project-wisdom.md) replaces the old pending queue, index, and lock machinery. This work adds derived values and a review habit. It does not add a scheduler, required index, or consolidation service.

## Standing instructions and upkeep

The source of truth is src/prompts/wisdom.md. It tells root agents to read values before big work. At a big finish or handoff, revisit lessons. After a release or wide review, look across affected systems. Merge or revise before adding. Keep links and tradeoffs. Mark conflicts and newer facts. No new evidence? Leave values alone. Missing value? Derive it from project evidence. Do not make up history.

The wisdom extension adds those instructions. It still sends them only to root agents. The lead agent must join the pieces and can give useful values to workers. This is an instruction to agents. It is not a scheduled process that runs by itself. The ten project values are not put in every project's global prompt.

## Checks and what remains

Focused prompt, extension, and real-SDK tests show that root requests get the new instruction and child prompt rules stay the same. Checks passed: 22 tests with 165 assertions, local Markdown links in values and system notes, focused Biome formatting, and git diff --check. This docs-and-prompt change did not need the full product suite.

After the practice audit, user approved PR prep. Branch feat/derived-wisdom-values in /home/tnfssc/Code/die targets develop. The branch adds a short completion result to the standing prompt. project-wisdom.md now points to the source prompt instead of copying old words. This work was not built, installed, or released. Installed binaries need a later build/install or release to get the prompt change. No research jobs remain.
