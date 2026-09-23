> Current result: canonical T3-v2 adopted after all blocking lifecycle/native/browser/package/migration gates passed. See [t3-v2-production-lifecycle-final.md](./t3-v2-production-lifecycle-final.md) and artifacts/t3-v2-lifecycle-acceptance.json. Earlier design checkpoints below are historical.

# Production continuation design (2026-09-21)

Owner: delegation/adoption coordinator. These are implementation decisions. They do not claim completion.

- T3 is sole child process, graph, transcript, durable result and model-delivery owner. Root jobs expose bounded read-through projections only. No second completion injection or child session files.
- Add Die-specific authenticated MCP contract rather than invent unsupported delegate_task fields. Backend binds parent and profile/depth policy to provider-issued credentials. Client profile is a request, never authorization. Fast/normal cannot delegate; orchestrator may within backend depth limit. Backend resolves actual model/thinking/role from trusted Die config.
- Tools: die_task_launch({clientRequestId,prompt,profile,timeoutMs?}), die_task_observe({taskId}), die_task_cancel({taskId}), die_task_list({}). Common v1 result: taskId, childThreadId, optional childRunId/childNodeId, status running|completed|failed|cancelled, profile fast|normal|orchestrator, depth, optional output/transferId. list returns {tasks: result[]}.
- Observe/list never acknowledge model delivery. Native launch is explicitly async-only; root reports background:true with deliveryMode native-async. waitSeconds is not represented as successful foreground wait. This avoids a second ACK owner. Root docs/tool guidance must say so clearly. Backend result is persisted, not copied into another registry.
- Launch identity must be committed before network I/O and reused on replay. Prefer durable execute invocation + call index; root owner investigates exact existing lifecycle. Backend existing graph/event persistence provides dedupe and conflicting-key validation. No generic broker/TTL subsystem.
- Ordinary parent handoff/turn completion/interruption does not imply child cancellation. Explicit selected-child cancel closes its subtree, not siblings. Backend process shutdown closes live owned processes; durable graph/restart semantics tested separately. MCP transport close is not cancellation.
- Remote input/closeInput unsupported explicitly. Remote watch/snooze must be truthful unsupported if native delivery cannot honor them. Local CLI/shell behavior and cards remain independently owned by Die.
- Candidate not adopted until functional/backend/browser/preservation/resource evidence. Canonical pin is unchanged during implementation. Every candidate source change exported in reproducible patch before handoff.

## Assignments
- task_d8a00b29: backend Die schemas, MCP services, authoritative policy, native graph/durable replay.
- task_4e8df9b0: root typed bridge, execute identity, jobs routing/tests, MCP contract integration.
- task_0fa81efb: candidate loopback security, local shell observability, PiAdapter preservation.
- task_fc10e12d: producer/subscriber/retry bounds, release/hard-stop and resource tests.
- Coordinator: shared contract alignment, real deterministic native integration/browser acceptance, canonical patch/build/adoption review.

No release/install/version/push. Temp state and owned loopback processes only. Historical experiment paths may inform investigation but are never production dependencies.

## Main coordinator ownership confirmation
No other active implementation/preservation/browser workers were assigned by main. Earlier auditors and implementation owners completed. task_46b7d551 and its child workers have sole production ownership as assigned; main will review/test afterward.

## 05:37Z integration decisions
- Keep die_task_cancel({taskId}) exact shared contract. Cancellation is idempotent for the same durable task/subtree; backend can derive its internal command replay key from scoped parent/task identity. No client-provided cancel replay ledger is needed.
- Explicit waitSeconds:0 is accepted as async launch; positive waits rejected with clear native-mode explanation. Omitted waits default async in scoped mode only.
- Scoped root routing does not authorize using DIE_SUBAGENT_DEPTH/TYPE nor compare depth against inherited local env. Backend credential/lineage policy is authoritative. Local CLI retains existing two-level/profile checks.
- Root replay refinement worker task_5dd54eeb wires durable execute invocation + call ordinal to avoid identical concurrent prompt collision.
- All builds/tests use TMPDIR=/var/tmp because /tmp is full. Do not delete unknown/user files.

