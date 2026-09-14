# Independent black-box parity validation

`parity.py` executes each binary rather than importing application code. Every run uses a disposable HOME, TMPDIR, and workspace; inherited credentials, sessions, XDG state, and Herdr sockets are omitted. Raw streams remain beside narrowly normalized derivatives.

## Commands

~~~sh
# Record the original only (never claims parity)
python3 expt-go/validation/parity.py --baseline ./dist/die

# Run both and emit diff.json
python3 expt-go/validation/parity.py --baseline ./dist/die \
  --candidate ./expt-go/bin/godie \
  --output expt-go/validation/artifacts/local-compare
~~~

The printed artifact directory contains binary hashes/provenance, raw stdout/stderr, exit status, state hashes, and PTY ANSI plus readable frames. Artifacts are gitignored because terminal/session evidence can be bulky.

Scenarios cover version/help, removed-option/update/unknown CLI errors, and a real 100x30 PTY startup/edit/quit. The editor drive types `ac`, Left, `b`, then three Backspaces, Ctrl-D, and a double Ctrl-C quit fallback. A deterministic loopback OpenAI-completions fixture asks the app to invoke `execute`; that code starts a background `shell` job and inspects it before and after completion. Only request shape/header names are retained, never auth values or prompt bodies. No live or paid endpoint is contacted.

PTY cleanup addresses only a UUID-named tmux server. Process timeouts signal only the process group created for that child. The fixture seeds isolated `.die` and `.godie` model files and explicitly points `DIE_CODING_AGENT_DIR` at the baseline location; candidates with a different explicit config contract need a harness adapter, not access to real user state.

Normalization is limited to isolated paths, UUIDs, generated task/call IDs, and ISO timestamps. Raw evidence is never normalized or removed. `manifest.json` records whether a candidate actually ran; even a clean differential report is evidence for review, not an automatic parity claim.

## Additional independent suites

See INTEGRATION-RECHECK.md for runtime, execute, session, ownership and distribution results with revision hashes. `provenance-acceptance.py` uses valid Responses and Anthropic fixtures and accepts `--candidate PATH --expected-sha256 SHA --output DIR` to explicitly pin a new candidate; its default pin retains the historical review snapshot. The session suite no longer attempts its former invalid native-provider probe.
