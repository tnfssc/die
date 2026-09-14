> **Later review correction:** The original native-provider probe in this session suite was not a valid provenance oracle: after transport became available it sent the wrong SSE protocol and had no passing path. It has been retired. See [provenance-report.md](provenance-report.md) for successful real CLI two-provider/opaque-checkpoint verification. Historical session outcomes below remain unchanged; print-slash was subsequently fixed and verified in MAIN-RECHECK.md.

# Session/replay black-box acceptance

## Verdict

**Candidate overall: FAIL** at candidate SHA-256 `124962efc0df6b25403573683260967dce78864916a6803ffceaed58e1b3970d`.

The core persisted-session workflow passes: an execute tool call/result and assistant completion survive a real process restart, `--continue -p` restores them into provider context, and branch-scoped history retrieval does not expose a marker from another session. Incomplete Responses SSE is correctly rejected without persisting a partial assistant success. However, candidate print mode incorrectly interprets a leading-slash user prompt as an app command rather than a literal prompt. Native cross-provider provenance switching is BLOCKED before transport by the candidate's second provider adapter.

| Scenario | Original | Candidate | Candidate classification |
|---|---:|---:|---|
| Persist tool exchange, restart, `--continue` | PASS | PASS | PASS |
| Leading slash is literal in `-p` | PASS | FAIL | **FAIL** |
| Incomplete/aborted SSE is not persisted as success | FAIL | PASS | PASS |
| History search/read remains branch scoped | PASS | PASS | PASS |
| Native provider provenance switch | not compared | BLOCKED | **BLOCKED** |

Final manifest: `artifacts/session-replay-final/manifest.json`.

## Binary provenance and final rerun

The final run hashed the binaries immediately before execution:

- original `godie/bin/die-original`: `9db13b557954004a3b3e6f8cde3ce8a18ade8e99376b730e9be88f635e900c39`
- candidate `godie/bin/godie`: `124962efc0df6b25403573683260967dce78864916a6803ffceaed58e1b3970d`

Command:

`python3 godie/validation/session-replay-parity.py --output artifacts/session-replay-final`

The harness was syntax-checked with `python3 -m py_compile godie/validation/session-replay-parity.py`. The final full run exited 0; scenario status is determined from each result, not harness exit alone.

## Evidence

### PASS — persisted execute exchange and continue after restart

Both programs used two distinct OS processes. Process 1 prompted `SR_FIRST_PROMPT`; request 1 returned an `execute` call whose real output was `SR_TOOL_OUTPUT persisted-through-execute`; request 2 returned `SR_FIRST_FINAL`. Process 2 used the same isolated session directory with:

- original: `... --session-dir <isolated>/sessions --continue -p SR_RESTART_PROMPT`
- candidate: `... --session-dir <isolated>/sessions --continue -p SR_RESTART_PROMPT`

Both process exit sequences were `[0, 0]`, both made exactly three total fixture requests, and request 3 contained all of `SR_FIRST_PROMPT`, `SR_TOOL_OUTPUT`, `SR_FIRST_FINAL`, and `SR_RESTART_PROMPT`. Both printed `SR_RESTART_FINAL` on restart.

Persisted candidate message records, in order, include:

1. user `SR_FIRST_PROMPT`
2. assistant native/function call `execute`
3. tool result `{"output":"SR_TOOL_OUTPUT persisted-through-execute\n","exitCode":0}`
4. assistant `SR_FIRST_FINAL`
5. user `SR_RESTART_PROMPT`
6. assistant `SR_RESTART_FINAL`

The original persisted the analogous user/tool-call/tool-result/assistant sequence. Exact parsed JSONL records are in each `persist-tool-restart/persisted-summary.json`; commands, stdout, stderr, exit, deadline and exact process-group cleanup are in `process-{1,2}.json`.

### FAIL — slash-prefixed prompt in print mode

