# Independent native-provider provenance acceptance

**Result: PASS**

Validated the pinned integration executable directly, without live auth or internet:

- Binary: `validation/artifacts/godie-main-integration`
- SHA-256: `c63c7eb90cc820397ca6b3ae59860fcbed42f13774182865a64c94038ad9f036`
- Harness: `validation/provenance-acceptance.py`
- Raw/redacted artifacts: `validation/artifacts/provenance-acceptance/`
- Network: bounded loopback HTTP only
- Reasoning: explicit `--thinking medium` on every request

## Standard visible history (portable)

The real CLI first called the loopback OpenAI Responses endpoint. Its valid SSE response contained visible marker `PROV_OA_VISIBLE_1` and provider-private reasoning marker `PROV_OA_PRIVATE_REASONING_1`. Both were persisted in the actual CLI session.

The same session was reopened with Anthropic Messages. Request 2 evidence shows:

- `oa_visible: true`
- `oa_private: false`
- Anthropic thinking body: `{"type":"enabled","budget_tokens":8192}`
- process exit: 0

The valid Anthropic Messages SSE response then persisted visible marker `PROV_AN_VISIBLE_2` and private signed-thinking marker `PROV_AN_PRIVATE_THINKING_2`.

The reverse handoff reopened the same session with OpenAI. Request 3 contains both portable visible markers and omits the Anthropic private marker. The older OpenAI private marker is present because this request returns to its matching provider/model; that is expected same-provenance native replay, not cross-provider leakage.

All three standard CLI invocations exited 0.

## Opaque checkpoint (model-bound, not portable)

A separate real CLI session persisted a schema-valid Responses `compaction` native item with marker `PROV_OPAQUE_CHECKPOINT_PRIVATE`. Reopening with the incompatible Anthropic provider/model failed with exit 1 and exact stderr:

`provider: opaque checkpoint provider/model mismatch`

No fifth HTTP request reached the fixture: total request count remained 4. Thus the checkpoint was refused before transport rather than silently dropped.

Native Codex `/compact` was not used because offline invocation requires OAuth JWT/account credentials. The fallback fixture still exercises actual CLI persistence, actual session schema, and actual incompatible replay validation; it does not claim to test the Codex compaction endpoint.

## Bounds, redaction, and cleanup

- Expected/observed request maximum: 4/4.
- Per-process deadline: 12 seconds, then 2-second termination grace.
- Every CLI runs in its own process group. Timeout cleanup targets only that exact owned group.
- Loopback server is shut down, closed, and joined; temporary state is removed.
- Request artifacts contain marker-presence/shape summaries only (`raw_body_recorded: false`). CLI API-key arguments are redacted.

See `result.json`, `requests-redacted.json`, and the five process JSON files for evidence.
