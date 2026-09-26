# Transcript row shift

The live transcript used four saved entries plus pending drafts. Finishing a draft removed one visible row once the saved list was full. The prompt moved up.

`src/session/transcript.ts` now counts drafts inside the four-entry budget. `tests/live-transcript.test.ts` checks that finishing a Voice draft keeps the same visible rows. The worker reports Live extension tests and the TypeScript check passed too. A real terminal voice check is still useful; this test covers logical rows, not terminal wrapping.

Work was made in the current workspace by task_faf90579, not a separate branch. Other prompt changes in this workspace are unrelated. Values stay the same: this is a local display fix, not a new broad lesson.
