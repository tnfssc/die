> **Superseded alternative study:** This report was commissioned during the temporary Go-only constraint. The user subsequently chose bundled Bun for `execute`. Its recommendations are not the current architecture; see ../CONSTRAINTS.md and ../PLAN.md. Retained for the Go-only tradeoff analysis.

# Go-native model tools and execution

**Decision:** make explicit, schema-described tools dispatched by Go the default and only v1 orchestration contract. Do **not** embed Yaegi and do **not** make `go run` part of normal agent execution. This satisfies [the full-Go constraint](../CONSTRAINTS.md), preserves coding workflows, and avoids recreating the old JavaScript `execute` API.

A user or model may still invoke an installed Go toolchain through the ordinary `shell` tool, just as it may invoke project compilers and tests. That is an external workload, not a godie runtime dependency.

## What must be preserved

Preserve outcomes, not JavaScript syntax:

- bounded file discovery, reading, writing, and patching;
- foreground commands which can become background jobs without being killed;
- interactive stdin, timeout, stop, list, inspection, output paging, and completion notices;
- child agents with profiles, persistent child sessions, descendant ownership, and cost/lifecycle metadata;
- branch-aware history search/read;
- image ingestion with explicit count/byte/type limits;
- concise inline results with large output persisted as artifacts;
- cancellation and shutdown which cannot orphan untracked processes.

There is no requirement to preserve top-level `await`, imports, `Bun.file`, npm resolution, or a single `execute` tool.

## Recommended contract

### Provider-neutral call loop

Use one internal representation independent of any SDK:

`ToolCall{providerCallID, operation, argumentsJSON}` → validate → authorize → dispatch → `ToolResult{providerCallID, ok, content, attachments}`.

