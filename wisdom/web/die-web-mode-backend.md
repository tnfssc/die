Contract: `modelSelection.options` uses the string option ID `instructionMode` with `fast`, `normal`, or `orchestrator`. The frontend already uses it.

Main correction: invoke the real Die `/mode` command through the existing Pi RPC prompt. Run it as a preflight before the user turn. Never make up guidance, a user prompt, or a fake completed `/mode` turn in the adapter.

Do not add `instructionMode` fields to `ProviderSession`, `start`, or `send`. The options already carry this intent. The original worker stopped, and its backend changes were restored to the canonical patch. The replacement worker owns only the backend.
