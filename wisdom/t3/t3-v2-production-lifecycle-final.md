# Production T3-v2 lifecycle integration — ADOPTED

Final canonical source: a9b49a7df0a4261dcc438d4493cc3154a1d9819e.
Patch SHA256: a98ba10466328f7800f0d64a1f5df88dcf290980fdeb30e80a2412e6114f7e91.
Canonical executable: dist/die-t3-v2-production (normal default-source build, separate outfile protects existing live dist/die).
Executable SHA256: 8932d0e7561c0b79d6647c0f617ae548087e7d74bb27c740011ad245b16bb716.

All blocking gates passed against that final executable and exact canonical source/patch: full15-package workspace typecheck; root721pass/14expected paid-live skips/0fail/4601assertions; native child/nested/cancel/restart/once-only delivery; same-server browser; ordinary shell running→terminal + exactly one owned completion wake + racing and subsequent user prompts + handoff/reload + terminal input/resize; relocated package/Host/Origin/WS smoke; migration fixture/history/provider/checkpoint/restart. Root check/full lint/scoped format PASS.

Final proof: artifacts/t3-v2-lifecycle-acceptance.json (all individual proof paths and rollback). Canonical build uses the fresh independent .cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e checkout and normal web/t3.patch, no source override/reuse-web/research imports. The checkout's git metadata was also made independent of the candidate checkout. Final package/runtime regressions use only the canonical executable/source, not candidate-only runtime paths.

No release, application installation, version bump, tag or push. Installed binary, original dist/die inode used by unrelated pid894464, existing user state and existing servers untouched. All owned acceptance processes reaped; /proc owned-fixture cwd/exe scan empty, including isolated full-root-suite children. Deleted the isolated test copy after success; retained initial private reproducer /var/tmp/die-t3-v2-preservation-9d33WX and trace /var/tmp/t3-lifecycle-events.json.

Limitations: no zero-memory-leak claim beyond bounded PID/FD/queue/cleanup evidence; 21 pre-existing experiments-only formatting errors remain; no universal broad upstream test-suite pass (prior desktop WSL fixture portability failures and broad-server timeout remain documented); no new packaged compaction/accounting/mode-switch claim. Native foreground waits/runtime deadlines and stream/watch controls continue to reject explicitly as documented, rather than silently degrading.

Rollback canonical source+patch from .agents/rollback/t3-v2-lifecycle/web--t3-source.json and web--t3.patch, or original git HEAD05ff98f5907bf5ae0ea83823471b96b945d1252e. No commits were made.

## Investigation and implementation history

# Lifecycle final — in progress

Fresh exact previous candidate reproduction failed 2026-09-21. Temp /var/tmp/die-t3-v2-preservation-9d33WX (KEEP=1), command log /var/tmp/t3-lifecycle-repro.log; selected event trace /var/tmp/t3-lifecycle-events.json.

DB orchestration_events (not orchestration_v2_events) proves:
- 09:18:42.295 provider ready; .302 provider turn completed; .351 run completed
- .489 second user run created
- .519 provider-session error: Pi started agent work outside an active T3 turn. The session was stopped to prevent invisible tool execution.
- .571 session ready/run2 running (races stop)
- 09:18:43.521 run2 failed; .531 unsolicited activity error; .560 generic unexpected stream end

Exact cause chain under investigation: completion debounce 250ms after settlement -> unowned Pi agent_start -> intentional adapter termination -> stream EOF while next run starts. No suppression or adoption. Read-only workers task_db197b1a (root), task_69429dc9 (backend). Repro task_2bd316fe complete failed and harness owned process cleanup executed.

Sole product implementation delegated to task_86f506dc; coordinator only acceptance harness and notes concurrently. Read-only root diagnosis task_db197b1a finished and independently confirms causal ordering.

Both read-only workers complete and independently confirm intentional Pi kill at unsolicited agent_start. Initial harness root check PASS (/var/tmp/t3-lifecycle-root-check-initial.log); not final edited-product validation. Exact /proc exe scan found zero surviving processes from retained fresh reproduction temp. Canonical rollback files saved in .agents/rollback/t3-v2-lifecycle; no adoption edits. Remaining owned running job: task_86f506dc implementation.

