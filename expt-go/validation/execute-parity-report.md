# Execute language/module/image parity report

## Verdict

**Tentative revision: partial parity.** These findings apply to the pinned candidate snapshot SHA `124962efc0df6b25403573683260967dce78864916a6803ffceaed58e1b3970d` and original SHA `9db13b557954004a3b3e6f8cde3ce8a18ade8e99376b730e9be88f635e900c39`. The implementation is active; rerun the harness after concurrent runtime changes.

The candidate matches the original for the exercised TypeScript/module graph, thrown-error message, and bounded stdout/stderr spill case. Three observable differences remain: synthetic `__filename`, timeout diagnostics, and unsupported-image error wording.

## Method

- Reusable harness: [execute-parity.py](./execute-parity.py)
- Evidence: `artifacts/execute-parity-final/`
- Both actual CLIs were driven through loopback provider tool calls with identical `execute` code. No `--execute` shortcut, live provider, internet access, package installation, or real credential was used.
- Original used a local `openai-completions` model fixture; candidate used its local Responses adapter.
- Every process had a fresh HOME, TMPDIR, and Unicode/space-containing workspace. Each process was a new process group; cleanup targeted only that group.
- Budget: exactly two provider requests per CLI/scenario, 12 processes total, 12-second outer timeout per process.
- The candidate executable was copied before execution to `artifacts/execute-parity-final/candidate-snapshot`; the manifest confirms it matched the active binary at copy time.
- Comparisons decode tool results and compare semantic markers/JSON/image hashes, not provider envelope bytes.

## Results

| Scenario | Result | Evidence / meaning |
|---|---:|---|
| TypeScript + modules | MATCH | Top-level await and export; static local TS; dynamic local JS; local CJS `require`; installed CJS and ESM; conditional package exports; subpath exports; package `#imports`; dynamic package import all produced identical JSON. |
| Unicode/space paths | **DIFF** | CWD, dirname, local import URL, and package resolution match. Original reports `__filename=.../__die_execute__.ts`; candidate reports `.../[stdin]`. |
| stdout/stderr + spill | MATCH | Both retained the long-output tail/end marker and Unicode stderr marker through their spill/preview path. Envelope wording and artifact layout were not compared bytewise. |
| thrown TypeError | MATCH | Both expose `PARITY_BOOM_Ω_7` and failure. Stack formatting differs (synthetic module vs Bun stdin), treated as runtime presentation rather than message mismatch. |
| 250 ms timeout | **DIFF** | Both stop before `PARITY_TIMEOUT_BAD`. Original says `Execution timed out (SIGTERM).`; candidate returns `error: context deadline exceeded` and no timeout-labelled diagnostic. |
| image helper | **DIFF (wording only)** | Path, Blob, Uint8Array, and ArrayBuffer each returned the same 68-byte PNG, four times, SHA-256 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`. Both enforce the fifth-image limit. Invalid bytes are rejected, but original says `showImage supports PNG, JPEG, and WebP bytes; unsupported or missing image header`; candidate says `Unsupported image type; expected PNG, JPEG, or WebP`. |

Machine-readable details and preserved excerpts are in each `original/<scenario>/result.json`, `candidate/<scenario>/result.json`, and `requests.semantic.json`. The top-level manifest records binary hashes and comparison statuses.

## Actionable findings

1. **Restore synthetic entry filename parity.** Execute code in the candidate currently sees `[stdin]`; expose the original synthetic `<cwd>/__die_execute__.ts` for `__filename` while retaining `__dirname=<cwd>`. This can affect code that locates fixtures relative to the entry.
2. **Map deadline cancellation to the execute timeout diagnostic.** When `timeoutSeconds` expires, report an explicit timeout outcome instead of leaking generic Go `context deadline exceeded`. Cancellation itself worked.
3. **Align `showImage` invalid-header text** if exact API errors are compatibility surface. Behavior and emitted bytes already match.

## Coverage gaps

Kept out of this bounded run: >25 MB image input rejection, >5 MB resize behavior and metadata, 10 MB aggregate image cap, 5 MB/10 MB output caps, JPEG/WebP payloads, malformed/truncated files, and package-manager installation. The fixture packages are intentionally tiny and offline. These are gaps, not passes. Re-run after active-binary changes; the report should be revised if the new snapshot hash differs.

## Reproduce

```sh
python3 godie/validation/execute-parity.py \
  --original godie/bin/die-original \
  --candidate godie/bin/godie \
  --output artifacts/execute-parity-final
```
