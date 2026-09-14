# Application policy/state integration

## Scope and source parity

This integration was derived from the existing TypeScript policy implementations in
`src/tasks/native-fast-mode.ts`, `src/tasks/cache-countdown.ts`, and
`src/tasks/provider-attempts.ts`, plus `docs/native-fast-mode.md`,
`docs/cache-countdown.md`, `docs/system-instructions.md`, and
`docs/diagnostics.md`. It keeps policy and durable projection in the app package;
it does not claim transport capabilities that the Go providers do not yet have.

## App API

The coordinator may call these package-local methods:

- `func (a *Application) fastCommand(args string) (string, error)`
- `func (a *Application) cacheCommand(args string) (string, error)`
- `func (a *Application) restorePolicyState() error`
- `func (a *Application) observeProviderAttempt(providerName, model string, observed time.Time) error`

`restorePolicyState` is intended at application startup after the engine exists and
after every successful branch resume. It reads `Session.Branch()` only, restores
the latest model and thinking records, reconstructs the root instruction mode, and
then resolves fast state against the restored session/provider/model identity. It
rebuilds the provider with the same `provider.Config` inputs when online. Child
identity remains authoritative from immutable session header metadata; root-mode
records never replace child role/depth or child system guidance.

The observation helper is called only after the coordinator has conservatively
observed a provider HTTP response, or immediately before an unavoidable direct
native dispatch. It does not itself dispatch, inspect usage, or infer cache behavior.

## Durable records

All records are ordinary append-only session custom entries and are resolved only
on the active branch.

### Native fast policy

Custom type: `die-native-fast-mode`

~~~json
{
  "version": 1,
  "sessionId": "session identity",
  "provider": "exact provider kind",
  "model": "exact model alias",
  "enabled": true,
  "costAcknowledged": true,
  "timestamp": 1770000000000
}
~~~

Identity strings are non-empty and at most 256 bytes. `costAcknowledged` must
exactly equal `enabled`. The newest record for an exact identity is authoritative;
a malformed newest record fails closed rather than exposing an older opt-in.
On/off is model-bound and branch-bound. Standard is the default. Enabling in print,
RPC/JSON, or child modes requires the literal `--accept-cost` argument. The exact
OpenAI and Codex model allowlists match the researched native-fast policy; prefixes
and custom endpoints are not accepted.

### Cache observation

Custom type: `die-cache-call`

~~~json
{
  "timestamp": 1770000000000,
  "provider": "exact dispatched provider",
  "model": "exact dispatched model"
}
~~~

The timestamp is Unix milliseconds. The record means only that the narrow
observation boundary was reached. It is not evidence of cache creation, retention,
or a hit. Estimates match exact provider/model identity. `die-manual-shake` clears
older observations during projection. Display is deliberately coarse in whole
minutes, with unknown and expired states rather than a second-level timer.

### Cache settings

Path: `<Application.Options.StateDir>/cache-settings.json`, normally
`~/.godie/cache-settings.json`.

~~~json
{
  "cacheTtlMs": 3600000
}
~~~

Only this key is accepted. The integer is bounded from one minute through seven
days; the file is bounded to 4096 bytes and must be regular. Writes use a private
0600 temporary file and atomic rename. Invalid files are left untouched. The
default is one hour. No general settings file is read or rewritten.

## Required coordinator boundary

The app methods are intentionally not wired in `commands.go` or
`application.go` here because those files are coordinator-owned. The coordinator
needs to:

1. route `/fast` and `/cache-ttl` to these methods;
2. call `restorePolicyState` after initial engine construction and after
   `Session.Resume`;
3. invoke `observeProviderAttempt` only at the documented conservative response
   or inevitable-dispatch boundary; and
4. expose restored fast/cache state in status/TUI without claiming a cache hit or
   confirmed provider tier.

Most importantly, `Engine.Request.Fast` is policy intent only. Every current Go
provider deliberately rejects `Fast == true` before network dispatch. The
coordinator/provider owner must add a guarded request-local wire implementation
before fast can make a premium request: exact provider/model/official endpoint and
auth checks, immutable authorization capture, final serialized payload validation,
and explicit standard-tier compaction. Until then, the rejection is the safety
boundary; it must not be removed or converted into an unguarded `service_tier`
field. No automatic retry, upgrade, fallback, or model swap is permitted.

## Validation

`policies_test.go` uses only isolated temporary state/session directories. It
covers standard default, non-TTY cost consent, exact allowlists/endpoints,
branch-local on/off restoration, malformed authorization fail-closed behavior,
dedicated bounded cache settings, conservative observation display, corrupt-file
preservation, and active-branch model/thinking/root-mode projection.
