# v0.11.1 verified Realtime setup fix

Release worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_4b864143`, branch `die/release-verified-realtime-output-rate-fi-4b864143`. Includes diagnostics 5d6db8d, strict offline audit e7fbd8d and evidence-driven output PCM rate fix aac1d2f. Fetched develop de6d50d is already an ancestor; existing controls/transcript remain unchanged.

Read values and schema-audit evidence. Authorized live evidence was exactly two mini setup sessions: omitted output rate rejected with missing_required_parameter / invalid_request_error at session.audio.output.format.rate; explicit 24000 accepted session.updated. No audio/full-model acceptance proven. No further provider/key/device calls or probe execution during release. Probe defaults disabled before auth reads. Values unchanged: SDK optional schema was insufficient; live evidence priority and honest proof boundaries already covered.

Local focused checks: 49 OpenAI tests and 17 release workflow/reuse tests passed; typecheck and format passed. Updater fixture initially could not spawn git under inherited PATH (null status), then clean explicit tool/system PATH passed 15/15; no product change necessary. One hosted develop full release gate will provide exact-SHA assets for tag reuse; no duplicate full pretag matrix.
