# Resource fixes + release — authorized, in progress

User: implement merit-approved fixes and make a new release.
Size not obstacle.
Include meaningful history architecture, not only small leaks.
Existing session/server MUST remain untouched.
All tests temporary state/exact owned PIDs.
No install requested.
Publish release only.
Starting die0.3.4 commit f9d3e5c.
Target tentative **v0.4.0** given history architecture/resource-policy changes.
Main owns version, commits/tag/push, official asset validation.

Baseline working tree: audit notes/docs/scripts and index from this conversation, no product edits before workers.
Root source current.
Current WEB source ONLY .cache/die-t3code-v0042 at719a76ca. .cache/die-t3code is stale.
Main alone must recapture canonical web/t3.patch with ALL tracked+untracked current-source changes after backend/frontend finish, check clean-apply in fresh worktree, then build via DIE_T3_SOURCE=.cache/die-t3code-v0042.
Do not lose existing full integration patch.

Workers and ownership:
- task_2a388248 orchestrator: apps/server/** currentweb. Terminal subscriber bound/slowconsumerregression, loggerretention, Pi locks/extensions.
  Notes resource-fixes-web-server.md.
  No canonicalpatch capture.
- task_bb96b777: tasks/task-manager.ts/output-buffer.ts + tests. total completed-output RAM honest outputLost, preserve metadata.
  Notes resource-fixes-job-output.md.
- task_49dddbf2 orchestrator: src/typescript/** + tests. Selective ACK state retirement + per-execute capture budget/close-onerror.
  Notes resource-fixes-execute.md.
  No genericconcurrencycap/TTL.
- task_536d50e4: src/web/launcher.ts/tests. Owned POSIXprocessgroup, escalation, leader-exitcleanup, exitstatus.
  Notes resource-fixes-launcher.md.
- task_ff3bc858: apps/web/** currentweb. Syntaxcache and PRpromptretirement, no desktoprecording/tinycaches.
  Notes resource-fixes-web-client.md.
- task_009e3deb orchestrator: src/history/**, cli integration/buildseam if needed. Disk-backed lazy journal preserving allSDK/branch/history/privacy/persistence semantics. Reproducible freshbuild dependency integration if pinned SDKpatch needed.
  Notes resource-fixes-history.md.
  No edits to other workerownedareas.

Main integrates/reviews, updates docs/resourcepolicy/release notes and CI regression coverage, canonicalpatch, runs full root tests/check/format, currentweb server+client targetedtests/typechecks, browser smokes and shipped Bun resource probes, validates official release/checksum afterCI.
Do NOT release partial unreliable history architecture just to finish.
Need record exact remaining gaps if implementationblocked.
Existing audit manual source-copy tests may assert pre-fix leak behavior.
Distinguish historical measurements from new fixed regression suites.

Main preparation: branch develop, origin git@github.com:tnfssc/die.git, gh authenticated.
Latestreleasev0.3.4.
Set package.json version **0.4.0**, no tag yet.
Existing workflow builds Linuxx64/arm64, macOSarm64, Androidarm64 andpublishes checksums.
Need add regression suites for newbackend/frontendfixes before release.
Do not change existing tags.
Auditdocs/scripts will ship as reproduction evidence.
Distinguish pre-fix leakassertions from newregressions.

First workers done: launcher task_536d50e4 (16targetedtests including compiledprocessfixtures) and joboutput task_bb96b777 (8,000,000-byte default aggregate completed budget incl agentfinalstrings, oldestprefixeviction with outputLost.
Activeperjob1MB unchanged. 57relatedtests pass).
Main reviewed diffs: reasonable, awaiting integratedcompile.
Launcher guard own detachedpgid,5sKILL, firstsignalstatus130/143, leaderexitgroupKILL, idempotentlistener/timercleanup.
Guarantee applies ownedPOSIXgroup, not arbitrarydaemonized escapedgroups.
Fullsuite failures whileCLI imports not-yet-written history adapter/version mismatch expected concurrentstate, not finaltestresult.
History notes now present: prototype/ownedadapter installed beforeSDKmain, persistentJSONL authoritative, target4MiBbodycache, O(entries)metadata, inMemory notspilled, explicit getEntries/getBranch/getTree materialize callerrequestedhistory. prepareassetsPiSHAguard.
Need review ordinaryTUI getEntries scans transient fullhistory.
Do not claim absoluteflatRAM.

Execute orchestrator task_49dddbf2 completed: 10MiB combined capture default optional executeoutputByteLimit.
Explicittruncation/counters, continuesdrain, finallyclosespumps.
ACK release selectiveobservational/background/errors, foregroundresultstillprovisional untilcleanexit.116tests pass, bridge10kprobe0listeners ~1.44MiBheap, executionFD8plateau.
Frontend task_ff3bc858 complete115tests+typecheck.
Promises/unsupportedlabels64-entryLRUs, PRprompt128entries.
Mainreviewed method/result foregroundrecognition and cacheidentityguard.
Mainadded wisdom/resources/resource-limits.md (history/terminal/log details pending) and releaseworkflow backend EventNdjsonLogger/SubscriberStream regression suites+frontendtsc/syntax/PRtests.
Formatted auditMJSfiles.
Await backend/history beforecanonicalpatch/fullbuild.

19:43Z integration blockers/followups:
- Backend task_2a388248 done202tests+tsc+format.
  Newterminal SubscriberStream.ts uses32-eventdroppingqueue withQueue.endoverflow, logger ephemeralperflushsink+allfilesquota, Pilocks referencecountedholders/waiters and optionalfinishedrecords50cap.
  Notes resource-fixes-web-server.md.
- Main found possible silentterminalfreeze: Queue.end is normalEOF but client subscribeDynamic retrieserrors only.
  Started task_2211207d to trace/fix tested overflow recovery/resnapshot and validate bytebound, scope terminalserver+minimalclient-runtime.
  MUST await beforecanonicalpatchcapture.
- Main found footerUsage()/hasUnavailableFastCost() fullgetEntries everyrender would repeatedlyread entirelazyjournal.
  Started task_3a50952b owns src/ui/footer.ts/tests tocache scalarusage permanager/session/leaf and preservelivefaststatus.
  Awaitbeforefullbuild.
- Independent core review task_ad0f731f reads finishedjobs/execute/launcher diffs, noedits, notesresource-fixes-core-review.md.
- History draft realSDK16compactionsoak128MiB originals: JSC18->22.5MiB activecontext2. Reset/resume~19MiB.
  PeakRSS~902MiB during SDKfullarraycompaction, so NOT flatpeakRAM. Boundedretainedbodycache only.
  Adapter correctness/IO testsstillinprogress.
- Sourcecache has untracked wisdom and scripts/leak-audit fromauditworkers: EXCLUDE fromwebpatch.
  Capturebaseline realindex tree + tempindex add-u and add-A ONLYapps/packages inclnewSubscriberStream* and anyterminalfollowupfiles. Reviewnamepaths.

19:53Z: Main fixed all independentcore-review findings: account/evictcompletedstorage BEFORE callbacks/events (deliverysnapshotpreserved).
Noemptyzero/exhaustedquota artifactpaths/directories.
Spilledcaptured-bytecounts nowactualsuccessfulwrites, storagefailuresnotmisreportedquota.
Addedobserveragentfinal + zerospill/exhaustedstream/unwritablestats regressions.59tests/3filespass.
Footerworker task_3a50952b donecache-onlyscalars bymanager/session/leaf.
Footer+rootcheckpass.
Terminal followup task_2211207d CONFIRMEDsilentEOFfreeze.
Fixed recognizabledie overflowtransportdefect, terminal-only100ms same-sessionretry/resnapshot,32events+64MiBserializedupstreambound. 15tests+typechecks.
Note wasincache .agents copiedtoroot.
Main reviewed snapshotlifecycle increments on reattach.
Canonicalwebpatch captured includingclient-runtime changes+2newSubscriberStream files.
Excludesauditnotes/scripts.
Reversecheck andcleanworktreeapply succeeded.
SHA25660243189e9169193a3b4d4724a16c4413ac15b455ea922a4220b4636f7abf3cd.
Main started freshwebbuild withcurrentenvsource task (see jobs) -> artifacts/resource-web-build.log.
Releaseworkflow nowgates backendnewregressions, frontendcaches, clientruntime terminalrecovery+tsc.
Awaithistoryfinalworker andfreshbuild, then rootcompiled/fulltests/browser.

20:01Z Mainhistoryreview found real failedpublishcollision inconsistency, evidence /tmp/die-history-publish-repro.ts and history-main-findings.md: store adds failedassistant, managerleaf/skeleton notadvanced whenlinkEEXIST.
MUSTFIX beforetag.
Independenthistoryreview task_07dc6a9f active.
Main alsofixedfooter cheaprevision: identity+leaf alonemissesappend-then-branchbackbetweenrenders.
AddedweakfileEntriesidentity+count (pinnedSDKmetadataarray) tocachekey, nofullbodyretention, fallbackuncachedunknownmanager.
Regression+16footertests+rootcheckpass.
Freshwebbuild task_5b836f3b PASS, archiveSHA2d2077ba1076d11784e99f84af2f60e055a1e64ac17f961b2765f0a5dd266552.
Mainwebgates task_1581944e PASS: server146tests+tsc, web115+tsc, clientruntime34+tsc.
Need actualnewcompiledCLI/browser/fulltests afterhistoryfixes.

20:07Z: firstintegratedcorebuild succeeded.
Fulltests668pass14skip3fail (685total).
Two failspromptdescriptionstatic-vs-appendedsuffix: mainmovedcapturepolicyintoembeddedexecute-description.md andremovedruntimeappend.
Needsrebuild.
Standaloneembeddedwebhelpfailure diagnosedcapturedstderr ENOSPC, NOTbackendbug: /tmp tmpfs16G 98%used~346Mfree, dominatedUNRELATED /tmp/runtime-recheck-* directories.
DO NOTDELETEunknown dirs.
Runallfurtherlargefixtures withTMPDIR=/var/tmp (264Gfree).
Browserharnessalreadyuses/var/tmp.
Mainimprovedweb-runtime testerrorreportwithstderr.
History review task_07dc6a9f complete: actualprepareAgentSession() leaks initialpendingfile untilprocess exit.
Failedforkcollisionleavespendingtoo.
SDKprobe10tests passed,nohappy-path loss.
Followuporchestrator task_68bbea61 nowowns historycleanup+transactionalfailurefix incl tasks/agent-session.ts temporarymanager cleanup ifneeded.
Originalhistorytask_009e3deb implementationdone finaltests/reportonly.
Followupnotes resource-fixes-history-followup.md.
Mustawaitfollowup before finalcompiledcandidate.

20:10Z: all4candidatebrowserfixtures PASS oncompiledv0.4.0 (generalHTTP+terminal/chat/tasks4localrequests.
ModelA/B/A2. Stop. Modefast/normal/orchestrator5), logsartifacts/resource-web-{smoke,model-smoke,stop-smoke,mode-smoke}.
These precede finalhistorycleanup fixes.
Rerunatleastgeneralbrowserafterfinalcompile.
Standaloneweb-runtime5tests PASS withTMPDIR=/var/tmp.
Sourcecapturepromptpolicy consolidated.
Requiresnewbinaryforfinaltests.
Mainpublicdocsresource-limits completed (4MiBbodycache/O(entries)metadata/explicitarraypeaks,32events64MiBterminalretry,512MiB14daylogs5mincadence).
Historicalauditdocs/scripts clearlymarked pre-fix assertions.
Ephemeralbootstrap tokens redactedfromarchivedauditJSON.

20:15Z: Final source build/typecheck passed.
Full suite had one stale prompt test assertion demanding old unlimited-capture wording (674 pass/14skip/1fail).
Updated assertion to explicit 10MiB/truncation policy, rerun task_8a18f371.
Final all-four browser smoke rerun task_07a3208f PASS on final binary.
Standalone isolated HOME/PATH smoke PASS v0.4.0.
Format audit JSONs normalized.
Format,lint,frozen install,tag validator all PASS.
Independent final history review task_41b8bd76 pending.
Release body staged ignored artifacts/release-v040-notes.md.
No commit/tag/push yet.
After review+fullsuite pass: stage reviewed code/docs/notes/scripts, commit/tag v0.4.0,push develop+tag, gh run watch then verify official Linux SHA/version/source and gh release edit body.
Do not install.

Final gate: 675 core tests pass,14 paid/live skipped,0failed.
Web146+115+34 pass.
All4 browser checks pass.
Standalone version0.4.0 pass.
Independent final review resource-fixes-final-review.md found no remaining blocker (14 focused history tests pass).
Preparing v0.4.0 commit/tag/push.
Publication not yet confirmed.

20:23Z: Commit147a6d97424b45b9c2239146ddf1c3a947a7845d pushed todevelop.
Annotated immutable tagv0.4.0 pushed.
ReleaseCI35391157155 queued.
Watch job monitors artifacts/release-v040-ci.log.
Need awaitCI,download officialLinuxbinary+sha+SOURCE,verify isolated version.
EditGitHubrelease body fromartifacts/release-v040-notes.md thencommit/push publication notes.
Installed binary unchanged.

COMPLETE: https://github.com/tnfssc/die/releases/tag/v0.4.0 published.
ReleaseCI35391157155 SUCCESS.
Allfourplatformbinaries/checksums/licenses/SOURCE present.
Official Linux x64 downloaded artifacts/official-v040, SHA25623bf393b43eea6d078a2b964b127493ac7c856134963ea1ad7959bfc4a43cb81 verified.
IsolatedHOME/PATH=/nonexistent reports0.4.0.
SOURCE confirms147a6d97424b45b9c2239146ddf1c3a947a7845d.
GitHub release body updated with policies/limits.
Installedbinary/userprocesses untouched.
No release work remains.
Accepted/nonfix audit findings remain documented.
