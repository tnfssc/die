# die web — current installed implementation

## Current status
User confirmed original web/model switching worked, requested current T3 and removal of web auth.
Upgrade implemented, installed, and tested against INSTALLED paths.
No commit/push/release/version bump requested or performed.
- Core executable: ~/.local/bin/die (version label still0.2.10, includes unreleased web launcher).
- Sidecar: ~/.local/bin/die-web, T3 package0.0.40 plus integration patch.
- Official upstream https://github.com/pingdotgg/t3code.git, pin6f00d3881a197dd33c2cb43c6a11a9e759e56089, commit2026-09-14 10:45:43UTC, fetched11:04:23UTC.
- Candidate source: /home/tnfssc/Code/die-research/t3code-upgrade. Old dirty Pi fork checkout remains read-only at /home/tnfssc/Code/die-research/t3code.
- Canonical web/t3-source.json and web/t3.patch updated:34 files/~369KB including ported Pi driver/RPC client because official HEAD has no native Pi support.
  Not a whole fork history merge.

## Agreed scope
Real die behind current T3 web UI; native Agents/task lifecycle status.
Only sparse started/completed notices, not child logs/progress, no new task broker/root service/tree/full controls/updater.
Model-provider credentials remain with die.
T3 injected MCP/browser tools are unsupported and deliberately not injected.

## Wiring
- src/cli.ts early web dispatch; src/web/launcher.ts launches adjacent die-web/t3, --host127.0.0.1, --base-dir ~/.die/web, forwards args.
  Sets DIE_WEB_DIE_BINARY and DIE_WEB_TASK_EVENTS=1.
  Current official pin still uses --base-dir, NOT --home.
- src/tasks/web-events.ts + existing TaskManager listener emit only actual RPC + explicitflag started/completed with bounded id/kind/status/command/agent profile/model/thinking.
  Uses writeSync(1,line); Pi guards process.stdout.write, which silently swallowed initial implementation.
  No output/sessionpaths/modelmessages.
- support/die-web-launcher.mjs seeds canonical providerInstances.pi={driver:"pi",enabled:true,config:{binaryPath:absoluteDie,...existingConfig}}, preserving unrelated settings/instances and refusing malformed objects.
  Node execve starts ./dist/bin.mjs; import alone fails its import.meta.main guard.
  Shell wrapper execs this bootstrap.
- scripts/build-web.ts pins/clones/checks/applies patch, pnpm frozen install, existing web/server build and production deploy, copies client assets/support/license. dist/die-web is portable, no absolute dependency links to checkout.
  Node24 + pnpm required.
  DIE_T3_SOURCE optionally selects existing exact-pin checkout; default cache node_modules/.cache/die-t3code.
- Installer script still installs CLI only; sidecar was explicitly staged/copied into ~/.local/bin/die-web for local installation.
  Do not mistakenly reinstall only CLI when backend changed.

## Port/auth specifics
- Modern per-instance provider Drivers and contracts/web integration include Pi, real inventory/default-model selection and model options.
  Startup emits project.meta.update for new Pi project default because modern project.create ignores it.
- PiProvider considers real models ready in explicit Die mode without fake MCP; ordinary Pi behavior unchanged, empty inventory still warning.
  PiAdapter skips unsupported MCP config/flag/env for Die.
  Sparse tasks retain original turn after parent settlement, dedupe, map agent->subagent, command->shell, killed->stopped.
- auth/DieWebAuth + existing EnvironmentAuth principal path implement no web credentials in explicit Die mode only when runtimeweb, explicitloopbackhost, Tailscale Serve disabled.
  CLI defaults127.0.0.1.
  Nonloopback/desktop retain upstream auth.
- No-auth checks request Host loopback, exact Origin (including port), rejects opaque/null/cross-site/same-site metadata.
  Origin-less local clients allowed: trust boundary is whole local machine, including other users/processes, NOT just this OS account.
  Do not expose it with reverse proxies rewriting Host/Origin.
- Main corrected authenticateRequest to use computed safe dieWebNoAuth, not raw configflag.
- Startup direct URL/no pairing mint/log/QR in no-auth mode; ordinary T3 behavior unchanged. Provider OAuth/API authentication unchanged.
- Current T3 first-run Connect/Agents/Projects setup wizard remains (not a login).
  Tests clicked actual Continue/Continue/Do not import projects; no localStorage bypass.
  Select initial New thread if necessary.

## Verification
- Port:123 server tests +187 contracts/UI tests, relevant server/contracts/web typechecks, targeted lint, web/server builds passed (upgrade orchestrator).
- Final auth/startup47 tests passed after main guard/startup changes.
  Fast worker first ran all333 suites under full /tmp and failed ENOSPC; rerun targeted from apps/server with TMPDIR=/var/tmp succeeded.
- Core ./tests:603 pass,14 skip,0 fail (86 files).
  This is directory-scoped, unlike earlier root-wide610 run.
  Modern bootstrap5 tests passed.
  Core TypeScript/format/diff checks passed.