## 05:46Z accounting and preservation decisions
- Web native descendants use T3-owned usage aggregation: each descendant own usage once, never summing previously aggregated parent values. Die CLI session-cost behavior unchanged. task_be680a0b owns verification/implementation and Herdr/liveness tests.
- Headless RPC native children remain non-reporters to Herdr (existing TUI-only guard); web liveness comes native graph pending descendants, not duplicate Die task state.
- Preservation owner completed loopback auth, plain startup URL, independent mode/model, command-job cards and shell-lifetime handling. Tests passed; packaged/live preservation still requires combined validation.
- Backend refinement task_c9a7f415 now owns cancel reconciliation, authoritative model/thinking config + bearer tool restriction, timeout enforcement or explicit rejection, and bounded telemetry. No accepted-but-ignored fields allowed.

## 06:02Z worker lifecycle
- Resource worker task_fc10e12d stopped after >30min model-response streaming with no tool progress. No resource milestone claimed. Replaced with task_44161b1f queues/retry bounds and task_37c7fff0 provider hard-stop/resource probes.
- Browser preparation task_15f0c015 safely stopped while awaiting final executable; its harness changes are retained. Coordinator will launch a focused live browser follow-up with the exact build hash when available (no pending browser process was running).
- Added real-registry/MCP opt-in hook to testkit/ProviderReplayHarness so deterministic live integration cannot accidentally use testkit fake credentials.

## 06:05Z bounded telemetry contract extension
Backend + root now agree die_task_list({cursor?:string,count?:number1..100}) -> {tasks,total,nextCursor?}; result optional outputTruncated indicates bounded summary with original transcript remaining in child thread. Root combines a bounded local/native page, not a second result registry. Backend max depth now2 preserves existing Die delegation hierarchy; root parses bounded native metadata but never authorizes from process env. Shared exact fixture is tests/fixtures/t3-native-task-contract.json; original scripts/native-contract.fixture.json is superseded and removed.

## 06:53Z integrated validation snapshot
- Root full suite:702pass/14skip/0fail,4547assertions; subsequent retry classification test added and focused26pass/101assertions (final full rerun still planned).
- Candidate focused contracts/backend/security/Pi/manager/terminal/accounting selection:43files684tests PASS.
- Candidate full workspace types:all15packages PASS,0cachehits after fixing literal narrowing and typed test errors introduced by resource/accounting patches. Effect suggestions remain non-errors.
- Candidate exported clean-apply verified snapshotc774bee2d9a3e126668fca57799b88158f23d65a3ba802b050b389f61025df1c at06:37Z; final refresh required after active cancellation/native acceptance edits.
- pnpm11 attempted automatic dependency restoration during typecheck and aborted non-interactively before removal. Candidate build now sets pnpm_config_verify_deps_before_run=false so checks/build never implicitly purge/install a reviewed workspace. Explicit output deploy remains packaging only.
- Native real flow has launched children and nested leaves; idle/waiting-ancestor cancellation is a reproduced functional gap assigned task_894b2af4. No browser/adoption claim until corrected/validated.

## Main review 07:13Z
Main launched task_747b9466 independent READ-ONLY review of current root native bridge/execute identity/contract -> wisdom/t3/t3-v2-native-root-review.md. No implementation overlap, no shared builds/runtime. Incorporate findings when available before final gate.

## Main independent current-code review gate (07:20Z)
READ wisdom/t3/t3-v2-native-root-review.md (task_747b9466 complete). Current claims, not obsolete draft: parent T3 bearer inherited by execute runner + shell -> directly printable credential; scrub bridge URL/token in model-directed child env while parent JobService retains capability (not claiming sandbox vs filesystem). Launch retry misses successful HTTP truncated/invalid JSON/SSE and internal timeout after commit; classify ambiguity, same stable key bounded replay, never retry definitive auth/caller abort. #launchLedgers Map caches every session path forever; eliminate or bound while preserving same-path concurrent serialization. Mixed local/native numeric pagination recomputes offset from changing local.length -> duplicate/skip; stable phase/native cursor or explicitly separate listing. jobs.stop cancellationRequested true on already completed tasks contradicts backend.
Exact contract + deterministic invocation identity verified as correct by reviewer. Do not regress them. Please assign fixes/tests and record disposition before final root/native gate. Main made no implementation edits.

