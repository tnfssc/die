# Slash completion fix — real-terminal acceptance

User report reproduced on pre-fix binary f58fe4819985a0a2480d323ec23efb78d90ffb8aae0ba2c851c3991e19fbb2fb: `/comp` produced no menu and Tab left it unchanged. Source-built original completed it to `/compact`.

## Fixed binary

`expt-go/bin/godie`, SHA-256 `15fc7aee095544002dd3a3fc6d798766709745b4378d04cbda688d620928d0a4`. Rebuilt locally, not installed. Restart the application to use it.

## Acceptance

`validation/slash-completion-pty.py --assert-behavior` drove both actual binaries through separate tmux PTYs with isolated HOME/state and generated global resources. All13checks PASS on both: slash opens menu, prefix filters, Tab completes, no stale menu rows, arrows select, Enter completes+submits, Escape preserves draft, skills/templates/new complete, Ctrl+C clears menu, ordinary text untouched and clean exit. No provider calls. Screens and manifest: validation/artifacts/slash-acceptance-final/.

A separate real-PTY streaming regression passed for both: initial prompt auto-submission, draft preserved while streaming, follow-up submission and terminal restoration, using2local fixture requests each. Evidence: validation/artifacts/slash-streaming-regression/.

Focused `go test -race ./internal/tui ./cmd/godie` and `go vet ./internal/tui ./cmd/godie` passed. Tests cover catalog merging, unsafe names, fuzzy matching, partial/exact Enter behavior, existing overlays, cursor anchoring, newline/cancellation and Escape during an active turn.

## Review corrections

The initial implementation filled partial commands on first Enter but needed a second Enter to execute; real original behavior proved it should complete+execute immediately. Session navigation commands were added to the catalog. Real PTY captures also exposed stale menu/prompt rows on shrinking inline views; anchoring the real textarea cursor to the input fixes that without alternate-screen mode or reserved blank rows. This would not have been caught by model-only tests.

The first probe matched `/compact` in menu labels, but original labels omit the slash; it now checks real labels. Draft reset uses Backspace rather than assuming Home/C-k mappings. Raw earlier captures retained. Exact descriptions/order, parameter/path completion and unrelated app parity are outside these13gates.
