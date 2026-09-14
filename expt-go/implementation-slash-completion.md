# Slash command completion

## Contract

The interactive editor opens a real completion picker only while the entire single-line command token begins at column zero with `/` and contains no whitespace. Typing `/` shows the catalog; continued typing filters it (prefix matches first, then case-insensitive subsequence matches). Up/Down wrap through results, Tab inserts the selected `/name `, Escape closes the picker, and Enter completes and submits the selected command in one action, matching the source-built original in real PTY checks. Already-exact command drafts keep their spelling so existing `/ps` and `/subagents` overlay draft behavior is preserved.

Completion closes for ordinary text, leading whitespace, multiline drafts, command arguments, or no matches. Thus it does not turn Tab/Enter/arrow keys into command-picker actions for arbitrary prompts. Drafts remain in the existing textarea and active turns, jobs, settings/model/job overlays, streaming, history, and multiline input retain their prior paths.

The catalog is the commands actually handled by `internal/app.Application` and session navigation (`/new`, `/fork`, `/clone`), rather than Pi-only commands that godie cannot execute. `cmd/godie.resourceSlashCommands` adds discovered prompt templates by name and skills as `skill:<name>` from `Application.Resources`; descriptions and template argument hints are displayed. Duplicate or malformed names are ignored by the TUI merge seam.

## Source behavior consulted

- `src/ui/editor.ts`: the compact editor retains Pi editor editing/autocomplete and only changes border/gutter rendering.
- `node_modules/@earendil-works/pi-tui/dist/components/editor.js`: slash Tab requests slash completion; a picker owns Up/Down/Enter while open; applying a slash item inserts a trailing space.
- `node_modules/@earendil-works/pi-tui/dist/autocomplete.js`: slash suggestions trigger only from a line starting with `/` before the first space, are fuzzy-filtered, and completion replaces the command token.
- `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js`: combines built-ins, templates, and `skill:<name>` resources and includes descriptions/argument hints.

## Integration and tests

`tui.Config.SlashCommands` is the narrow catalog seam. `cmd/godie/navigation.go` populates it from the already-discovered application resource set; resource discovery and expansion remain owned by `internal/resources` and `uiBackend.Queue/Submit`.

Behavior tests in `internal/tui/slash_completion_test.go` cover visibility, prefix and fuzzy resource matching, Up/Down, Tab, single-Enter partial selection/submission, and non-command/multiline/argument isolation. Existing overlay tests verify exact Enter compatibility. `cmd/godie/slash_completion_test.go` verifies resource-catalog wiring without provider/auth calls.

## Local verification

Using a private home-filesystem `TMPDIR`, `go test ./...` passed without auth or provider calls. A non-installed evidence build at `~/.cache/godie-slash-evidence` was also exercised through an isolated offline PTY: typing `/` rendered `/help` and `/status`, typing `sta<Tab>` produced `/status `, and Enter executed the local status command. This is developer evidence only; final binary/PTY acceptance remains with the main validator.

## Main integration and terminal fixes

Real original-vs-new key-sequence checks corrected the first implementation’s two-Enter partial completion behavior to the original’s single Enter. Ctrl+C and newline insertion dismiss the menu; Escape dismisses without discarding the draft or cancelling an active turn. Navigation commands are included, and unsafe command-name control sequences are rejected.

Variable-height inline menus initially left stale rows in the terminal despite passing model tests. The terminal renderer clamps its previous cursor during a frame shrink; keeping the hidden cursor at the footer meant the old menu origin was lost. The TUI now uses the textarea’s real cursor, offset to the input row in the combined view, so opening/filtering/closing menus does not strand the cursor below the new frame. No alternate screen or permanent blank spacer was introduced. Menu rows respect available terminal height.

`validation/slash-completion-pty.py --assert-behavior` compares actual source-built original and candidate in isolated tmux PTYs, including Tab, Enter, arrows, Escape, cancellation, ordinary text and skills/templates. See validation/slash-completion-report.md for final captured evidence.