## 07:31Z final integration assignments
- task_d72aed87 owns all root independent-review fixes + regression tests (credentials, ambiguous replay, ledger cache, pagination, truthful stop).
- task_ff1f592d owns nonadopted export/build and real same-server browser acceptance now. No more pending-artifact handoff.
- task_50ec7d48 continues real backend/PiAdapter/Die deterministic native acceptance and fault flow.
- Coordinator reviewing integrated contracts/preservation; canonical remains untouched until real evidence.

## 07:39Z broad candidate run (not a pass)
Direct root vp test exercised 18,103 tests:18,077 passed/9 failed/17 skipped;13 failed files include six runner/config suite failures (.github node:test scripts and wasm web config). Actual new MCP/toolkit/readonly-list/provider probe/replay failures assigned task_37369d33 for fixes+proper-config rerun. This worker may change candidate source; browser build must refresh final export after it completes. Full log /var/tmp/t3-production-candidate-full-tests.log.

## 07:40Z real native flow first PASS
/var/tmp/native-run26.log and scripts/t3-v2-production/artifacts/native/proof.json report actual HTTP MCP/PiAdapterV2/compiled Die,4owned PIDs reaped,0Diechildsessions,1nestedchild,1completiontransfer,0foregroundACKs,parenthandoff survived,subtreecancel+siblingisolation,uniquecredentials,restartsamekey+0duplicatechildren. Binary root sha8fd3da7f26fa9f67f734ef4be53cd5c25f1281f1de19ccb82bcdd2738851971d. This is NOT browser/packaged candidate proof; final revised root/bundle needs rerun after review fixes.

Build coordination: the root review worker runs bun run build for full tests. That writes shared dist/die-web from the canonical pin. Right before compiling the candidate, the browser builder must check that dist/die-web/SOURCE.txt matches candidate patchHash. Rebuild the final candidate after the full root build finishes. A separate candidate outfile does not isolate the shared archive input.

## 07:42Z backend independent review disposition underway
Review task_2f82f274 found cancellation-vs-launch race, unusable task_status wake instructions for restricted Die credentials, and count-only continuation payload bounds. Repairs task_e2305db4 (serialized ancestor cancellation fence; also verify root identity concern against actual server-selected Die adapter) and task_902acfb5 (wake text+byte bounds). First review identity claim may conflate server-wide trusted Die replacement of pi with unrelated same-driver instance; worker must prove dispatch/config binding or fix. These new source edits require final export/build/native rerun, not reuse earlier hashes.

## 07:47Z root review fixes complete
All independent-root findings repaired; targeted32native+17bridge pass; full root710pass/14skip/0fail4575assertions,check+build pass with TMPDIR=/var/tmp. Root bun run build now finished; candidate builder can safely overwrite shared dist/die-web and compile exact candidate. No more coordinator root canonical builds until browser packaging complete. See t3-v2-native-root-review-fixes.md.

## 07:53Z backend P0 resolution
Cancellation/create now share orchestrator mutation serialization with durable ancestor fence; barrier regression proves paused late launch denied and existing descendant torn down. Root-identity finding resolved as source-grounded nonfinding: trusted server config force-replaces entire built-in pi adapter binary with Die; distinct pi instances remain denied. Extracted identity helper+dispatch/denial tests.9focused tests pass; see backend-review-fixes.md. Final types/native/browser rerun still required.

