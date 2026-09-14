# OpenCode web launch and T3/Pi integration precedents

Research date: 2026-09-14. Research only; no applications/providers were run and no dependencies were installed.

## Bottom line

For a die web experience, borrow OpenCode's launch shell, not its backend:

1. Build the browser client as static assets and package them with the release.
2. Start a thin die-owned HTTP/WebSocket bridge on 127.0.0.1 only, on an available port.
3. Wait for the listener, print its actual URL, and best-effort open the default browser.
4. Do not show a login screen or require auth in this loopback-only mode.
5. Do not silently turn “no login” into an unauthenticated LAN service. Any future remote/LAN mode must be separate, explicit, authenticated, and stricter about Origin and Host.

T3/Pi precedents support a small process adapter: supervise one RPC subprocess, translate ordered events into a canonical UI protocol, discover real capabilities/models, and clean up by scope. They do not justify importing OpenCode's session/provider/server backend wholesale.

## Revisions inspected

- OpenCode: anomalyco/opencode@228e9095ba3988a02664c3816cb51f98584e86c2 (dev, clean local clone).
- T3 Code: pingdotgg/t3code@01e05c15268dedb76da95f442fbf5201cd8e7a44 (main, clean local clone).
- Issue #402 reference fork, cloned here: IgorWarzocha/t3code@e9db18eef02c19606206c3ee5b94ebf32ac12960, branch t3code/pi-provider, /home/tnfssc/Code/die-research/t3code-pi-igor402.
- Later Pi PR clone already present: PJalv/t3code@191b3de07b6e2d7975530f20f5b5b847b2a73d0b, branch feature/pi-provider.
- ACP bridge, cloned here: TanJeeSchuan/pi-t3code-bridge@6fed3fed0315acf0403b1c6e1bf03ee76255a703.
- Auditable OMP workspace: OnkayC/t3code-omp@ad2f05cb2ec8aacab0f7e81e43b13cc9c836cd92, inspected via public source/API. It was not cloned because it vendors complete T3 and OMP trees and its initial merge reports about 3.2M added lines.

## OpenCode web architecture

### Browser launch

The web command is thin. It resolves shared network options, starts the same server used by serve, prints addresses, invokes the cross-platform open package, ignores browser-launch failure, and holds the process open:

