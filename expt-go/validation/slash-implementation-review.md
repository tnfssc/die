# In-progress slash completion review

Observed source-built original in real PTY: `/mo`, Down(select mode), Enter both completes and executes `/mode` immediately, then editor empty and current-mode notice visible. It does not require second Enter for a partial command. Raw frame validation/artifacts/slash-before/enter/baseline/mode-enter.txt.

In-progress worker code at06:31: Enter on partial selection only fills draft (unlike baseline). BuiltinSlashCommands lacks navigation `/new`, `/fork`, `/clone` although cmd navigation implements them. Ctrl+C early return clears textarea but does not close completion state, risking a stale menu. Main will review final worker delivery and fix/retest any remaining differences.
