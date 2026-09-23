> Superseded by [t3-v2-production-lifecycle-final.md](./t3-v2-production-lifecycle-final.md): lifecycle blocker fixed, all concrete gates passed, canonical a9b49a7d adopted. Content below preserves earlier non-adopted investigation history.

# Final integration record (2026-09-21)

Implementation is production code, not a disabled stub: root scoped execute routes native Die-specific MCP; T3 owns durable child processes, graph, results and completion delivery. Ordinary CLI/shell TaskManager remains separate.

## Exact source/artifact
- Upstream: a9b49a7df0a4261dcc438d4493cc3154a1d9819e
- Patch SHA256: 106570f1f7a9402dbc9956429b44521f9f60fbd381ea8693fd944556c8945a14
- Root+embedded candidate executable: dist/die-t3-v2-candidate
- Executable SHA256: 9fde1b1d90a54555c65d161414bb4c4c588ac688b82adbae0d9f3a4ab0660196
- Clean apply and exact worktree verification PASS; full workspace types and web/server bundles PASS.

## Root validation
711 pass / 14 expected skips / 0 fail / 4580 assertions. Root check PASS. Scoped src/scripts/tests formatting PASS; historical experiments excluded. Root/candidate diff checks PASS.

## Broad candidate caveats
18,027 pass / 3 fail / 17 skip on broad final run before OS-reap test correction. The resource test now passes42tests with bounded real-time exact PID observation. Two Git tests pass in proper-package isolated98test run. Full server-package suite timed out600s without results; not called a pass. Earlier web WASM76 and GitHub node:test34 pass under their correct runners. Two unrelated desktop WSL process-fixture portability failures remain classified. No universal upstream full-suite pass claim.

## Review repairs
Credential scrub from model-directed environments; stable pre-I/O execute/call identities; bounded ambiguity replay; transient ledger serializers; stable mixed pagination; truthful stop status. Server policy/cancel mutation fence and no generic-capability fallback on denied Die lineage. Bounded queues/retries/byte retention; exact hard-stop/reap and5sidle children versus30minroots. Native own/subtree usage projection; CLI/Herdr isolation. No-auth loopback Origin/Host preservation. Shell cards persist terminal/reload. RPC agent_end now synchronously flushes local completion batching, but final live testing proves this alone does not resolve post-turn stream failure.

## Acceptance artifacts (same final executable; final outcome)
- scripts/t3-v2-production/artifacts/native/proof.json
- artifacts/t3-v2-production-browser/proof.json
- artifacts/t3-v2-preservation-acceptance.json
- artifacts/t3-v2-packaged-smoke.json
- migration-acceptance.ts rerun PASS: old719a76 data/history/provider/checkpoint and idempotent restart preserved.

Did not release, install, bump a version, or push. No user live servers/credentials/session state modified. Acceptance uses private temporary state, loopback and exact owned process cleanup. Resource probes are bounded observed PID/FD/queue evidence, not a generic zero-leak claim.

## Final decision: NOT ADOPTED
Canonical web/t3-source.json stays719a76ca and web/t3.patch is unchanged. Real native acceptance PASS; same-server browserPASS; relocated package securityPASS on9fde1b1d...; preservation FAIL. Completed shellcard now remains visible (Ran printf), but after completed local shell, a second user turn fails ProviderAdapterEventStreamError: Provider event stream ended unexpectedly. The RPCagent_end synchronous batch flush patch passes its unit test but did NOT resolve live failure. Do not label it a validated final fix. Current proof artifacts/t3-v2-preservation-acceptance.json and /var/tmp/t3-final-preservation-acceptance.log record9fde... failure before harness teardown.

This is a reproduced internal lifecycle blocker, not an external dependency excuse. The prior DB trace showed unowned Pi activity approximately250ms after first-run settlement. Likely boundary to investigate next: RPC agent_end forwarding order vs extension hook/steer, and making local-job wake owned by the T3 turn/continuation boundary. Do not suppress unexpected EOF or allow arbitrary unowned provider activity. No release-readiness/adoption claim despite implemented and repeatedly proven native contract.
