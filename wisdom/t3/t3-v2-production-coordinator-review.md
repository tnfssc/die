# Integration review queue (05:34Z, implementation still in progress)

These are not final-source findings. Workers are still editing. Coordinator will reconcile them before validation.

1. Backend refinement die_task_cancel requires clientRequestId. Make the root/shared fixture match, or make backend cancellation inherently idempotent. Do not ship mismatched shapes.
2. Async-only launch MUST accept explicit waitSeconds:0. The existing browser harness and advertised async callers use it. If positive waits are unavailable, reject them clearly. An omitted wait uses documented native async behavior. Never claim it returned a terminal foreground answer.
3. Do not silently accept and ignore timeoutMs. Add a durable child deadline or reject the unsupported timeout. Launch never has terminal output. For an immediately completed replay, distinguish launch acceptance from live observed status. Do not claim observation.
4. Profile maps need actual trusted backend model/thinking config and role authority attached to credential/session. instructionMode is a user-selectable UI preference, not alone proof of credential-level authorization. Generic delegate_task/task_status cannot bypass the new scope/policy or ACK owner through bearer token. Non-Die pi provider instances cannot accidentally be authorized only by driver=pi.
5. Bound list/observe transport output. Current all-tasks/all-result text loops can exceed root client limits and leave status unreadable. Use explicit paging and a bounded summary where needed. Coordinate the exact schemas.
6. Dedupe must bind prompt/profile/timeout and durable parent identity across provider restart. Check the real delegateTask replay scope. Do not rely on assumed providerSessionId continuity.
7. Build handoff path will be dist/die-t3-v2-candidate, metadata dist/t3-v2-candidate-build.json using scripts/t3-v2-production/build-candidate.ts after exporting exact candidate patch. This build does not change canonical web source pin.
