# die web T3 upgrade: loopback no-auth mode

## Ownership (declared before edits)

Auth subtask owns these files in the **new** checkout `/home/tnfssc/Code/die-research/t3code-upgrade`:

- `apps/server/src/auth/DieWebAuth.ts` (new narrow activation/origin/principal policy)
- `apps/server/src/auth/DieWebAuth.test.ts` (new policy tests)
- `apps/server/src/auth/EnvironmentAuth.test.ts` (credential-free principal integration / ordinary-auth regression)
- `apps/server/src/auth/EnvironmentAuth.ts` (route the existing HTTP/WS principal path through die-web policy)
- `apps/server/src/config.ts` (one runtime config bit)
- `apps/server/src/cli/config.ts` (read DIE_WEB_DIE_BINARY, force safe loopback default / keep auth on nonloopback)
- `apps/server/src/cli/config.test.ts` (config safety/ordinary behavior tests)

No PiProvider/PiAdapter, serverRuntimeStartup.ts, src/web launcher, build scripts, bootstrap, or smoke scripts will be edited.

## Security contract / early limits

No-auth activates only when DIE_WEB_DIE_BINARY is non-empty, runtime mode is web, and the resolved bind host is an explicit loopback host.
In that mode browser-originated protected HTTP and WS requests must be same-origin and loopback; cross-site/null origins and cross-site Sec-Fetch-Site are rejected.
Requests without browser origin metadata stay accepted for local non-browser clients; so local processes can drive the API (intended trust boundary).
No listener should be exposed publicly.
Provider OAuth/API credentials are untouched.
Nonloopback binds keep ordinary T3 authentication instead of becoming unauthenticated.

## Implemented

- CLI env config treats non-empty `DIE_WEB_DIE_BINARY` as the explicit request.
  In web mode its default bind becomes `127.0.0.1`.
  The no-auth bit resolves true only for `127.0.0.1`, `::1`, or `localhost`, and only when Tailscale Serve is off.
  Explicit `0.0.0.0`/LAN hosts and desktop mode keep upstream authentication.
- Existing `EnvironmentAuth.authenticateHttpRequest` / `authenticateWebSocketUpgrade` principal path now supplies a full administrative local principal only in that safe mode.
  This also makes `auth/session` report authenticated without issuing a browser cookie; WS tickets are unnecessary in this mode.
  Provider auth RPCs and provider credentials stay untouched.
- Browser request gate needs request Host URL to be loopback, exact Origin equality when Origin exists, and rejects cross-site/same-site/opaque browser metadata.
  Origin-less requests are allowed for local curl/CLI compatibility.
  WS uses the same gate.

## Validation

- `pnpm exec vp test run src/auth/DieWebAuth.test.ts src/auth/EnvironmentAuth.test.ts`: 2 files, 26 tests passed.
  Covers credential-free HTTP+WS principal, external-origin rejection for both, DNS-rebinding-style Host rejection, wrong port/opaque origin, nonloopback/desktop/Tailscale activation refusal, and ordinary missing-credential behavior.
- `pnpm --filter t3 typecheck`: passed (Effect advisory suggestions only).
- Selected-file formatter check passed after formatting.

## Contract for main launcher / browser fixtures

1.
  Main's `src/web` launcher must leave a non-empty `DIE_WEB_DIE_BINARY` in the spawned T3 server environment.
  No new token/pairing secret is needed.
  Do not set `T3CODE_HOST` to `0.0.0.0`/LAN and don't enable `T3CODE_TAILSCALE_SERVE`; defaulting the host is preferred and resolves to `127.0.0.1`.
2.
  Open the plain loopback base URL (for example `http://127.0.0.1:<port>/`) with no `#token`, pairing call, Authorization header, or cookie bootstrap.
  Browser fixtures should delete pairing/login setup and assert `/api/auth/session` is authenticated, then use normal UI/RPC connection.
3.
  Security smoke should send protected HTTP and WS requests with `Origin: https://evil.example` (and ideally `Sec-Fetch-Site: cross-site`) and expect rejection; verify an explicit nonloopback host doesn't become no-auth.

## Concrete security limits

The trust boundary is the local machine (including other local user accounts): origin-less local clients/processes can operate terminal/tools.
Browser defenses cover cross-site fetch/form/subresource metadata and WebSocket Origin, and reject nonloopback Host URLs (including basic DNS rebinding).
A trusted local reverse proxy that deliberately rewrites both Host and Origin to loopback can defeat this policy and must not expose the listener.
No protection from other local processes/users, and no intended remote/cloud access in no-auth mode.