## First repaired candidate live result / follow-up
Full workspace typecheck/build PASS, candidate8b77b1e... patchf385331f... Live initial acceptance FAIL: second racing user works and no unowned activity, but completion outbox stays pending. Probe real authenticated fixture MCP response reports task_not_found. Root cause: McpInvocationScope.providerSessionId is a random auth-credential ID (McpSessionRegistry.issue), NOT provider runtime session ID. Corrected validation to durable app/provider-thread + provider-instance binding, preserving restart replay and rejecting other threads. Canonical unchanged.
Read-only reviewer task_303d8867 identified idle-retry and Stop-after-sleep races: fixed bounded idle retry timer, abort+await client on Stop, cancellable retry delay; stable per-task completion IDs now enforced server-side, source authority thread-scoped. Host notify tool excluded from Pi model registration; Die execute credentials remain scrubbed. Added root regressions duplicate completion after ACK, enqueue during in-flight ACK, idle outage recovery, Stop delay cancel. Tests-only task_165b2b79 adds actual DB/orchestrator Stop/queue/replay tests; no product edits by that worker.
Attention cannot queue behind a source turn held open solely by its running local shell. It now dispatches durable message with deliveryIntent:auto (T3-owned steering when active, queued wake when idle), retaining local shell turn/pending-work and Stop semantics. Terminal completion uses durable queue_after_active notification. Stale attention is durably disposed under the same thread lock.

Follow-up review: accepted and fixed head-of-line starvation (completion-priority fair bounded passes); rejected directory-fsync finding because #commit already fsyncs parent directory, and rejected durable-success-after-Stop ACK finding because only a positive committed/disposed server receipt permits removal (safe durable ownership, not volatile delivery). session_start now awaits the previous delivery stop, so no same-extension concurrent mailbox writers. Cross-process shared-session writes are outside authorized single-provider-thread process ownership and not claimed generally safe. Root notification tests10pass; adapter/service/source tests61pass; full final candidate rebuild waits test-only worker completion.

Real SQLite/orchestrator tests now5pass (atomic Stop, all terminal cancellation states, replay receipt, concurrent queued user, stale attention disposal); service tests5pass including auth credential/runtime ID mismatch fixture and attention auto-steer command. Build2 caught test-only nativeRef.strength widening; fixed with literal const and reran tests. Build3 task_a1525e61 running full workspace types/exact exported candidate. No source workers running; all product ownership back to coordinator.

## Candidate gates (2026-09-21 10:13Z)
Pinned a9b49a7d; patch a98ba10466328f7800f0d64a1f5df88dcf290980fdeb30e80a2412e6114f7e91; executable8e277017a3cd05d46d00bc6f563a57875ecb7793bd19fa792e4b4645e36ec0ec. Full15-package workspace types+web/server bundles+clean apply PASS. Real native integration, same-server browser, same-server preservation, packaged security/relocation, migration+restart all PASS. Preservation requests complete-tool, complete-settled, complete-wake (once), racing-user, next-user, pending-tool; no failedrun/unowned activity. Outbox empty after server durable ACK. Native exact ownedPIDs allreaped; independent /proc fixture cwd/exe scan no survivors. Artifacts current at standard paths, source provenance +cleanup artifacts added.
Existing unrelated pid894464 uses repository dist/die (offline CLI, not our child). Attempted direct copy correctly refused ETXTBSY; no inode/process/state changed and no signals sent. Full root tests run from exact copied source with candidate as temporary dist/die; future default-source canonical build will use --outfile=dist/die-t3-v2-production to avoid touching live dist/die. First isolated full test run711pass/14skip/10fail was fixture-location noise: login fish/mise injected untrusted-mise.toml warnings into command outputs. Rerun with SHELL=/bin/sh in isolated fixture only is in progress. User trust/config not changed. Full format21 historical experiments-only errors; scoped src/scripts/tests format and full lint/check pass.

## Adoption authorized by concrete gates
Root isolated exact-source/executable regression final721pass/14expectedpaid-live skips/0fail/4601assertions; initial noise rerun explained above. All candidate blocking gates passed; canonical web/t3-source.json and web/t3.patch updated to a9b49a7df0a4261dcc438d4493cc3154a1d9819e and exact a98ba104... patch at10:19Z. Fresh default-source checkout .cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e created from exact upstream git object, no candidate/research dependencies copied. Normal scripts/build.ts (no reuse-web or DIE_T3_SOURCE) is running with only outfile=dist/die-t3-v2-production to avoid unrelated live dist/die inode. Frozen lockfile dependencies installed by normal default build. Final packaged regression pending. Rollback old canonical files preserved .agents/rollback/t3-v2-lifecycle/web--t3-source.json and web--t3.patch, as well as unchanged git HEAD05ff98f...

