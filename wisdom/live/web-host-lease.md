# Web voice host lease provenance

Source: request to give each web voice owner revocable authority over the **actual** SessionHost, without changing CLI operations or the web relay/controller foundation. Implementation: `SessionHost.lease()` in `src/session/host.ts`; contract and race tests: `tests/web-live-host-lease.test.ts`. Read `wisdom/values.md`, `src/session/operations.ts`, and `tests/live-host-bridge.test.ts` / `tests/live-host-access.test.ts` before implementation.

The lease is an in-memory capability bound to the host object. The future web route must obtain it from its owning host and call `revoke()` on disconnect, switch, or end; this change does **not** wire that route. A lease has no delegate or close method. Revocation removes its listeners and rejects subsequent reads and writes, including writes awaiting transcript snapshot or stop confirmation. Already-dispatched work is not cancelled. Each lease namespaces request IDs within the host's existing bounded dedupe table; reconnect does not reset capacity. The CLI's direct SessionHost methods remain available and unchanged.

Verification: `bun test tests/web-live-host-lease.test.ts` (4 passing). Existing `tests/live-host-bridge.test.ts` could not run in this worktree because dependencies are not installed (missing `zod/mini`). No web route integration is claimed.