## 07:58Z final integration refresh
Review-fixed actual native acceptance PASS /var/tmp/t3-native-review-final.log using newly-built dist/die root (canonical web unused by this test). Continuation27tests pass. Full workspace types exposed only6 Effect diagnostics in resource test; coordinator replaced console JSON samples with Effect.logInfo and documented narrow native-PID/wall-time test exceptions; rerunning full15pkgtypes+providerresource41tests. Browser build must refresh export for these test-source changes. No new production policy work outstanding.

## 07:59Z actual integrated regression found
Workspace15pkg types PASS after narrow resource-test diagnostics repair. Resource41suite40pass1fail exposed a policy integration bug: terminal ancestry deny becomes undefined, manager minted generic orchestration capabilities and classified child as30min root. Assigned task_91e28295: server-trusted Die identity must remain restricted even without live delegation policy; never generic fallback; separate lineage idle classification from authorization; real registry negative tests+resource rerun. Adoption explicitly blocked until repaired. Broad-suite introduced failures otherwise fixed; proper runner/config reruns pass174core/provider/Claude+2MCP+76Ghostty+98Git+34Node+Codexreplay. Two desktopWSL fixture-only failures remain documented, not relevant shipped server/web but full-all-tests is not claimed.

## 08:09Z policy escalation fixed, final reruns
Manager now restricts known Die identity even without live policy; exact capability reuse check rotates legacygeneric credentials; terminal/disposed native identity retains5sidle separate from delegation auth. Registry-backed negatives+42manager+6policy/service pass. Final types+broad regression run task_a846513e explicitly excludes separately-tested node:test/WASM configurations and two documented desktopWSL fixture failures (no universal pass claim), native task_6f00bdf3 reruns final policy, root full suite reruns without shared build mutation. Browser/package final export must include this repair.

08:10Z root check now blocked by actively-owned packaged-smoke.ts missing ws declarations and implicit _request/response types (lines13/83). Packaged-smoke worker task_62b5f1e9 must clear before final root test/check. No dependency install needed (use Bun/WebSocket client or existing typed patterns).

08:14Z final broad run:18,027pass/3fail/17skip; two Git root-config failures (proper package98pass earlier), resource probe now classified OS reaping race after controlled clock deadline. Added bounded2s real-time exactPID reap observation (still assert alive at4,999ms. No policy deadline relaxation),42resource testsPASS. Starting proper-package full server run to avoid root config ambiguity. Packaged relocation/security/settings smokePASS exact cabdbde...; final hash rerun required. Follow-up task_37799c34 owns real shellcards/terminalinput-resize preservation.

08:16Z final root710pass/14skip/0fail4575assertions+check PASS; actual four-tool conformance PASS; migration synthetic old719a76 disk schema/history6messages/provider/turn/checkpoint preserved and restart idempotent PASS /var/tmp/t3-final-migration.log.

08:24Z full server package run timed out600s before results (task_698ce968). Do NOT claim server full pass. Broad root-run18,027pass remains evidence, resource42 now repaired+pass, isolated Git98 rerun underway. Candidate metadata now typecheckVerified=false from worker bypass during prior red diagnostic period; coordinator running final workspace types again; cannot adopt on unverified metadata.

08:26Z final workspace15pkg typecheck PASS /var/tmp/t3-final-workspace-types.log (task_5fdb1848). Only last test-source delta documented realwallclock Date.now exception. No production delta. Git isolated98PASS. Browser builder MUST finalreexport include current tree and build without skiptypes; previous typecheckVerified:false artifact not final.

## 08:33Z preservation live blocker
Packaged preservation: realWS delayedterminalIO+resizePASS, shellrunningcard+handoffliveness+reloadPASS, completed shellcard disappeared FAIL. Assigned task_5417e7fc actual PiAdapter/UI lifecycle persistence fix+regression and rerun. Candidate browser worker finalexport must follow this fix. No adoption before. Evidence artifacts/t3-v2-preservation-acceptance.json; latest tested executablef666b829d2a6b8070f20b2c7ca8561f9a1b1a029b92a5ac98b807cafb49f5c46.