- Production build task_d7cdff3a passed. Candidate browser tasks task_8b1bfa23/task_d0f1ea7c passed.
- INSTALLED final task_1f5bf228: real Chromium, direct app URL with no pairing/cookie/token bootstrap; local same-origin HTTP authenticated and WS101, hostile/null/wrong-port/rebinding-style HTTP origins denied and hostile WS denied; model A->B->A reached actual loopback model IDs with both responses,2 requests.
- INSTALLED final task_f57b66b2: real browser chat/execute/background fast child, native Agents completed/settled,4 loopback requests.
  No fake MCP extension; no external/paid model calls.
  Allowlisted environment avoids inherited subagent identity/realkeys.
- Evidence: artifacts/die-web-upgrade-installed-model.log, die-web-upgrade-installed-agent.log, die-web-upgrade-installed-summary.json, die-web-upgrade-installed-model.png, die-web-upgrade-installed-agents.png; detailed generic model/agent artifacts also present.
- Browser fixture root fetch now bounded with AbortSignal: first unbounded probes hung and timed out.
  Owned orphan process groups243321/243322 were explicitly verified/stopped; old private temp dirs removed.
  Fixture logs persist privately until cleanup.
  Setup dialog locator scoped by title (toast also uses role=dialog).

## Cleanup/remaining
Installed update backup removed after success.
No test browser/server left running; user server was NOT stopped.
User must restart an existing die web process to load upgrade.
Source backup of pre-upgrade pin/patch/support under artifacts/die-web-before-upgrade; backed-up test filenames end.saved to avoid Bun test discovery.
External upgrade temp/source left for developer provenance; installed runtime does not depend on them.
No implementation blocker remains.
No installation/release action should be assumed beyond what is recorded here.

## New report: Stop
User reports Stop does not work after upgraded installation. task_b888699e owns installed real-browser stop reproduction (held model stream, execute/shell, detached agent) and new stop smoke/evidence; no product edits. task_ffd844a0 read-only traces UI->modern driver->Pi abort/core task semantics.
Await evidence before narrow fix.
Installed version remains current working upgrade; no Stop fix yet.

Stop diagnosis: streaming generation stop actually works.
Main corrected reproducer wording: visible Monitoring/Stop is a whole-thread background-liveness banner, not per-job.
ChatView handleStopBackgroundWork -> interruptTurn; PiAdapter ignores dieTasksById and errors on idle parent; reactor skips fallback when session already ready, so command survives. task_66480bec owns narrow PiAdapter/tests fix: explicit Die idle-background Stop closes owning RPC runtime, emits stopped task/session events preserving resume/history; active abort bounded10s instead120s.
No new core task-control protocol.
Main strengthened scripts/die-web-stop-smoke.ts to require real owned shell death after background Stop and retained previous message in follow-up model request; renamed per-job language.
Typecheck fixed connection record annotations, passes.
Source trace copied from external checkout note into core wisdom/web/die-web-stop-trace.md.
Await worker then rebuild candidate/test, install and retest; installed app currently unchanged.

## Stop fix integration (await installed checks)
PiAdapter now detects running dieTasksById while parent idle in explicit Die mode and closes only that owning RPC session using existing SIGTERM/forced close.
After closure it emits stopped task completions (original turn IDs, deduped) and graceful recoverable session.exited.
Next prompt resumes durable history.
Active-turn Stop still interrupts generation/foreground wait without killing detached jobs; RPC abort bounded10s.
Candidate task_a708e64f PASSED: stream aborted, shell TERM trap fired and PID disappeared after background Stop, background subagent HTTP stream aborted via same banner Stop, follow-up prompts/history worked.
Main corrected Effect Schema instanceof lint to Schema.is and supplied missing EnvironmentAuth test context; server typecheck +84 PiAdapter/startup tests passed.
Dev pi-coding-agent dependency unexpectedly absent; restored root dependencies with bun install --frozen-lockfile (no lock change), core check passed.
Canonical patch recaptured, finalbuild task_26e31984 passed, sidecar installed; await task_667bdd3e installed Stop and task_eadbe5a6 model/origin regression.
Backup recorded artifacts/die-web-stop-backup.txt; clean after success.
No user server stopped; restart required.

STOP FIX VERIFIED/INSTALLED: task_667bdd3e passed against ~/.local/bin/die and installed sidecar.
Streaming Stop closed HTTP response; background Stop sent TERM and removed owned shell PID; the same background Stop aborted a running subagent stream; follow-ups worked and preserved earlier conversation. task_eadbe5a6 passed installed model-switch plus no-auth/origin regression.
Source tests84 passed, server/core typechecks passed.
Backup removed after success, test processes cleaned, user server untouched.
Restart die web to load fix.
Clarify semantics: Stop generation interrupts parent turn, while background banner Stop terminates that thread's detached work.
No commit/release.

