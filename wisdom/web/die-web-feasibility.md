# die web feasibility research — temporary bridge

User requests research only: command die web launches T3 Code web server/UI powered by die, analogous opencode web, no browser auth/login.
Explicitly use tvly CLI and clone relevant repos.
Important follow-up: needed ONLY until official Pi integration supported by T3 Code.
Prioritize thin disposable adapter/pinned upstream, not permanent frontend/backend fork.
Need verify future officialPi provider configurable executable can run die (not stockpi losing die extensions).
No implementation/install/release authorized for web yet.

Cloned shallow repos outside product: /home/tnfssc/Code/die-research/t3code (pingdotgg/t3code), /home/tnfssc/Code/die-research/opencode (anomalyco/opencode).
Main tvly search/extract evidence artifacts/web-feasibility/*.json.
Upstream Pi RPC issue https://github.com/pingdotgg/t3code/issues/402; source code/status must verify, issue itself not shipped capability.
OpenCode officialweb docs localhost/randomport/browser launch and optionalpassword.

Workers: task_cb1038d4 die backend/API/RPC feasibility -> die-web-backend-research.md; task_3b056f17 T3 architecture/licensing/adapter -> die-web-t3-research.md; task_4c5697ed OpenCode web/precursor fork research -> die-web-opencode-research.md.
Workers launched before temporary-bridge followup; main must integrate revised goal in synthesis.
No live model calls or running untrusted repo scripts.

Previous v0.2.10 release installed/pushed/published andverified fully; pending publication note has evidence.

Main upstream evidence: T3 cloned01e05c15 (2026-09-14), OpenCode228e909 (2026-09-14).
Pi issue402 CLOSED2026-08-15, not proof shipped.
PR5882 feature/pi-provider PJalv/t3code CLOSED/unmerged.
Issue comments identify MajesteitBart/t3code fork with PiRPC runtime, configurable model discovery, extension-ui bridging, images explicitly rejected.
Main cloning that fork main to /home/tnfssc/Code/die-research/t3code-pi-bart jobtask_eaff9879; separate from worker potential fork clones. tvly/gh artifacts include pi-issue-status/timeline/pi-pr5882/pi-fork/acp-search.
Investigate thin launcher to existing fork with Pi binarypath=die instead of writing new provider.

Source verification: MajesteitBart defaultmain clonebe1a8367 (2026-08-07) does NOT contain PiProvider; issue comment alone was insufficient.
Main cloned actual PR5882 branch feature/pi-provider from PJalv/t3code to t3code-pi-pr5882, commit191b3de0 (2026-08-10 fix(pi): project async Agent subagents).
Actual code apps/server/src/provider/pi/PiRpcClient.ts:370 launches configurablecommand --mode rpc; Layers/PiProvider.ts:109 settings.binaryPath discovery --no-session --offline get_available_models/get_state/get_commands; Layers/PiAdapter.ts:1782 configurablebinary with --session plus MCP optional flag/fallback.
This branch is plausible reuse candidate, not claimed tested end-to-end.
Main ran installed die0.2.10 RPC get_state handshake in isolated /var/tmp HOME with no credentials, HERDR0, --offline --no-session --no-approve.
Success response, empty stderr, exit0; no provider request.
Evidence artifacts/web-feasibility/die-rpc-handshake.json.
This proves subprocess protocol availability only, not T3 end-to-end functionality.

Die backend worker completed task_cb1038d4; recommendation sidecar RPC.
Critical reason: embedding SDK into T3 host changes process.execPath and existing JobService/runner uses that path to spawn die workers, so it would require real runtime refactor.
Pi-server experimental substrate not drop-in server.
Initial web scope should use existing provider credentials, processperactivesession, basicstream/tools/customnotifications/resume; avoid promising native browser job management, descendantcost dashboards, generalized approvals/TUI-only dialogs.
Detailed source paths in die-web-backend-research.md.

Additional main findings: issue402 state_reason completed despite current source lacking Pi driver (do not infer shipped from issue state; PR5882 unmerged and current registry authoritative).
Current T3 providerInstance.ts intentionally uses OPEN branded ProviderDriverKind and opaque driver config, unknown drivers unavailable rather than parse crash; supports future-removal/migration strategy better than old literal union fork.
Await T3worker exact current driver seam.

T3worker complete task_3b056f17.
Currentdriver registry static imports (internalSPI, not runtimeplugin); browser metadata registration static too, so pinned custombuild required.
SourceMIT.
Currentstandalone CLI archive includes executable+webassets+native externals, so reusepackaging rather than inventbundle.
Cloudless build omits Clerk/relay config (no login); mandatory localhost pairing remains seamless via browser bootstrapURL andscope-protectedWS.
Do notpromise literal unauthenticatedWS flag; noneexists.
Current startup defaultsCodex project/thread, mustoverrideforDie.
Fullnote die-web-t3-research.md.
Issue402 convertedtodiscussion, not mergedPi support.

## Final synthesis / next recommendation
All three workers complete.
For temporary-only goal, evaluate EXISTING no-T3-fork ACP shim first, rather than immediately committing to proper customPi-driver fork.
TanJeeSchuan/pi-t3code-bridge (localpi-t3code-bridge-acp@6fed3fed) explicitly plugs into current Cursor ACP slot and supports PI_ACP_PI_BINARY override (set to die), model switching, images, resume, cancel, permissiongate.
Caveats: Cursor labels, modelcache/refresh, Piextension/permissiongate compatibility; ambientextensions off bydefault must evaluate for die and avoid fake security claims.
Actual browser+die integration NOT run, so this is a candidate/spike recommendation, not drop-in proven.
If shim incompatible, reuse actualPR5882 nativePiRPC adapter in pinnedT3 custombuild; no UIrewrite.
Earlier categorical custombuild requirement applies to a proper newdriver, not existing-slot shim.

OpenCodeworker proposes thinlocalgateway/noauth but T3specialist shows existingfrontend tightly coupled EffectRPC backend; MAIN recommendation KEEP T3server/protocol, donot invent replacementbackend.
Cloudless localT3 avoidsClerk; keep invisibleloopback pairing to avoid authsurgery.
Defaultlocalhost, existing dieprovider credentials, separatewebstate, owns child lifecycle.
Exitplan officialPi driver with configurablebinarydie, removeACPbridge/patch.
Mainhandshake proved onlydieget_state no modelcall; endtoendT3conversation still needs timeboxedfixture spike includingtools/customnotifications/cancel/reload/models/images/approvals.
User authorizedresearchONLY.