## 08:34Z same-server browser PASS
Exact patch17c685873864630a1d514b4c7de61d32059aea2639a4c4294d8d190773d71cf9,executablef666b829d2a6b8070f20b2c7ca8561f9a1b1a029b92a5ac98b807cafb49f5c46,typecheckVerifiedtrue. Browser real runningchild open,exactlyone completionwake+jobs.inspect,secondchild browsercancel,parentobserve,exactroute/transcript reload PASS. Production fixes version-probe and childreload routing included. Allownedprocesses cleaned. Remaining live adoption blocker completed shellcard task_5417e7fc; finalbundle+acceptance needs refresh after fix.

2026-09-21 shell-card fix in progress: root cause is not adapter ID churn (Pi emits stable `die-shell:<taskId>` item/node/ordinal); terminal local-shell command is merged correctly but then collapsed with its execute carrier into historical "Worked for" summary. Candidate fix marks Pi/Die local-shell projected work entries as lifecycle-preserved and makes them a historical grouping barrier, retaining the same visible command card through running->terminal and reload. Added adapter identity, client reducer snapshot/reload, and timeline running->terminal regressions. Preservation harness selector is also corrected from unsupported "Completed printf" to canonical UI label "Ran printf" (existing MessagesTimeline tests prove Running/Ran verbs). Browser/build owner task_ff1f592d: after tests/final note, regenerate export and candidate before rerunning preservation acceptance. Do not export current pre-fix patch.

2026-09-21 shell-card fix READY FOR EXPORT: targeted PiAdapter/timeline/client reducer suite 3 files, 187 tests PASS; vp check 5 files PASS. Detailed report `wisdom/t3/t3-v2-shell-card-fix.md`. Browser/build owner task_ff1f592d should now export, rebuild candidate, and rerun `preservation-acceptance.ts`; expected terminal selector is canonical `Ran printf`.

## 08:45Z final source freeze/build
Shellcard fix preserves die-shell nativeItemRef cards outside settled folds; adapter/reducer/UI running->terminal+snapshotreload187testsPASS. Coordinator task_9d968a05 now exporting cleanapply+fulltypes+bundle exact final source. task_fa16eec8 root format/check/fulltests. No further candidate edits planned until final acceptance results. After build coordinator will run native+browser+preservation+packaged security same hash and decide adoption.

## 08:52Z final samehash acceptance
Build106570f1patch/bb4238757ef75eb4eb75142433f805cfb54865864de90403c8fb05510735717aEXE:typecheckPASS,cleanapplyPASS,nativePASS,browserPASS,packagedsecurityPASS. Preservation FAIL now completed shellcard visibly Ran printf (UI fix works) but second prompt fails ProviderAdapterEventStreamError ended unexpectedly. No pendinghandoff/reload proof on finalhash. task_55ef57e1 investigating actual stream reuse bug. Current artifacts/t3-v2-preservation-acceptance.json contains exact error/projections. Must fix real session reuse before adoption; not treating old pendingcardPASS as current.

08:53Z stream review task55 initially inspected superseded artifact (no error at inspection); CURRENT finalbb423875 proof does contain provider EOF before teardown and secondturn failure. Reassigned task_b8c4dcfc with exact current evidence+15min repair budget. Do NOT treat stale no-bug conclusion as gate resolution.

## Main timebox checkpoint 09:09Z
Parent implementation task_46b7d551 has ~14m left on 4h job runtime limit. Prioritize capturing current child jobs, exact artifact/source hashes, owned process cleanup instructions, root cause evidence and remaining session-reuse blocker in production note before timeout. Do not adopt with preservation failing. Main can continue with new owner if needed. Native finalhash tests pass, ordinary local-shell wake/reuse is still an adoption blocker.

## 09:11Z last preservation root cause+fix
Definitive DB ordering shows250ms CompletionBatcher steer after RPCagent_end => unowned Pi activity => strict process shutdown, not EOF policy failure. Root tasks/extension now synchronously flushes completionbatch at RPCagent_end; new regression23testsPASS. Rebuilding same exact backendarchive+root fulltests task43d927f3; then four samehash acceptance reruns. No EOF/error suppression/resource widening.