The provider adapter only translates wire blocks and retains opaque provider state. The Go dispatcher owns policy and execution. OpenAI functions use JSON-schema parameters and correlated call IDs ([function-calling guide](https://platform.openai.com/docs/guides/function-calling)); Anthropic uses `tool_use`/`tool_result` blocks and `input_schema` ([tool-use guide](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use)); Gemini uses OpenAPI-compatible declarations followed by application-executed function responses ([function-calling guide](https://ai.google.dev/gemini-api/docs/function-calling)). No provider requires a scripting engine for this loop.

Contract rules:

1. Version operation semantics in godie, not in provider prompts. Keep names stable within a major contract version.
2. Use small, closed schemas: bounded strings/integers, enums, no arbitrary recursively typed values. Validate again in Go even when a provider offers strict schema mode.
3. Treat operational failure as a correlated tool result (`ok:false`), not a broken model turn. A shell exit code is job data; malformed provider protocol is a transport error.
4. Preserve the provider's call ID exactly. Never correlate by tool name or completion order; independent calls may run concurrently.
5. Return bounded JSON/text summaries. Store long output once and return a cursor/artifact reference. Attach images through the provider adapter's native multimodal representation rather than embedding unbounded base64 in JSON.
6. Apply path, command-approval, secret-redaction, and image policies in the dispatcher. Schemas describe shape, not authorization.

### Tool families

Expose narrow operations. Providers may receive separate names such as `jobs_list` and `jobs_stop`; “jobs” below is a capability family, not a requirement for one overloaded schema.

| Capability | Minimal operations and important fields | Result semantics |
|---|---|---|
| `file` | `stat(path)`, `list(path, cursor, limit)`, optionally bounded `glob(pattern, root, cursor, limit)` | Type, size, mode, modification time, entries, next cursor. No implicit recursive walk. |
| `read` | `read(path, offset, limit)`; text by default, explicit bounded bytes when needed | Content, actual byte/line range, EOF, SHA-256/version token. Oversize data is paged, not silently truncated. |
| `write` | `write(path, content, expected_sha256, create_parents)` | Atomic replace/create, new hash and byte count. Optional expected hash prevents stale overwrite. |
| `patch` | `patch(diff, expected_hashes)` using one documented patch dialect | Validate every path and preimage before mutation; apply all-or-nothing; return per-file hashes and rejected hunks on failure. |
| `shell` | `shell(command, cwd, wait_ms, timeout_ms, input_open)` | Always registers a job first. Returns a completed snapshot or a running job ID. Wait expiry does not stop the job. Nonzero exit is a completed failed job, not a dispatcher exception. |
| `subagent` | `subagent(prompt, profile, wait_ms, timeout_ms)` | Same job snapshot shape as shell plus child session and role metadata. It is owned before launch and may outlive the initiating model turn. |
| `jobs` | list; inspect with offset/limit; input; close input; stop; watch/unwatch; snooze | State and output pages carry monotonic sequence/cursor values. Input and stop are acknowledged idempotently. Terminal state is immutable. |
| `history` | search(query, branch scope, cursor, limit); read(entry/ref, cursor, limit) | Stable references and paging; enforce cross-session authorization explicitly. Search excerpts are not substituted for original entries. |
| `image` | inspect/show a path or artifact with declared purpose | Sniff actual PNG/JPEG/WebP bytes, enforce decode/pixel/count/byte budgets, normalize if needed, then return a bounded attachment plus text metadata. |

A normal assistant response hands control back to the user. Add a dedicated `handoff` operation only if the runtime needs an explicit mid-turn suspension primitive; do not smuggle it into arbitrary code execution.

### Job ownership and cancellation

The job manager, not a tool-call goroutine, owns asynchronous work:

- Allocate and persist `jobID`, session owner, parent/child relation, launch intent, timeout, and output sequence **before** starting a process or child agent.
- A launch has two independent concepts: job deadline and caller wait budget. Canceling or timing out the wait only ends observation. Only job timeout, explicit `jobs_stop`, or app shutdown terminates owned work.
- Launch shell work in a process group. Stop the group gracefully, escalate after a bounded grace period, and reap it. A subagent and all of its descendants remain attributable to the root session.
- Queue terminal notifications with a job/event sequence and mark delivery so a reconnect or model-turn race produces neither loss nor duplicate state transitions.
- Retain bounded output in the manager; spill full output to a session artifact and page inspection. Closing stdin is distinct from stopping the job.
- Shutdown stops admission, records a cause, terminates/reaps jobs, persists final state, and only then exits.

This directly preserves the current “foreground becomes background” workflow without detached-script semantics or IPC ownership transfer.

## Alternatives

| Choice | Runtime/deployment | Packages and language | Concurrency/cancellation | Tool access and isolation | Verdict |
|---|---|---|---|---|---|
| Explicit JSON tools | One godie Go binary; project commands remain external | No generated-language dependency; conservative JSON schemas work across providers | Go job manager controls contexts, process groups, deadlines, paging, and ownership | Every capability is explicit, validated, auditable, and least-privilege | **Default and v1 recommendation** |
| Generated program via `go run` | Requires an installed `go` command and full toolchain at runtime; may use module/build caches and network | Real compiled Go and normal modules, subject to project/toolchain versions | Good OS-process boundary if the whole process group is managed; compile and run add latency and two failure phases | A child needs a new RPC/FD protocol to invoke godie tools, otherwise it only has OS/project access | Do not build in. Permit through `shell` when the project already uses Go. Reconsider only with measured need. |
| Embedded Yaegi | Pure-Go library in the godie process; no external toolchain | Interpreter README currently targets Go 1.21/1.22; source imports use vendor/GOPATH, not modules; binary libraries need compiled wrappers | Supports goroutines/channels and context-aware evaluation, but script goroutines are host goroutines and native blocking calls/process resources share godie's lifetime | Reduced default exports are not a sandbox. Exposing file/shell APIs gives in-process code those powers; crashes/resource exhaustion have no process boundary | **Reject for v1**. Its main deployment benefit does not outweigh package, compatibility, ownership, and isolation costs. |

### Why `go run` is a runtime dependency

The Go command documentation says `go run` “compiles and runs” the main package ([reference](https://pkg.go.dev/cmd/go#hdr-Compile_and_run_Go_program)). A compiled godie binary contains the Go runtime needed by godie, but it does not contain the `go` command, compiler, linker, standard-library build assets, or module machinery. Therefore a built-in feature that calls `go run` imposes a Go toolchain runtime prerequisite.

There are also reproducibility and network-policy implications. The default `GOTOOLCHAIN=auto` may select and download a newer toolchain, distributed as a `golang.org/toolchain` module ([Go toolchain selection](https://go.dev/doc/toolchain)). Module dependencies may likewise need resolution. `go run` is also documented not to forward the compiled binary's exit status transparently. These are manageable for an explicit project command, but poor hidden requirements for core model tooling.

If optional code orchestration is later justified by traces showing that multiple explicit calls materially hurt quality or cost, prefer a separately enabled **Go subprocess** over Yaegi: require an already-installed toolchain, disable silent installation, use a temporary module/cache policy, register the process group as a job before launch, and initially provide only stdin/stdout/artifact behavior. Do not add a callback bridge to all godie tools until a concrete workflow requires it. Such a bridge recreates the complexity this design removes.

### Yaegi package, library, and concurrency limits

Yaegi's official package docs say interpreted source searches vendor and GOPATH and that Go modules are not supported; precompiled packages are linked into the host, exposed through `Use`, and may need generated wrappers ([`interp` package docs](https://pkg.go.dev/github.com/traefik/yaegi/interp)). Its README lists unsupported assembly, C calls, compiler/linker/embed directives, dynamic-interface wrapper constraints, reflection differences, and slower compute-heavy execution ([README limitations](https://github.com/traefik/yaegi#limitations)). The README's stated supported releases are Go 1.21 and 1.22, and the latest tag is v0.16.1 from April 2024 ([release](https://github.com/traefik/yaegi/releases/tag/v0.16.1)). Arbitrary contemporary project packages should therefore not be assumed compatible.

The context APIs are valuable but not an isolation boundary. Yaegi's context path interrupts interpreter execution and cancellable channel operations ([source](https://github.com/traefik/yaegi/blob/master/interp/interp.go)); an interpreted `go` statement launches a real host goroutine ([source](https://github.com/traefik/yaegi/blob/master/interp/run.go#L1578-L1590)). Interpreted code and exposed native functions share godie's heap, scheduler, descriptors, and process. A context cannot generally force an arbitrary blocking native call to cooperate, and script-created goroutines require their own lifetime protocol. Running one interpreter per call still does not give the kill/reap boundary of a subprocess.

## Workflow parity without code snippets

- **Inspect then edit:** parallel `file`/`read` calls, then hash-guarded `patch`; no script needed.
- **Build/test/search:** `shell` runs the repository's normal tools. A short wait returns quickly while the same session-owned job continues; `jobs_inspect` pages output.
- **Interactive process:** launch with input open, then `jobs_input`, `jobs_close_input`, or `jobs_stop`.
- **Delegate:** `subagent` returns a job ID immediately or a terminal result after the wait budget; completion is later injected once from the owner queue.
- **Large result:** inline summary plus stable artifact/cursor, not captured in model-generated memory.
- **Visual inspection:** `image` converts a bounded local artifact into provider-native image content.
- **Complex repetition:** first use parallel tool calls or the project's own CLI through `shell`. Add a narrowly scoped batch operation only after repeated traces establish a real need.

This is less syntactically composable than arbitrary code, but substantially simpler to secure, cancel, observe, test, and support across providers. It also makes every durable side effect visible to the Go owner.

## Recommendation

1. Ship explicit Go-dispatched tools and a single session-owned job manager.
2. Do not ship a general code tool in v1.
3. Keep `go run` available only as an ordinary shell command when present in the user's environment; godie must neither require nor install it.
4. Do not embed Yaegi. Revisit only for a specific trusted extension use case that needs neither arbitrary modules nor process isolation—not as the coding-agent orchestration layer.
5. Test workflow parity and lifecycle races, not JavaScript API compatibility: patch conflicts, parallel calls, launch/ack/turn-cancel races, foreground-to-background transition, process-group stop, stdin close, output spill/paging, completion deduplication, child-session resume, history authorization, and image limits.

## Primary sources

- Go command, `go run`: <https://pkg.go.dev/cmd/go#hdr-Compile_and_run_Go_program>
- Go toolchain selection/downloads: <https://go.dev/doc/toolchain>
- Yaegi README and limitations: <https://github.com/traefik/yaegi/blob/master/README.md>
- Yaegi interpreter API: <https://pkg.go.dev/github.com/traefik/yaegi/interp>
- Yaegi context and goroutine implementation: <https://github.com/traefik/yaegi/blob/master/interp/interp.go>, <https://github.com/traefik/yaegi/blob/master/interp/run.go>
- OpenAI function calling: <https://platform.openai.com/docs/guides/function-calling>
- Anthropic tool use: <https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use>
- Gemini function calling: <https://ai.google.dev/gemini-api/docs/function-calling>

Search/source capture notes: [`sources/tools-primary.md`](sources/tools-primary.md), [`sources/tools-go-run-search.json`](sources/tools-go-run-search.json), and [`sources/tools-yaegi-search.json`](sources/tools-yaegi-search.json).
