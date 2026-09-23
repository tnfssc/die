# Full die web integration research — supersedes temporary bridge

User changed scope explicitly: full solution, first-class die subagents/tasks, NOT temporary bridge or Cursor-slot shim.
Reuse T3 Claude/Codex agent/task support where possible; keep T3 parts easy to update.
Research/design ongoing, no implementation requested/started yet (continue refers to research).
Keep actual die runtime and T3server/UI, isolated integration boundary.

Workers: task_69bf7a27 maps Claude/Codex canonical events+UI+controls to die, owns die-web-agent-mapping.md; task_1ab243a7 designs vendor/fork/patch/upgrades boundary, owns die-web-maintenance-design.md.
Main integrates full scope/acceptance/API shape.
Clones /home/tnfssc/Code/die-research; officialT3 pinned01e05c15.
Prior notes temporary conclusions historical only.

Main source finding: TaskManager already exposes subscribe(TaskEvent snapshots), list, inspect(offset/limit), write, closeStdin, kill; events spawned/activity(output|input)/completed/stopping.
JobService parent manager owns real agent processes; grandchild managers live inside spawned orchestrator processes, so a root-only task export does NOT automatically provide complete nested tree/control.
Preserve completion notification ownership, no consuming ACK for UI reads.
New versioned die management surface likely alongside existing PiRPC, need transports considered (dedicated pipe/socket vs widening pinnedPiRPC), avoid browser actions sent as model prompts.
Child transcripts should be read-only views while child active; do not spawn duplicate executors on same live sessionfile.
Full scope includes descendants, attention/input, stop/resume safety, costs and reconnect semantics; no pretending shelljobs are agents.

Previous research: T3 has static internaldriver registration (custombuild required for realdie provider), generic browserdefs/schema settings, native agent/subagentevent layers to investigate.
Cloudless removesClerk; transparentloopback pairing remains, no account UX.
Upstream assets/executable packaging reusable.

Main verified currentT3 providerRuntime.ts TaskAgentLinkage already has taskType, agentKind(agent/background), agentId, parentAgentId, title, role, model, effort, runHandles, outputFile, agentPath, timelineBypass; AgentsPanel.tsx exists.
Must reuse not buildparallelagentUI.
Adapter interface has start/send/interruptTurn/respondToRequest/respondToUserInput/stopSession/readThread/rollback plus optionalcompaction, but no obviousgenericstopTask in ProviderAdapterShape; mappingworker to confirm realClaude/Codex controlpaths.
Design issues for synthesis: stable taskIDs must be scoped by owningdie session (baretask_ IDs are process-local); retainoriginalhandles forcontrols.
Donotflatten nestedorchestrator jobs into root; expose descendantprocess events/controlbroker.
Reconnect snapshot+sequence/offset replay should not duplicate completion modelnotifications; UI observations separateconsumingACK.
T3ownsUI/workspace projections, dieowns execution/sessionJSONL; avoid twowriters/competingexecutors.
Upstreamupdate compatibilityfixtures should cover tree/events/actions and stateformat—not just typelint.

Maintenanceworker complete task_1ab243a7: recommends git-submodule pin to maintainedT3fork (realcompiletimeSPI, not externallyloadableplugin), adapter newdirectories insidefork, small orderedintegrationcommits, no startup patchapplication or wholesale UIrewrite.
Keepsourceancestry+testedupstream/fork/protocolmanifest.
Separate workspacepackage premature because SPI serverinternal+browsermetadata split; use isolateddirectoryfirst.
CI pins/submodules need deliberateinit, knowncrossrepoergonomics costs.
Fullreport die-web-maintenance-design.md.

## Final mapped decision
Research complete. task_69bf7a27 report die-web-agent-mapping.md source-backed: Claude SDK task_started/progress/updated/notification -> T3task.started/progress/updated/completed with usage andidentity; Codex childthread callbacks synthesize same events, but completedturn=idle/resumable notdeadagent.
Current AgentsPanel rows flat/noninteractive; noindividualstop/stdin/outputpager/transcript/resume/snooze/watch.
Existing Stop is session/background-wide, notpertask.
Existing parentAgentId grouping special-casesworkflows; genericdie nestedtree needs extension.
Keep existing UI and add generic detail/actions/hierarchy (not parallelDiepanel).
Full architecture: T3 server/UI/orchestration storage -> firstclassDieDriver/Adapter -> realdie RPC session plus versionedroot taskcontrol service -> recursive actualdiechildren.
Die authoritative execution/sessionJSONL; T3 derivedpresentation+workspace state.
No Cursorimpersonation, no stockPi substitution, no browser logfileparsing.
Snapshot+sequence replay+idempotent controls, nestedmanagerregistration, scopedopaqueIDs, safechildsessionreadonlyinspect and explicitresume required.
Maintenance: pinnedmaintainedT3fork as submodule, adapterisolatedfolder, minimalstatic registration/browsermetadata andprovider-neutral taskcontrols/UI patches.
Selectedupstreamupdates via merge/review/fixturecontract+realbrowserreconnect/task/crash tests thenpinrelease.
Notzeroconflict; currentT3 agentprojection explicitly transitional to futureorchestrationv2, translator boundary contains that churn.
Fullsolution phased forverification, nottemporaryscope.
Userauthorizedresearch remains; noimplementation/services started or productionedits made.
