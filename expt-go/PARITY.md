# Behavioral parity matrix — experimental Go candidate

Target: research/parity-validation.md. **Experimental only: not production-ready or parity-complete. No whole-app parity claim.** PASS applies only to the stated exercised gate; PARTIAL means remaining subcases or known differences. Evidence records its own executable hash. Independent validation reports retain historical findings and explicit later oracle corrections.

## Final combined source (22:32 UTC)

Runnable binary: `bin/godie`, SHA-256 `58cb0acbf54ba2e774a6b0ee0aea5f9473f002f8d965153e50eaa638644ac963` (48,701,732 bytes). A separate source rebuild is byte-identical. Full race/vet and no-live executable suites pass their behavioral gates on this revision. Valid provenance, native custom-provider CLI routes and actual source-built Die Markdown resource comparisons also pass. See [final independent summary](validation/FINAL-COMBINED.md). Earlier entries below retain their narrower scope/historical live revisions.

## Current important outcomes

- Custom models.json Chat Completions now reaches the same fixture and completes the job workflow; plain print final text now matches exactly. Full raw transport comparison still differs (Go/Pi headers and request defaults), not silently relabeled PASS.
- Original fullscreen mismatch removed: candidate uses inline compact  prompt + project/mode/cost/context/cache/provider footer. Exact styling/startup warnings still differ. Real initial-message/streaming/draft PTY comparison passes both.
- Anthropic default medium and explicit off now transport. Actual persistent OpenAI → Anthropic → OpenAI CLI probe preserves archive/native provenance and excludes foreign opaque state from outbound Anthropic requests. Main independently confirms private/signed-thinking projection and opaque-checkpoint refusal in validation/provenance-report.md.
- Main retired the invalid session-replay native placeholder as NOT_RUN; it previously sent Responses SSE to Anthropic and could never PASS. See final-native and main provenance-report.md. The valid provenance harness also exercised the final binary with every behavioral check true; its overall FAIL is solely the hardcoded older snapshot SHA pin, retained in final-provenance/result.json.
- Six execute differential scenarios MATCH, 11 independent runtime scenarios FIXED, five completion ownership scenarios PASS both; Go restart/history/literal slash/EOF fail-closed pass.
- No new live calls in this integration pass. evidence/LIVE-BUDGET.md reconstructs at least23 attempts against the max24/$0.10 ceiling; remaining budget is not safely established.