## Final reproduction commands and logs

Canonical normal build (no candidate source override):

`env -u DIE_T3_SOURCE pnpm_config_verify_deps_before_run=false bun scripts/build.ts --outfile=dist/die-t3-v2-production`

For final native/browser/preservation/package harnesses set:
- T3_V2_ACCEPT_CANDIDATE=1 (explicit harness authorization; source below is canonical)
- T3_V2_CANDIDATE=/home/tnfssc/Code/die/.cache/die-t3code-a9b49a7df0a4261dcc438d4493cc3154a1d9819e
- T3_V2_DIE_BINARY=/home/tnfssc/Code/die/dist/die-t3-v2-production
- T3_V2_PACKAGED_BINARY=same executable path
- T3_V2_PACKAGED_MANIFEST=/home/tnfssc/Code/die/dist/t3-v2-production-build.json
- T3_V2_EXPECT_CHECKOUT_HEAD=a9b49a7df0a4261dcc438d4493cc3154a1d9819e
- T3_V2_EXPECT_BINARY_SHA256=8932d0e7561c0b79d6647c0f617ae548087e7d74bb27c740011ad245b16bb716

Run each `bun scripts/t3-v2-production/{native-acceptance,browser-acceptance,preservation-acceptance,packaged-smoke}.ts` separately. Migration uses same canonical T3_V2_CANDIDATE plus TMPDIR=/var/tmp and T3_V2_MIGRATION_PATCH=/home/tnfssc/Code/die/web/t3.patch. It validates real production migration/importer source on a private old-version fixture, while packaged smoke independently proves startup migration on the same compiled executable.

Logs: /var/tmp/t3-lifecycle-canonical-{build,native,browser,preservation,package,migration,workspace-types,root-tests}.log. Final root check/lint/scope-format: /var/tmp/t3-lifecycle-final-{root-check,root-lint,scope-format}.log. All PASS. Root full suite used exact copied runtime source and the final canonical binary as its temporary dist/die, SHELL=/bin/sh to avoid copied-mise trust-warning pollution; copy removed after success and zero-owned-child scan. No trust settings changed.

Final exact canonical source verification and root runtime source hash recheck PASS; all four runtime proof artifacts identify8932d0e... Final active-owned-jobs inventory empty.

## Lead independent final gate PASS
Task_aaf906f1 exit0. Exact8932d0e canonical binary preservation rerun passed2026-09-21T10:33:58Z: completionWakeObserved=true, unsolicitedActivity=false, failedRuns=0, racingUserAccepted=true, nextUserAccepted=true. Artifact artifacts/t3-v2-preservation-acceptance.json refreshed to lead-run evidence.43focused tests/149assertions also passed independently. No active implementation/verification jobs remain. Canonical source adopted; built executable dist/die-t3-v2-production available, not installed/released. Source and handoff wisdom together; wisdom/t3/t3-v2-delegation-status.md records supported/unsupported native affordances and resource/test limits.

## User workflow clarification (post-adoption)
User asks whether main-branch orchestrator -> five concurrent independent feature threads -> five PRs, all visible sidebar with individual follow-ups and parent status awareness, is current behavior. Lead checked adopted code: Sidebar.logic filterSidebarV2VisibleThreads still excludes subagent lineage; SubagentProjection.makeSubagentChildThread spreads parentThread, inheriting worktreePath/branch with no per-child workspace allocation; DieTaskService launch only task/profile mapping -> upstream delegateTask async, no branch/worktree/PR inputs. Current supports concurrent real children, child navigation and statuses/results, not full five-isolated-PR/sidebar workflow. Followup child chats use ordinary thread model but multi-PR/ongoing parent sync after direct followups not established by current acceptance. Need explicit future work sidebar visibility/grouping, separate worktree+branch each, PR identity/status linkage, tested followup/parent updates. User asked explanation, no edits authorized this turn.