RELEASED/INSTALLED v0.2.12 (see release-v0212.md).
ActualGitHubpublishedCLI+sidecar passedStop/model/noauth/origin smokes; all351symlinks internal.
Defaultbuildcache is now .cache/die-t3code (outside node_modules becauseNode prohibitsTSstripping there). v0.2.11 publicationfailedbeforeassets; tagnotmoved.

## Mode selector request (in progress)
User wantswebcomposerAccess replacedwithactualDieMode (fast/normal/orchestrator), preservingmodel+reasoning independent.
Workers: task_5f1a035f backend/core/contracts; task_c9e0d96d frontend; task_... modebrowserfixture (see jobs).
EDIT SOURCE nowroot .cache/die-t3code (exactofficialpin+canonicalpatch), notexternalresearch.
Main mustreviewcontractsfit, recaptureentireweb/t3.patch includinguntrackedapps/packages, typecheck/test/build, realbrowsertheninstall ifappropriate.
No releaseauthorizedforthisrequest yet.
Installedofficialv0.2.12 remainsunchanged.
Backendearlycontractnote wisdom/web/die-web-mode-backend.md.

Modeintegration correction checkpoint: stopped task_5f1a035f becauseitfakedmodeinsideadapter; restoreditsserver/contractschanges via temporaryGitindex builtfromcanonicalweb/t3.patch.
Replacementtask_9f6a021c completed actualRPC /mode preflight andDie-onlycatalogdescriptor.
Main addeddefaultcurrentValueorchestrator andephemeralActiveTurn.instructionMode comparison so unchanged-mode steeringstillallowed.
Frontendoriginaltask_c9e0d96d usedbadlocalStorage/manualappend; replacementtask_0be57b01 completed propercomposerDraftStore.setProviderModelOptions persistence, removedChatViewstate/props andmanualappend.
Sourcecache now .cache/die-t3code.
Serverandwebtypechecks passed (mainserver task_596b66bb).
Main strengthened new scripts/die-web-mode-smoke.ts: actualDie mode ariaLabel, waitfornewresponse, noextraLLM preflightrequest, mediumreasoning fixture, ownedguidanceasserts, nondefaultnormalreload, compactmenu realradiooptions.
Backendfocusedtestworker task_1d4c902e running (testsonly).
Candidatebuild task_e42c2724 runningaftercanonicalpatchrecapture; iftestschange afterwardrecapturepatchagain.
Need reviewfinalfrontend/capabilitygate, runcandidatebrowser thenfixanyissues, validateandinstallsidecaronly afterproof; installedv0.2.12 stillunchanged.
No release/commit requested.

MODE CHANGE COMPLETE/INSTALLED (unreleased): finalinstalledmodebrowser task_c5168448 passed5realHTTPprompts includingdesktopFast/Normal/Orchestrator, mediumreasoning+same model, noextraLLM for /modepreflight, nondefaultnormalreload, compactFast selection, noAccess.
Separate reasoningpill nowexcludesMode (visualreviewcaughtduplicatedsummary); full traitdescriptors remainforupdates sootheroptionspreserved.
CompactusesexistingTraitsMenuContent modeoptiononce.
CapabilitygatedMode UI onlywhenPi catalogadvertisesinstructionMode. task_996930f9 installedmodelA/B/A +noauth/origin passed; task_1e6a11c8 installedStop regression passedbeforepureTraitsdisplaypolish. 113server tests+145webtrait/draftstore tests passed; server/web/coretypechecks andcoreformat passed.
Finalcanonicalpatch capturedafterallsourcechanges; finalbuild task_7c6c8c7b passed.
Sidecarinstalledbesidepublishedv0.2.12 CLI; CLIunchanged.
Backupsremoved, ownedtests cleaned, userserver untouched: restartdie web required.
No commit/tag/release forMode request.

Dropdown click follow-up: user reportsnewthreadOrchestratorbuttondoesnotexpand.
Confirmedtheirserverrestarted(pid383970 at18:26, port13773).
Could NOT reproduce oldtriggerfailureinChromium: isolatedhover/dwell5requestmodefixturepassed, andread-onlyfreshbrowseragainsttheirrunningserver1280x800 showedaria-expandedtrue +3options afteroneclick (no prompts/settings changed).
Subagentlaunchfast failedParseError, mainhandled.
SimplifiedModebranch inChatComposer: removedTooltipTrigger wrapper, directComposerSelectControl, controlledopen/onOpenChange usingexistinguseComposerMenuState, guardedvalidvalues.
Canonicalpatchrecaptured, webtypecheck/buildpassed.
Strengthenedmodefixturechecksone-clickaria-expandedandalloptionsinsideviewportwithoutautoscroll, hover/dwell/focus/populated/reload/compactflows.
Candidate task_ee94a7a4 andinstalledtask_c787867f passed5realrequests.
Sidecarinstalled; usernodeprocessnotstopped; restart+hardrefreshneeded.
Backupremoved.
Exactuserbrowsercause remainsunconfirmed; ifstillfails askbrowser/screenshot ratherthanclaimChromeproofreproducedtheirbug.
Corechecktask_f831e7d1 pending.
No commit/release.