| ID | State | Evidence / precise remaining scope |
|---|---|---|
| A01 | PARTIAL | Both executable CLI probes; development help/version deliberately differ. Relocated binary needs no host PATH. |
| A02 | PASS | final-compare: all four disabled-tool cases + update refusal match; unknown-option diagnostic also matches. |
| A03 | PARTIAL | Print/JSON/RPC, continue, explicit/prefix/exact IDs, fork/export and navigation implemented. final-session, final-product, final-streaming-pty; full option/event catalog still differs. |
| A04 | PASS | final-extraction: 16 concurrent first launches, second start, actual interrupted extraction, corrupt cache restoration and read-only valid cache. Kernel flock replaces crash-stale lock files. Independent distribution11 gates, no-follow/mode cache checks and corrupted copied-ELF payload fail-closed also pass. |
| A05 | PASS | final-relocation-isolated: copied binary alone, unrelated Unicode/space CWD, PATH=/nonexistent, bundled Bun and 50 completed jobs. |
| A06 | PARTIAL | Malformed settings/config/profiles/auth refusal package tests; unknown flag exact CLI match. Not every filesystem permission failure is differential-tested. |
| A07 | PARTIAL | Actual PTY double Ctrl-C/restoration, runtime cancellation/shutdown and process-group probes; full startup/signal matrix not exhausted. |
| B01 | PARTIAL | Six final execute comparisons MATCH, including TS/top-level-await/thrown TypeError/timeout. Primitive/syntax/unhandled rejection matrix not entirely differential. |
| B02 | PASS | Final execute language/modules + Unicode/space paths MATCH: ESM/CJS, installed exports/subpaths/#imports, dynamic imports; synthetic __filename corrected. |
| B03 | PARTIAL | Fresh runner per execute, concurrency/cancellation package tests; no full separate global-mutation differential. |
| B04 | PARTIAL | final-runtime bounded-output + artifact-failure FIXED; final execute spill MATCH. Every invalid UTF-8/ordering boundary not compared bytewise. |
| B05 | PARTIAL | Final execute image helper MATCH (four PNG representations, fifth limit, invalid header); resizing/bounds package tests. Complete JPEG/WebP/25MB boundary differential remains. |
| B06 | PASS | final-runtime descendant/group/cancel probes + final-ownership crash restores notice and pending-job survival; execute timeout diagnostic now MATCH. |
| B07 | PARTIAL | Real helper turns, parallel handoff and ownership ACK checks pass; all malformed frame/schema/error-string combinations not equivalent-proven. |
| B08 | PARTIAL | Native Bun serialization + spill/error tests; complete serialization presentation matrix not differential-tested. |
| C01 | PARTIAL | Actual foreground/background/failure/timeout and 50 parallel completions; exact 3s-edge schedule not exhaustive. |
| C02 | PARTIAL | Retention/offset/cursor package coverage and runtime bounded-output checks; every >1MB stream pattern not differential. |
| C03 | PARTIAL | Independent stdin-stop deadlock regression passes; stdin close/input package tests; full original two-write matrix pending. |
| C04 | PASS | final-ownership: foreground no duplicate, background once, crash restore, parallel handoff and pending-job survival PASS on both CLIs. |
| C05 | PASS | final-runtime process groups/timeouts/descendants + ownership pending-job survival pass. |
| C06 | PARTIAL | Actual bounded shutdown/cancel cases pass; every crash/watchdog edge for agents not differential-tested. |
| C07 | PARTIAL | Go job API and fake-clock attention tests; full executable 5/10-minute differential not run. |
| D01 | PARTIAL | Durable child identity/depth policies and actual prior live child PASS; all profile/depth/batch transitions not differential. |
| D02 | PARTIAL | Identity/prompt tests and child resume confirmation implemented; malformed markers fail closed. Legacy writable child resume unavailable. |
| D03 | PARTIAL | Provider-attempt provenance/fixtures; real OpenAI-Anthropic-OpenAI CLI restart final-native PASS. All retry/accounting overlaps not differential. |
| D04 | PARTIAL | Exact fast lane guards/tier payload and consent/persistence fixture tests pass; no premium live request authorized or made. |
| D05 | PARTIAL | Native/portable compaction fixtures + one candidate live opaque checkpoint. Original print slash was literal, so native live comparison NOT passed. |
| D06 | PARTIAL | TTL/attempt/branch policy package tests and persistent CLI cache command PASS; descendant/time boundary differential incomplete. |
| D07 | PARTIAL | Completion data marked untrusted; runtime bounds/TUI sanitizer tests. Full injected preview differential not run. |
| E01 | PARTIAL | Native Go restart/tool exchange/branch history and native provenance PASS; Pi archives read-only, no writable migration. |
| E02 | PARTIAL | Persisted child restrictions and confirmation implemented/tested; original archive child-resume differential incomplete. |
| E03 | PARTIAL | Descendant combined-usage package tests; malformed linked-tree full executable differential pending. |
| E04 | PARTIAL | final-session branch-scoped helper search/read PASS; CLI search/read integrated. Complete cursor/stale/hidden/native matrix not differential. |
| E05 | PARTIAL | 14-process final-product includes persistent goal set/pause/resume/clear; waiting/handoff package coverage, complete attention workflow not differential. |
| E06 | PARTIAL | Shake projection/refusal package tests and command integrated; full native checkpoint differential pending. |
| E07 | PARTIAL | Memory nonce receipt/content/root-path/atomicity tests and command integrated; final-product status PASS, live consolidation not run. |
| E08 | PARTIAL | Bounded metadata-only diagnostics implemented/tested; only provider/child projections, not original complete diagnostic ring/budgets. |
| E09 | PARTIAL | Exclusive recoverable session locks and durable branch package tests; actual navigation swaps lock ownership. Complete notes/session cross-process matrix pending. |
| F01 | PARTIAL | Actual inline compact prompt/footer comparison, slash/product and navigation tests; not pixel-identical original warnings/style or all selectors. |
| F02 | PARTIAL | Actual 20x4 resize/restore earlier + inline width/Unicode tests; complete wide/combining/emoji comparative grid pending. |
| F03 | PARTIAL | Foldable execute previews and Ctrl+O tests; every running/failure/cancel visual state not compared. |
| F04 | PARTIAL | Job overlay inspect/confirmed-stop tests and app callbacks; noisy-job full PTY differential pending. |
| F05 | PARTIAL | final-streaming-pty PASS both: initial positional prompt autosubmits, draft survives streaming and submits as next request, double Ctrl-C restores terminal. Full cancellation/follow-up/attention matrix remains. |
| F06 | PARTIAL | Profile/model picker tests and callbacks/custom catalog integrated; full malformed-settings real PTY differential pending. |
| F07 | PARTIAL | Terminal sanitization package tests; mouse/control-byte full executable differential pending. |
| F08 | PARTIAL | Herdr root interactive lifecycle wired; isolated Unix socket package tests. Complete real PTY bridge comparison pending. |
| F09 | PARTIAL | Actual terminal restoration/normal quit/resize pass; every HUP/pane-kill/crash terminal state not exercised. |
| G01 | PARTIAL | Earlier dedicated candidate greeting falsely passed streaming-only, then invalidated. Subsequent corrected live tool/background/child persisted assistants; no fresh dedicated greeting due ledger limit. |
| G02 | PARTIAL | Prior live-tool-fixed actually executes one TS tool and persists final marker, original also executes tool. Modules separately MATCH through loopback. |
| G03 | PASS | Prior live-background: both persisted GODIE_BACKGROUND_OK with one background shell/handoff workflow. Historical binary hashes in manifests. |
| G04 | PASS | Prior live-child: both persisted CHILD_OK after one worker delegation. Historical binary hashes in manifests. |
| G05 | BLOCKED | No authorized premium live request. Native compaction live candidate-only; baseline -p slash literal did not compact. |
| G06 | NOT RUN | Live interactive streaming/cancel/resume not run; local real-PTY streaming PASS does not replace live evidence. |

## Explicit unresolved product/release boundaries

1. Legacy Pi sessions are read-only; no writable migration. Native Godie sessions do support restart, branch/fork/clone, explicit IDs and navigation.
2. Arbitrary external extensions/package install/config, theme/package-manifest resources and the complete original CLI/RPC/event catalog are not implemented. Go-native Markdown skills and prompt templates now support CLI/default discovery and invocation; see implementation-resources.md. --offline is stronger than original (provider requests disabled).
3. Custom models.json now integrates Chat Completions, Responses, Anthropic and Gemini APIs plus supported provider/model overrides; command/environment-value expansion, authHeader/OAuth config and other Pi compatibility knobs remain unsupported (implementation-config.md). CLI image attachments are capped at 3,000,000 aggregate bytes; full source image-resize/input envelope is not matched.
4. Exact TUI style/startup warnings/session selection interaction, broad terminal fault/mouse cases, and full diagnostic ring semantics remain partial as itemized above.
5. Additional live paths/premium/native source compaction are unverified or unauthorized; fixture evidence is not live parity.
6. Development binary is runnable and bundled, but redistribution remains blocked on official asset provenance and complete version-matched runtime licensing/source/relinking obligations.
