# Live transcript viewport

Keep the live widget limited to its four content rows, including active drafts. A separate “earlier conversation saved” banner consumes a row and can make useful speech disappear; persistence should remain available in session history without being announced in the viewport. Keep genuine status labels and long-line clipping markers. This is a display rule only: do not change transcript retention, saved entries, or model-facing context.

Reasoned from bounded rendering in `src/session/transcript.ts` and regression coverage in `tests/live-transcript.test.ts`.

Parent integrated as c08e171. Bun is available in parent checkout;
parent typecheck and all 9 transcript tests pass. Worker untrusted mise
config did not require changing trust or installing tools.
