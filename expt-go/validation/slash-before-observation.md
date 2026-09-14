# Slash completion baseline observation

Main reproduced missing completion in actual controlling terminal on candidate f58fe481... (experimental label rebuild). Source-built original shows filtered suggestion `→ compact` after `/comp`; Tab changes draft to `/compact` and dismisses list. `/mo` offers fuzzy matches (model, mode, scoped-models, memory, import); Down selects mode. Go before fix shows only `/comp`, and Tab leaves it unchanged.

Evidence: validation/artifacts/slash-before/screens/{baseline,candidate}/compact-{prefix,tab}.txt and mode-down.txt. Original suggestion rows omit leading slash in labels, so first draft evidence parser undercounted suggestions; fixed to inspect labels rather than `/label`. Test clearing now uses repeated Backspace rather than unsupported Home/C-k chord on Go, preventing test-state contamination. Raw first-run snapshots retained. Worker should inspect actual baseline UX, not initial boolean summary.
