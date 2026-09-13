# Thinking display spacing — 2026-09-13

## Current status
Shipped in v0.2.8. User confirmed the installed layout: compact thinking/tool/non-user boundaries; one plain, unhighlighted row above/below user messages, shared between consecutive users. Preserve internal Markdown/code spacing. Earlier no-padding and not-installed entries below are historical. See [release record](releases-herdr-2026-09-13.md).

## Implementation history

User asked to remove blank rows between consecutive displayed thinking/status lines. Implemented in src/ui/conversation-density.ts; tests in tests/conversation-density.test.ts. No prompt/provider/session-data changes.

Two causes mattered: Pi0.85 joins adjacent thinking parts with two newlines and gives separate assistant components leading spacers; Responses parser also accumulates multiple summary parts in ONE thinking string with two-newline separators. First worker task_7a555706 fixed only multiple parts/messages. Parent identified the missing same-block streaming path in node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js; follow-up task_3497ad1a covered it.

Display-only copies compact ordinary thinking prose paragraph gaps, including single-block incremental and final updates. Generated versus intentional prose gaps cannot be distinguished, so both are compacted inside thinking. Normal assistant/user/tool Markdown unchanged. Conservative detection preserves gaps around lists/block structures and inside fenced code. Parent adjusted the multi-part path to join with original two newlines FIRST, then compact prose, preserving structural boundaries across parts too. Source messages/signatures retained; hide/show, mouse coordinates, streaming, resize and adapter restoration tested.

Final parent verification:15 real Pi component tests passed, bun run check passed, bun run build passed, git diff --check passed (task_9d64acd9). Built dist/die now includes this change; NOT installed. No paid/live-model calls. Only UI source/tests changed for this request; unrelated dirty work preserved.

## Follow-up: user message padding
User now also requests no blank rows above/below user messages. Root confirmed preserving whitespace inside user content. Worker task_8c52737a owns UI density/test update. Actual Pi0.85 UserMessageComponent rebuilds a Box(outputPad, 1, userMessageBg); there is no separate user Spacer. Thus user-owned top/bottom Box padding plus successor-owned native leading spacers must be handled, including first/consecutive user messages. Preserve thinking fix, normal output internals, horizontal styling and mouse routing; no live tests/install. Pending implementation/review.

User-message padding follow-up COMPLETE (task_8c52737a). Parent reviewed structural Box padding removal and adjacent/successor spacer handling in src/ui/conversation-density.ts. User native Box keeps children/background/horizontal padding/OSC markers, paddingY becomes0; Pi standalone one-line spacers adjacent to users are suppressed; native successor-owned leading row after a user is removed. Source content/internal Markdown and meaningful trailing prior output rows are not stripped. Dynamic outputPad rebuilds reapply density; teardown restores native state. Existing thinking fix retained.

Worker20 density +19 relevant UI/schema tests, typecheck, build, focused Biome and diff checks passed. Parent independently reran20 density tests + diff check (task_2ca05dd1), all passed. Dist rebuilt, NOT installed. No live model calls or remaining jobs.
