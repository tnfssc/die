# Spoken delegation TUI evidence

The standalone `tests/live-spoken-tui.test.ts` launches the source CLI in a real 100x40 tmux pane, loads the extension fixture, acquires the production main owner, and calls `owner.delegate("fixture-spoken", "Check this repo status")`. The fixture replaces only the agent model stream with a local completed assistant message. It never sends the user words to the UI directly. The pane capture from the successful run is [spoken-tui-capture.txt](spoken-tui-capture.txt): the clean user line and offline model reply appear, without a delegation snapshot or transport wrapper.

Standalone source CLI requires generated runtime assets (the test runs `scripts/prepare-assets.ts`). More importantly, Pi checks provider credentials *before* its injected stream function runs: without a dummy `OPENAI_API_KEY`, delegation rejected with “No API key found for openai” and there was no user turn. The fixture now surfaces delegation rejection, and the test provides a fake key only inside its tmux process. No network call is needed.

Run: `bun test tests/live-spoken-tui.test.ts` (Bun 1.4.2; 1 pass). The live terminal assertion checks exact clean user line, assistant reply, and absence of delegation boilerplate. This does not validate audio acquisition or a connected model provider.
