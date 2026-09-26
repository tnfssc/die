# Die v0.13.1

- Live tool calls now appear in the terminal through the standard Pi tool renderer, including running calls and their results.
- Live transcript drafts share the four-entry display budget, preventing a completed draft from unexpectedly removing an extra row and shifting the prompt.
- Shared agent guidance now asks tools to verify actual network, filesystem, and delegation capabilities instead of repeating unsupported access refusals. Explicit delegation requests use the existing subagent helper; no permissions change.
- Added bounded Live capability research tools with explicit private-input authorization and regression coverage for tool visibility, prompt assembly, and transcript layout.

The prompt changes improve guidance, not a guarantee of model behavior. Transcript tests cover logical rows, not all terminal wrapping. No fresh microphone/speaker acceptance was performed for this release.

Update with die update, restart, and check die --version for 0.13.1.
