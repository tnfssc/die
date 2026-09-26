# GPT-Live transcript UI flood

After v0.14.0 user reports many live transcript records visible in UI.
Prior release did not include an actual visual GPT-Live session check.
Parent acknowledged gap; routing tests were not visual acceptance.

Investigation/fix job task_3d13e60c:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_3d13e60c
branch die/fix-gpt-live-transcript-ui-flooding-3d13e60c
base 1f4e096628ce5222d8ae793bbcb6ccf783f4a0a1.

Clue: extension.ts records each GPT input/output fragment as JSON with
source gpt_live_provisional and customType live-transcript. Trace owner
observe/history display and real terminal/web render paths. Preserve
canonical context and tool output, but avoid displaying internal provisional
records as repeated chat entries. Must verify real rendered UI with fixtures
and visual evidence; no provider/device acceptance claim without evidence.
No new publish or install requested yet.

Existing whole-path proof and honest evidence values apply. Recheck values
after findings; feature wisdom must record the missed rendering contract.

Completed and integrated 2af554c/867954c/1a7a3fa. Actual source CLI PTY
repro: 25 custom transcript bubbles before, zero after; bounded readable
You/Voice view remains. Parent typecheck and rendering test pass. Canonical
passive history kept, old saved visible records not migrated. Web adapter
already omits custom records; added coverage only. No release/install.
See gpt-live-tui-rendering.md for durable evidence. Values unchanged.
