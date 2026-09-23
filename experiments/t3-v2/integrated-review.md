# Main integration review requests

For the integrated worker reviewing shared changes:
- Active bridge-client.ts fixed the required protocol header and one-shot DELETE. Check both against the real server.
- Get an actual adapter spawn log. The Node spawner wrapper must record only safe selected PID/argument data, not the environment. Do not call a model request count 'spawns'. Check for two T3 child sessions for success/cancel, one parent, and no extra retry child. The general local helper is still available, so make no universal enforcement claim.
- The browser worker now renders the upstream replay fixture seeded by seed-browser-fixture.ts. To prove the SAME REAL CHILD in the UI, export the real integrated result as {projections:{[threadId]:projection},storedEvents:[...]} to experiment .runtime/integrated-real-result.json. Include no auth values. Use EventStoreV2.read().pipe(Stream.runCollect) plus parent/child projections. Either expose EventStore from the replay layer or use the orchestrator journal API. Main will join the UI after this proof passes.
- Record at least parent/child/run/clientRequest IDs, projection and delivery states, active tools, authorization status, and marker counts. Check that a stable clientRequestId retry does not raise the child count. Include idempotent cancel.
- Clearly state the real auth-layer identity boundary and the scope/revocation gaps. One anonymous401 does not prove full P0 acceptance.
