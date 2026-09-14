# App-level completion ownership differential

## Result

**Observed FIXED for all five requested black-box scenarios** in both the source-built baseline and the Go candidate. This is end-to-end app/provider evidence: each binary received model-generated `execute` tool calls over a loopback provider and was never invoked with `--execute`.

Final evidence: `artifacts/ownership-run-20260913T2038Z/`.

- Baseline: `godie/bin/die-original`, SHA-256 `9db13b557954004a3b3e6f8cde3ce8a18ade8e99376b730e9be88f635e900c39`
- Candidate: `godie/bin/godie`, SHA-256 `124962efc0df6b25403573683260967dce78864916a6803ffceaed58e1b3970d`
- No real credentials or internet providers were used.
- Every process exited 0 without timeout, but PASS also required the exact request count and scenario markers at the expected request ordinal. Exit 0 alone was not accepted.

| Scenario | Baseline | Candidate | Requests | Observed evidence |
|---|---:|---:|---:|---|
| Foreground shell, no duplicate completion turn | PASS | PASS | 2 / 2 | Request 2 contained the actual `OWN_FG_RESULT` and `OWN_FG_PAYLOAD` tool output; there was no request 3. |
| Background completion resumes once | PASS | PASS | 2 / 2 | Request 2 contained one completion notice and actual `OWN_BG_DONE`; no extra request followed. |
| Runner crash after foreground result restores notice | PASS | PASS | 3 / 3 | Request 2 contained `OWN_CRASH_RESULT`/payload despite runner exit 23; request 3 contained the restored shell completion notice and payload. |
| Parallel handoff | PASS | PASS | 2 / 2 | Handoff did not strand the parallel shell; request 2 carried one completion notice and `OWN_PAR_DONE`. |
| Pending job survives runner completion | PASS | PASS | 3 / 3 | Request 2 showed the background launch and parked via a second model tool call; request 3 carried the completion notice and `OWN_SURVIVE_DONE`. |

Durations were bounded and ranged from about 1.1 to 1.9 seconds per case. Per-case details include exit, timeout, duration, redacted argv, provider paths, request order, exact marker checks, stdout/stderr, and cleanup method in `{baseline,candidate}/<scenario>/result.json`. Redacted request structures and relevant content are in `requests.redacted.json`.

## Provider adapters and separate missing capability

The execution JavaScript is identical for baseline and candidate. Transport/config adapters differ because that is the genuine supported route for each executable:

- Baseline: isolated `~/.die/agent/models.json` custom provider using OpenAI Chat Completions at loopback `/v1/chat/completions`.
- Candidate: supported `--provider openai --api-key <dummy> --base-url <loopback>` route using OpenAI Responses at `/v1/responses`.
- The fake server implements both streaming protocols and returns deterministic tool calls/final text.

**BLOCKED / missing capability, separate from the ownership result:** candidate custom `models.json` provider loading is still unsupported at the recorded hash. An isolated recheck in `artifacts/ownership-custom-route-recheck/` made zero candidate provider requests and exited 1 with:

`provider: Kind must be openai, codex, anthropic, or gemini`

The same custom fixture route made requests and exited 0 on baseline. This gap was not hidden or counted as an ownership failure because the candidate's genuine OpenAI CLI/base-URL route exercised the same app loop and execution code through the Responses protocol.

## Safety and bounds

- Scenario request budgets: 3 or 4. Excess requests receive HTTP 429.
- CLI timeout: 8 seconds per scenario.
- Every CLI starts in a new process group. Timeout cleanup sends TERM, then KILL only if required, to that exact recorded group ID; no broad process matching is used.
- Each target/scenario has isolated HOME, TMPDIR, workspace, model state, server, and dummy key.
- Provider binds only to `127.0.0.1`.

## Reproduction

From repository root:

`python3 godie/validation/ownership-parity.py --baseline godie/bin/die-original --candidate godie/bin/godie --output artifacts/ownership-repro`

Inspect:

`cat artifacts/ownership-repro/manifest.json`

`cat artifacts/ownership-repro/candidate/foreground-no-duplicate/result.json`

The custom-provider capability recheck used:

`python3 godie/validation/parity.py --baseline godie/bin/die-original --candidate godie/bin/godie --output artifacts/ownership-custom-route-recheck`

## Classification

- **FIXED:** all five app-level completion ownership scenarios at candidate SHA `124962ef…`.
- **FAIL:** none among the five requested ownership scenarios.
- **BLOCKED / missing capability:** candidate custom provider definitions from `models.json`; genuine OpenAI Responses loopback adapter used instead and disclosed above.
