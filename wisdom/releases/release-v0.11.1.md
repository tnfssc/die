# v0.11.1 verified Realtime setup fix

Release worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_4b864143`, branch `die/release-verified-realtime-output-rate-fi-4b864143`. Includes diagnostics 5d6db8d, strict offline audit e7fbd8d and evidence-driven output PCM rate fix aac1d2f. Fetched develop de6d50d is already an ancestor; existing controls/transcript remain unchanged.

Read values and schema-audit evidence. Authorized live evidence was exactly two mini setup sessions: omitted output rate rejected with missing_required_parameter / invalid_request_error at session.audio.output.format.rate; explicit 24000 accepted session.updated. No audio/full-model acceptance proven. No further provider/key/device calls or probe execution during release. Probe defaults disabled before auth reads. Values unchanged: SDK optional schema was insufficient; live evidence priority and honest proof boundaries already covered.

Local focused checks: 49 OpenAI tests and 17 release workflow/reuse tests passed; typecheck and format passed. Updater fixture initially could not spawn git under inherited PATH (null status), then clean explicit tool/system PATH passed 15/15; no product change necessary. One hosted develop full release gate will provide exact-SHA assets for tag reuse; no duplicate full pretag matrix.

## Published and verified

- Full develop gates https://github.com/tnfssc/die/actions/runs/36016568517 passed at e9b79cf8ffc66098006ee3d030343c772b6447cd: deterministic 1045 pass / 17 skip / 0 fail; backend 67, web cache 135, terminal recovery 38 passed; format/lint/typechecks, all four cross-builds, standalone smoke and notices passed. Actual Linux and Mac compiled v0.7.1 updater gates verified checksum-failure preservation, replacement SHA256, version 0.11.1; embedded Mac helper device-free self-test passed.
- Annotated v0.11.1 points to the exact tested SHA. Tag workflow https://github.com/tnfssc/die/actions/runs/36017974374 succeeded, reusing exact-SHA assets, skipping duplicate full matrix and repeating packaged Mac updater/helper gate before publication. No force/tag overwrite.
- https://github.com/tnfssc/die/releases/tag/v0.11.1 returned by releases/latest, non-draft/non-prerelease. All 12 expected assets nonempty. Downloaded four checksum manifests match GitHub binary SHA256 digests. Downloaded SOURCE.txt identifies release SHA/tag, embedded T3 b488c57f3f9f1688e31c53daee99e29dd1d0baa2 and Mac helper 5debb891190dd1b296af57e4128a85598e97cb97904e49a2a803d01bd11216fd. No local product installation.
- Independent offline review approved narrow changes and default probe gating: worker worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_4b864143-a86675007a5e-task_e1ee6657`, branch `die/review-narrow-realtime-release-payload-e1ee6657`. No live calls by reviewer.

Retry: `die update`, restart, `die --version` (0.11.1); `/live provider openai`, `/live model gpt-realtime-2.1-mini`, `/live status`, `/live start`. Same shared fix applies to full model, untested live. User retries may incur charges. Keep saved key private/untouched. Values reviewed unchanged for reasons above.