- [web.ts:31-44](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/cli/cmd/web.ts#L31-L44)
- [web.ts:49-80](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/cli/cmd/web.ts#L49-L80) — wildcard binds display loopback and interface addresses, while the browser opens localhost.
- [Official Web docs](https://opencode.ai/docs/web) — loopback, available port, automatic browser opening, explicit 0.0.0.0, mDNS, CORS, optional password.

Borrow: listen first, derive the actual URL, make browser opening best-effort, and offer --no-browser. T3 independently follows this separation in [serverRuntimeStartup.ts:302-333](https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/serverRuntimeStartup.ts#L302-L333).

### Asset build and serving

OpenCode's release build runs the Vite app build into packages/app/dist, enumerates files except sourcemaps, generates a URL-to-file module using Bun file imports, and includes that generated module plus the files in the executable:

- [build.ts:24-50](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/script/build.ts#L24-L50)
- [build.ts:163-191](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/script/build.ts#L163-L191)

Runtime serving lazy-imports the map, serves exact assets, and falls back to index.html for SPA routes: [ui.ts:44-76](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/server/shared/ui.ts#L44-L76). HTML and other responses receive CSP headers: [ui.ts:11-21](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/server/shared/ui.ts#L11-L21), [ui.ts:94-106](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/server/shared/ui.ts#L94-L106).

Do not borrow the fallback that proxies missing UI assets from https://app.opencode.ai: [ui.ts:7-9,78-103](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/server/shared/ui.ts#L7-L9). Die should ship its own assets and fail clearly if packaging is broken; a local UI should not depend on remote executable assets.

### Network defaults, auth, and origin checks

Code defaults are loopback, port 0, mDNS off, and no extra CORS origins: [network.ts:6-32](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/cli/network.ts#L6-L32). Port zero tries 4096 then an ephemeral port if occupied: [server.ts:117-121](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/server/server.ts#L117-L121). mDNS without an explicit hostname changes the bind to 0.0.0.0: [network.ts:62-79](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/cli/network.ts#L62-L79).

Auth is optional HTTP Basic. A non-empty OPENCODE_SERVER_PASSWORD enables it; absent/empty makes auth middleware a pass-through: [auth.ts:17-41](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/server/auth.ts#L17-L41), [authorization.ts:101-116](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts#L101-L116). web and serve only warn if absent: [web.ts:40-42](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/cli/cmd/web.ts#L40-L42). The [official Server docs](https://opencode.ai/docs/server) also describe password protection as optional.

Meaning for die: no login/no auth is reasonable only while the socket is loopback-only. It is unsafe on 0.0.0.0, a LAN address, mDNS, a container-published port, reverse forwarding, or a tunnel. CORS is not authentication.

OpenCode allows CORS for localhost/127.0.0.1 on any port, app-owned origins, HTTPS subdomains of opencode.ai, and exact configured origins: [cors.ts:3-20](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/server/src/cors.ts#L3-L20). Its request-origin helper also accepts matching Origin/Host and requests with no Origin: [cors.ts:22-34](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/server/src/cors.ts#L22-L34). Global CORS is installed at [httpapi/server.ts:121-139](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/server/routes/instance/httpapi/server.ts#L121-L139) and [server.ts:271-295](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/packages/opencode/src/server/routes/instance/httpapi/server.ts#L271-L295); PTY paths separately use the request-origin check.

For die local mode: bind exactly 127.0.0.1; use the exact self origin; validate Host and Origin on WebSocket upgrades and state-changing browser routes; reject mismatches instead of merely omitting CORS response headers; use CSP and nosniff; ship no remote scripts. If no-Origin requests are needed by a CLI, make that an explicit tested transport path. Loopback still is not a multi-user boundary: other processes running as the user can connect.

## T3 integration precedents

### Current T3 main: OpenCode as a supervised provider

T3 current main spawns opencode serve on 127.0.0.1 and an available port, carries an optional password into SDK headers, verifies health/version, and binds subprocess lifetime to an Effect scope: [opencodeRuntime.ts:636-709](https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/provider/opencodeRuntime.ts#L636-L709), [opencodeRuntime.ts:826-887](https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/provider/opencodeRuntime.ts#L826-L887). OpenCodeServerOwner lazily shares it, counts borrowers, watches exit, closes after a 30-second idle TTL, and finalizes the scope: [OpenCodeServerOwner.ts:11-45](https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/provider/OpenCodeServerOwner.ts#L11-L45), [OpenCodeServerOwner.ts:85-175](https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/apps/server/src/provider/OpenCodeServerOwner.ts#L85-L175).

Borrow scoped process ownership and health checks. Do not launch OpenCode as die's implementation; that duplicates session, provider, permission, and tool semantics behind another full harness.

### Pi issue #402 and forks

[pingdotgg/t3code#402](https://github.com/pingdotgg/t3code/issues/402) asks for Pi RPC through T3's existing provider stack: canonical event translation, dynamic models, real thinking levels, configured-binary availability checks, and cleanup after startup/send/model failures. It warns against empty intermediate assistant messages, treating the first assistant event as final, duplicate lifecycle events, fake fallback models, and half-initialized sessions. It is closed and is a design/reference issue, not shipped proof.

The linked [IgorWarzocha PR #1](https://github.com/IgorWarzocha/t3code/pull/1) remains open/unmerged at e9db18e. Useful decomposition is visible in [piRpcManager.ts](https://github.com/IgorWarzocha/t3code/blob/e9db18eef02c19606206c3ee5b94ebf32ac12960/apps/server/src/piRpcManager.ts), [PiAdapter.ts](https://github.com/IgorWarzocha/t3code/blob/e9db18eef02c19606206c3ee5b94ebf32ac12960/apps/server/src/provider/Layers/PiAdapter.ts), [ProviderHealth.ts](https://github.com/IgorWarzocha/t3code/blob/e9db18eef02c19606206c3ee5b94ebf32ac12960/apps/server/src/provider/Layers/ProviderHealth.ts), and [ProviderModelCatalog.ts](https://github.com/IgorWarzocha/t3code/blob/e9db18eef02c19606206c3ee5b94ebf32ac12960/apps/server/src/provider/Layers/ProviderModelCatalog.ts). Treat it as the issue directs: failure-case guidance, not code to merge whole.

A later attempt, [T3 PR #5882](https://github.com/pingdotgg/t3code/pull/5882), is also closed/unmerged. Head is public at PJalv/t3code@191b3de0. Strong pieces are its scoped JSONL transport [PiRpcClient.ts](https://github.com/PJalv/t3code/blob/191b3de07b6e2d7975530f20f5b5b847b2a73d0b/apps/server/src/provider/pi/PiRpcClient.ts), driver/provider split [PiDriver.ts](https://github.com/PJalv/t3code/blob/191b3de07b6e2d7975530f20f5b5b847b2a73d0b/apps/server/src/provider/Drivers/PiDriver.ts), [PiProvider.ts](https://github.com/PJalv/t3code/blob/191b3de07b6e2d7975530f20f5b5b847b2a73d0b/apps/server/src/provider/Layers/PiProvider.ts), and event adapter [PiAdapter.ts](https://github.com/PJalv/t3code/blob/191b3de07b6e2d7975530f20f5b5b847b2a73d0b/apps/server/src/provider/Layers/PiAdapter.ts). Its PR reports broad lifecycle/cleanup/model/session testing, but this is author-reported and upstream did not accept the code.

### OMP precedents

Existing Tavily evidence at artifacts/web-feasibility/t3-omp-search.json captures the Reddit post [“I loved T3 Code's UI, then I found omp — so I forked…”](https://www.reddit.com/r/PiCodingAgent/comments/1voz5cy/i_loved_t3_codes_ui_then_i_found_omp_so_i_forked). Indexed text says it heavily modified T3 for omp --mode rpc, made it OMP-only, and added managed installation. Current Tavily search indexed tangled.org/expi.tngl.sh/t3code-OMP, but extraction failed and that repository now returns 404. Thus the Reddit/Tangled code is not independently auditable now and should not be treated as verified source precedent.

A separate real public implementation is [OnkayC/t3code-omp@ad2f05c](https://github.com/OnkayC/t3code-omp/tree/ad2f05cb2ec8aacab0f7e81e43b13cc9c836cd92). Its T3 subtree documents native rpc-ui, no ACP fallback, capability negotiation, server-owned OMP execution, and normal T3 clients: [providers-omp.md:1-20,45-82](https://github.com/OnkayC/t3code-omp/blob/ad2f05cb2ec8aacab0f7e81e43b13cc9c836cd92/t3code/docs/user/providers-omp.md#L1-L20). The driver separates instance settings, session root, adapter, text generation, availability, and maintenance: [OmpDriver.ts:30-117](https://github.com/OnkayC/t3code-omp/blob/ad2f05cb2ec8aacab0f7e81e43b13cc9c836cd92/t3code/apps/server/src/provider/Drivers/OmpDriver.ts#L30-L117). Runtime uses stdio, timeouts, protocol/capability negotiation, pending-request failure, and scoped close: [OmpRpcRuntime.ts:185-280](https://github.com/OnkayC/t3code-omp/blob/ad2f05cb2ec8aacab0f7e81e43b13cc9c836cd92/t3code/apps/server/src/provider/omp/OmpRpcRuntime.ts#L185-L280), [OmpRpcRuntime.ts:842-928](https://github.com/OnkayC/t3code-omp/blob/ad2f05cb2ec8aacab0f7e81e43b13cc9c836cd92/t3code/apps/server/src/provider/omp/OmpRpcRuntime.ts#L842-L928). An architecture test forbids ACP imports from native OMP modules: [OmpNativeOnlyArchitecture.test.ts:122-130](https://github.com/OnkayC/t3code-omp/blob/ad2f05cb2ec8aacab0f7e81e43b13cc9c836cd92/t3code/apps/server/src/provider/omp/OmpNativeOnlyArchitecture.test.ts#L122-L130). This is real code but a large independent workspace, not upstream-accepted design.

The smaller [TanJeeSchuan/pi-t3code-bridge](https://github.com/TanJeeSchuan/pi-t3code-bridge/tree/6fed3fed0315acf0403b1c6e1bf03ee76255a703) proves a shim is practical: T3 ACP/JSON-RPC over stdio to bridge to pi --mode rpc: [README:1-22](https://github.com/TanJeeSchuan/pi-t3code-bridge/blob/6fed3fed0315acf0403b1c6e1bf03ee76255a703/README.md#L1-L22). But it impersonates T3's Cursor slot and documents wrong labels and stale cached models: [README:76-84](https://github.com/TanJeeSchuan/pi-t3code-bridge/blob/6fed3fed0315acf0403b1c6e1bf03ee76255a703/README.md#L76-L84). Borrow translator/process ideas, not slot impersonation or an unnecessary ACP hop for die.

## What to borrow

- OpenCode's thin web command and best-effort browser opening.
- Embedded static SPA assets, history fallback, MIME correctness, CSP, and no runtime CDN dependency.
- Loopback/default available-port behavior.
- Scoped RPC supervisor: one ordered stdin writer, JSONL stdout, stderr diagnostics, startup/request timeouts, process-exit fan-out, abort, finalizer.
- A canonical event mapper so browser components do not know Pi/OMP wire details.
- Runtime capability/model discovery; expose only real model/thinking/interaction support.
- Offline fixture tests for malformed/unknown frames, tool-only intermediate stages, abort races, process exit, and cleanup.

Do not borrow OpenCode's backend/provider/session model, remote asset proxy, broad product-origin list, or password-warning UX; T3's cloud/pairing/login system; fake models or approval semantics; ACP/provider-slot impersonation; or the scale of either OMP fork.

Recommended boundary: browser static client ↔ thin die local gateway ↔ existing die session/RPC objects. Die remains owner of tools, sessions, subagents, compaction, costs, and policy.

## License

- OpenCode [LICENSE](https://github.com/anomalyco/opencode/blob/228e9095ba3988a02664c3816cb51f98584e86c2/LICENSE): MIT, copyright 2025 opencode.
- T3 Code [LICENSE](https://github.com/pingdotgg/t3code/blob/01e05c15268dedb76da95f442fbf5201cd8e7a44/LICENSE): MIT, copyright 2026 T3 Tools Inc.; Igor/PJalv forks retain it.
- ACP bridge [LICENSE](https://github.com/TanJeeSchuan/pi-t3code-bridge/blob/6fed3fed0315acf0403b1c6e1bf03ee76255a703/LICENSE): MIT, copyright 2026 Tan Jee Schuan.
- Onkay workspace has no GitHub-detected root license, but t3code/LICENSE and oh-my-pi/LICENSE in the workspace are MIT with their respective notices. Preserve notices if substantial code is copied. Prefer reimplementing the small patterns and protocol behavior.

## Web research provenance and limitations

Used tvly search and tvly extract for official OpenCode docs, GitHub issue #402, the Reddit OMP report, and public repositories. Existing evidence is under artifacts/web-feasibility/. This pass also confirmed commits through local Git and public repository source/metadata. Tavily extracted official docs and issue #402, but Reddit extraction was blocked and the indexed Tangled fork is now unavailable; those claims are explicitly limited above rather than presented as code evidence.
