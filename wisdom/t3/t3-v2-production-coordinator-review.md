# Integration review queue (05:34Z, implementation still in progress)

Not final-source findings; workers are still editing. Coordinator will reconcile before validation.

1. Backend refinement die_task_cancel requires clientRequestId. Root/shared fixture must agree or backend instead makes cancel inherently idempotent. Do not ship shape mismatch.
2. Async-only launch MUST accept explicit waitSeconds:0 (existing browser harness and advertised async callers use it). Reject positive waits clearly if unavailable; omitted wait uses documented native async behavior. Never pretend terminal foreground answer was returned.
3. timeoutMs cannot be silently accepted/ignored. Implement durable child deadline or reject unsupported timeout. Launch always no terminal output. Native API running status on immediately completed replay should be distinguished launch acceptance vs live observed status, not claim observation.
4. Profile maps need actual trusted backend model/thinking config and role authority attached to credential/session. instructionMode is a user-selectable UI preference, not alone proof of credential-level authorization. Generic delegate_task/task_status cannot bypass the new scope/policy or ACK owner through bearer token. Non-Die pi provider instances cannot accidentally be authorized only by driver=pi.
5. list/observe output must have bounded transport semantics; current all-tasks/all-result text loops can exceed root client limits and make status permanently unreadable. Prefer explicit paging and bounded summary as needed, exact schemas coordinated.
6. Dedupe must bind prompt/profile/timeout and durable parent identity across provider restart. Check actual existing delegateTask replay scope, not just assumption about providerSessionId continuity.
7. Build handoff path will be dist/die-t3-v2-candidate, metadata dist/t3-v2-candidate-build.json using scripts/t3-v2-production/build-candidate.ts after exporting exact candidate patch. This build does not change canonical web source pin.
