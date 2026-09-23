# Followthrough live findings

Changing combined test from it.effect to it.live immediately settles real open/ensure and teardown (~1.38s). PiRpc terminatePiProcess has Effect.sleep(TERMINATION_GRACE) under test fake clock. The existing no-MCP-discovery assertion is also wrong: live ensure initializes and lists tools. More causality and prompt proof underway. Integrated worker should use it.live (real OS processes), not it.effect. No upstream change needed so far.

Real prompt now passes in 1.58s test (2.89s runner) with it.live: actual PiAdapterV2 → dist/die → execute → bridge-client → mock MCP echo → next deterministic HTTP model request → provider_turn.completed → scope finalizes. combined-PiAdapterV2.integration.test.ts has working startTurn/appThread fixture for integrated worker reuse. tools asserted exactly execute, one tools/call, result in next model request; this remains explicitly mock MCP and is NOT delegation acceptance.
