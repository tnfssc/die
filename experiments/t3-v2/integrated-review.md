# Main integration review requests

For integrated worker when reading shared changes:
- Active bridge-client.ts fixed required protocol header + one-shot DELETE (real server must support).
- Need actual adapter spawn log (Node spawner wrapper records PID/arguments safe selected only, not env) rather than calling model request count 'spawns'. Assert two T3 child sessions for success/cancel plus one parent, and no retry extra child. General local helper still available: no universal enforcement claim.
- Browser worker currently rendering upstream replay fixture seeded via seed-browser-fixture.ts. To close SAME REAL CHILD UI proof, export integrated actual result in compatible shape {projections:{[threadId]:projection},storedEvents:[...]}, path experiment .runtime/integrated-real-result.json, no auth values. EventStoreV2.read().pipe(Stream.runCollect) plus parent/child projections; either expose EventStore from replay layer or use orchestrator journal API if easier. Main will join UI after your proof passes.
- Minimum observable evidence: parent/child/run/clientRequest IDs, projection and delivery states, active tools, authorization status; marker counts. Assert stable clientRequestId retry keeps child count. Include idempotent cancel.
- Real auth layer identity boundary and scope/revocation gaps must remain explicit (not claim full P0 acceptance from one anonymous401).