## 09:15Z final live rerun supersedes unit-fix claim
Newroot executable9fde1b1d90a54555c65d161414bb4c4c588ac688b82adbae0d9f3a4ab0660196 still fails preservation: secondturn ProviderAdapterEventStreamError after completedlocalshell. Synchronous RPCagent_end batchflush alone INSUFFICIENT. Native/browser/packagedsecurity allPASS samehash. Canonical NOTadopted. Finalnote t3-v2-production-final.md captures blocker. No broad productionreadiness claim.


## Lifecycle completion ownership follow-up (2026-09-21, in progress)
Exact former candidate 9fde1b1d... reproduces the blocker. Pi transcript: task-complete custom_message at 09:18:42.507Z, new model request .511, response .512, shutdown .518. T3 projection: first provider settled .302, first run completed .351, second user run created .489, unsolicited-activity provider error .519, second run started .571, failed one second later. This is the adapter's intentional unowned-activity kill, not unexplained spontaneous EOF. Raw selected DB trace /var/tmp/t3-lifecycle-events.json; private state /var/tmp/die-t3-v2-preservation-9d33WX.
Root agent_end flush cannot cover jobs completing after agent_end. Chosen direction: authenticated Die local notification -> durable/idempotent T3 message_text queue_after_active -> T3-owned provider run, with root persisted pending delivery until durable ACK, preserved CLI sendMessage ownership, native child delivery unchanged. Implementation worker task_86f506dc has sole product-source edit ownership; coordinator edits only acceptance harness/notes during its work. No adoption until final gates. Harness now requires model-visible completion wake exactly once before successful second user shell/handoff, no unsolicited-activity/failing run, reload, settings and terminal preservation.
Rollback baseline git HEAD 05ff98f5907bf5ae0ea83823471b96b945d1252e; original canonical files saved .agents/rollback/t3-v2-lifecycle (source SHA 1b609eca..., patch SHA 60243189...).

### Reviewed local notification seam (follow-up in progress)
Completion is persisted synchronously to a bounded fsync/rename per-Pi-session mailbox before HTTP delivery. Server derives source run from durable die-shell node, validates current durable app/provider-thread + provider instance (not auth credential UUID), and dispatches queue_after_active with thread/task-derived terminal identity. Duplicate UUIDs cannot create a second completion wake. Attention uses the same durable command admission but deliveryIntent:auto so an idle Pi retained by a running shell is steered through the owned T3 turn instead of deadlocking behind itself. Source-run Stop and stale attention dispose under the Orchestrator lock with a durable receipt. Root CLI batching stays unchanged.
Delivery has one bounded in-flight MCP client, bounded retries per pump, one unref capped-backoff timer while pending, and Stop clears timers/aborts/awaits clients. New enqueue during ACK drains without needing another user turn. Web local launch reserves mailbox capacity before spawning (max50 running,64 pending/reserved); CLI has no new limit. Payloads remain bounded5000chars;64 worst-case escaped rows fit4MiB.
Two findings in first built candidate were fixed before final rebuild: credential-id/runtime-id mismatch rejected valid wake ownership; bounded retry originally stopped forever when idle. Full acceptance still pending. No readiness/adoption claim.

## Final adoption evidence
Canonical pin/patch now a9b49a7d / a98ba104...; final normal default-source executable8932d0e... All concrete gates repeated successfully on the canonical executable and fresh independent revision-keyed source. Full workspace15package typecheck, root721pass/14skip/0fail, native, same-server browser/preservation, package and migration PASS. Native children remain only T3-owned; local shell notifications now use durable outbox→authenticated T3 admission rather than autonomous Pi triggerTurn. Explicit CLI behaviors remain intact. Final notes/artifact contain rollback and limitations. No release/install/version/tag/push or user-server changes.
