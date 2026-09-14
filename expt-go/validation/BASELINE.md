# Original die baseline evidence

Recorded on 2026-09-13 with:

~~~sh
python3 godie/validation/parity.py \
  --baseline ./dist/die \
  --output godie/validation/artifacts/baseline-v0.2.8
~~~

This was a baseline-only run. No Go candidate was run and no parity is claimed. Raw streams, ANSI, readable PTY checkpoints, request projections, and state hashes are retained in the ignored local artifact directory above.

## Binary provenance

- reported version: `0.2.8`
- SHA-256: `64cdb45d5e31f2db60d884264fe9b68eb6299c02c377a8cd7d6d2940cc825152`
- size: 91,112,928 bytes
- binary mtime: `2026-09-13T19:21:38.123682+00:00`
- source revision at recording: `14981b44d68988261dbe056227c952671963c838` (`v0.2.8-1-g14981b4-dirty`)
- `dist/die` is not Git-tracked and contains no source-revision provenance. Whether it was built from the current checkout is therefore **unverified**. Its reported version matches the package version, which is weaker evidence.

## Observations and traps

- `--version` exits 0 with exactly `0.2.8\n` on stdout and empty stderr. `--help` exits 0, emits 9,650 stdout bytes, and has empty stderr. Even these read-only launches materialize isolated `~/.die/runtime/0.2.8` state; acceptance must compare state side effects as well as text.
- Removed tool-selection options (`--no-tools`, `--no-builtin-tools`, `--tools=read`, `--exclude-tools=bash`) each exit 1, write nothing to stdout, and write their product-specific fixed-tool-set diagnostic to stderr. `update` exits 1 with the disabled-update diagnostic. An unknown option exits 1 with `Error: Unknown option: ...` on stderr.
- Offline PTY startup without configured models is successful but displays a no-model warning and paths to the materialized provider/model docs. Under the isolated tmux config it also warns that tmux extended-keys is off. The footer shows workspace, `$0.000`, unknown context/cache, and model `unknown`.
- Real editor driving produced `abc` after typing `ac`, Left, then `b`. Clearing with three Backspaces worked. Ctrl-D on the empty editor did **not** quit in repeated probes; the harness uses double Ctrl-C as a bounded normal-quit fallback. The final PTY status is 0 and terminal ANSI is retained.
- The deterministic loopback provider advertised only the `execute` model tool. Request 1 held system/user messages; request 2 added assistant/tool and contained all fixture markers (`LAUNCHED`, `FIRST`, `FINAL`, `JOB_BEGIN`, `JOB_END`), proving the child execute/job interaction reached the provider transcript.
- A completed background job caused another model turn after the first final assistant response: three HTTP requests occurred, with request 3 adding assistant/user roles and the prior `FIXTURE_DONE` marker. Print mode emitted only `FIXTURE_DONE\n` (13 bytes), exited 0, and had empty stderr. A naive fixture expecting exactly two requests will miss this completion-resume behavior.
- The isolated home created settings/runtime/session-directory structure even with `--no-session`; no real auth or existing session state was read or changed.

Security note: transport evidence stores header names and fixture-marker booleans only. Authorization values, request prompt bodies, real credentials, and real session contents are not retained.
