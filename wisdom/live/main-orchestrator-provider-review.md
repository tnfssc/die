# Direct provider pre-release review

Review of worktree commits 21e0abd and 4fc995c on 2026-09-25.
Findings need source verification/fixes before release.

**High — OpenAI Realtime cannot dispatch real function calls.** `src/live/openai-session.ts:529–575` reads `message.name` from `response.function_call_arguments.done` and rejects the call when it is absent. The Realtime protocol puts the function name on the function-call output item; the arguments-done event carries `call_id` and `arguments`, not `name`. The tests supply a synthetic `name` (`tests/openai-session.test.ts:179–184`), masking this. Track the function-call item’s name by `call_id` from `response.output_item.added`/`.done`, verify its response association, then use it when arguments finish. A real protocol-shaped fixture is needed.

**Medium — declared 1 MiB tool arguments exceed the receive limit.** Direct-main validation permits arguments up to 1,048,576 characters (`openai-session.ts:564`), but the socket handler rejects *any* event over 500,000 characters before parsing (`:323–327`). A legitimate large arguments-done event therefore closes the session rather than returning a tool result. Align the event bound with the supported argument size plus envelope overhead, or lower the advertised/accepted tool-input limit consistently.

I made no edits or provider calls. Offline/typecheck success and the current synthetic events do **not** establish connected schema acceptance or end-to-end provider behavior.

## Parent verification and disposition

The high finding is NOT confirmed and should not drive a compatibility layer.
Parent fetched the current official OpenAI Node types at
https://raw.githubusercontent.com/openai/openai-node/master/src/resources/realtime/realtime.ts
on 2026-09-25. ResponseFunctionCallArgumentsDoneEvent explicitly requires
name: string ("The name of the function that was called"). The reviewer used
an outdated protocol shape. No connected frame is available either way, but
the present official contract matches the existing name-based dispatch.

The medium finding is confirmed in current source: a 500,000-character global
receive bound sits below the 1,048,576-character direct-main argument bound.
Sent to implementation for aligned bounds and a regression test.