Original command behavior: exit 0, one provider request containing literal `/sr-literal-command`, stdout `SR_LITERAL_FINAL\n`, empty stderr.

Candidate behavior: **exit 1**, **zero provider requests**, empty stdout, stderr:

`unknown command /sr-literal-command`

Thus `godie -p "/sr-literal-command"` routes user input through slash-command dispatch. In non-interactive print mode this diverges from the original and prevents legitimate slash-leading prompts from reaching the model.

Evidence: `artifacts/session-replay-final/{baseline,candidate}/print-slash-literal/`.

### PASS — candidate rejects incomplete Responses SSE

The fixture sent a valid initial assistant output item containing `SR_ABORT_PARTIAL_SUCCESS`, then closed the stream without `response.completed`. Candidate made one request, exited **1**, printed no partial success, persisted no partial assistant success, and reported:

`provider: Responses stream ended before response.completed`

The original Chat Completions adapter did worse under its genuine supported transport: it retried (two observed requests), did not terminate within the four-second bound (exact process group received TERM; exit 143), and its session contained an assistant record with `SR_ABORT_PARTIAL_SUCCESS`. This original defect does not diminish the candidate PASS.

Evidence: `aborted-sse/result.json`, raw streams, and `persisted-summary.json` under each target.

### PASS — history retrieval is scoped to the resumed branch

For each target the harness created session A with `SR_BRANCH_A_SECRET`, then a distinct session B with `SR_BRANCH_B_SECRET`, then restarted and explicitly resumed session A. A real model-issued execute call ran both:

`history.search({query:"SR_BRANCH_A_SECRET", ...})` and `history.read({ref: ..., ...})`.

Both targets exited `[0, 0, 0]` across the three processes and made exactly four requests. The final request contained `SR_HISTORY_RESULT` and the A marker, but did **not** contain the B marker. This demonstrates retrieval from the resumed branch rather than global session leakage for this workflow.

Evidence: `history-branch-scope/result.json`, `requests.redacted.json`, and persisted summaries.

### BLOCKED — native provider provenance switching

A bounded candidate probe selected native `anthropic`, dummy auth, and a loopback `--base-url`. It exited 1 before any fixture request with:

`provider: Anthropic thinking control is not implemented`

Because a second native provider could not reach a local fixture, safely testing an OpenAI-created persisted session resumed under another native provider was not feasible. This is recorded as **BLOCKED**, not PASS. Evidence: `candidate/native-provider-switch/result.json` and `process.json`.

The separate custom-model loading gap remains separate, as required: original fixture transport uses isolated `~/.die/agent/models.json` with OpenAI Chat Completions, while candidate uses its genuine supported CLI OpenAI Responses `--base-url` route. This harness does not relabel unsupported candidate custom `models.json` as a session failure.

## Isolation and bounds

- Fixture listeners bind only to `127.0.0.1`; no internet calls occurred.
- Every scenario gets a disposable HOME, TMPDIR, workspace, session directory, and dummy key.
- No existing `~/.die`, `~/.godie`, auth, or session state is used.
- Normal CLI deadline is eight seconds; malformed-stream and native probes are shorter.
- Every CLI starts in a new process group. On timeout only that recorded group receives TERM, then KILL only if necessary.
- Request budgets are fixed by queued fixture responses; excess requests receive HTTP 429.
- Request artifacts retain structural order and marker snippets, not authorization values.

## Actionable findings

1. **Fix print-mode slash handling:** when `-p` is active, submit slash-prefixed input literally to the provider (matching original behavior) rather than calling interactive slash-command dispatch. Add black-box coverage that confirms one provider request and preserves the exact leading slash.
2. Keep the candidate's fail-closed Responses SSE behavior; it correctly avoids a false successful assistant record.
3. Unblock at least one second native provider against a configurable loopback endpoint before claiming provider-provenance switching. Then rerun a persisted OpenAI session under that provider and verify the old message provenance remains OpenAI while new records use the selected provider.
