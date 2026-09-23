Frontend contract: the frontend already puts `fast`, `normal`, or `orchestrator` in `modelSelection.options`. The string option ID is `instructionMode`.

The adapter must send the real Die `/mode` command through the existing Pi RPC prompt before the user turn. It must not invent guidance, invent a user prompt, or record a fake completed `/mode` turn.

The options already express the mode. Do not add `instructionMode` to `ProviderSession`, `start`, or `send`. The original worker has stopped. Its backend changes were restored to the canonical patch. The replacement worker owns the backend and nothing else.
