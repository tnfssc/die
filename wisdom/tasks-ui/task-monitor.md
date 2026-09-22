# Interactive task monitor

The TUI-only `/ps` command shows jobs owned by the current session's in-memory
`TaskManager`. It does not discover unrelated OS processes or jobs owned by
another die process.

## Controls

- **Up/Down** or **j/k** selects a running job.
- **Enter** or **i** opens the selected job's inspection view; use the same keys
  or **Escape** to return to the list.
- **s** or **x** asks to stop the selected job. The frozen job ID and command
  must be confirmed with **Enter/y**; **Escape/n** cancels.
- **Escape** closes the monitor from the list.

The list includes the job kind or available sub-agent role. Inspection includes
available PID, working directory, activity status, and recent output. The
preview is capped at 2,400 bytes and 12 lines; inspection requests at most the
job manager's 5,000-byte API limit and only renders lines that fit the terminal,
including terminals shorter than ten rows and the empty-job view. On severely
short frames, the selected job identity and controls take priority over borders,
spacers, and detail rows. A one-row frame shows the actionable identity alone;
a stop confirmation always shows its frozen job ID and command. At zero rows,
all target-changing and confirmation actions are disabled (Escape still works).
Terminal escape/control sequences are removed before display.

Updates are event-driven and coalesced to at most one render request per 100 ms,
plus a one-second age refresh. Closing the component unsubscribes and clears all
timers. Stopping uses the task manager's process-group termination path, so its
existing grace period, escalation, completion notification, and session
shutdown cleanup remain authoritative. Completed jobs leave the running list;
their normal completion delivery is not consumed by the monitor.

Phase 1 is observation and stop only. Sending stdin or other interaction is
deferred. Nested worker identity is shown only when the launching job provides
agent metadata; grandchildren running in another process are not merged into
the parent's session registry.
