# Tool-execution primary-source notes

Retrieved 2026-09-13. These are research notes, not an implementation specification.

## Go command / `go run`

- Go command reference, **Compile and run Go program**: <https://pkg.go.dev/cmd/go#hdr-Compile_and_run_Go_program>
  - `go run` “compiles and runs the named main Go package.” It accepts package arguments, a version suffix such as `@latest`, or a list of `.go` files.
  - With module-aware mode it runs in the main module's context. It runs the compiled binary directly by default.
  - It intentionally omits debugger information by default to reduce build time.
  - The documented exit status of `go run` is **not** the exit status of the compiled binary. A wrapper must not mistake this for a transparent execution API.
- Go toolchain selection: <https://go.dev/doc/toolchain>
  - The `go` and `toolchain` lines act like toolchain-version requirements.
  - `GOTOOLCHAIN=auto` is the default. In auto mode the `go` command may select and download a newer toolchain; downloaded toolchains are special `golang.org/toolchain` modules.

Research consequence: invoking `go run` necessarily requires a working `go` command/toolchain at execution time. A statically distributed godie binary does not supply that command. Module and toolchain selection can also entail network/cache activity unless policy and environment prevent it.

## Yaegi

- Project README: <https://github.com/traefik/yaegi/blob/master/README.md>
  - Yaegi describes itself as a pure-Go interpreter embedded with `New`, `Eval`, and `Use`.
  - The current README says it supports Go 1.21 and 1.22. The latest tagged release is v0.16.1 (2024-04-03): <https://github.com/traefik/yaegi/releases/tag/v0.16.1>.
  - Published limitations: no assembly, no calling C, no compiler/linker/embed directives, dynamic interfaces crossing into precompiled code require precompiled wrappers, reflection/type-printing differences, and significantly slower compute-heavy interpreted code.
  - It says source Go modules are not supported: source packages are found in vendor or GOPATH.
- Package API: <https://pkg.go.dev/github.com/traefik/yaegi/interp>
  - Source packages are searched in vendor then GOPATH. Binary-form packages must be compiled into the host and exposed with `Interpreter.Use`; Yaegi's extract command generates wrappers.
  - `EvalWithContext`, `EvalPathWithContext`, and `ExecuteWithContext` accept cancellation contexts.
  - `Options.SourcecodeFilesystem` controls where interpreted *source* is loaded; the docs explicitly say it does not control the filesystem scripts use when running.
  - `Options.Unrestricted` exposes non-sandboxed standard-library symbols such as `os/exec` and environment access. The README says `unsafe` and `syscall` are not exported by default, which is a reduced default capability, not process isolation.
  - Documented package bugs include incomplete recursive-type support and incomplete support for types implementing multiple interfaces.
- Interpreter source, context stop path: <https://github.com/traefik/yaegi/blob/master/interp/interp.go>
  - Context-aware evaluation starts evaluation in a host goroutine; on cancellation, `stop` changes the run id and closes the channel used to interrupt interpreter/channel operations.
- Interpreter source, `go` statement: <https://github.com/traefik/yaegi/blob/master/interp/run.go#L1578-L1590>
  - An interpreted `go f()` launches `go callFn(...)`, an actual host goroutine. The shown path does not join it to the evaluation's lifetime.
- Project issue tracker (support-risk evidence, not normative documentation): <https://github.com/traefik/yaegi/issues>
  - Open issues exist around generic-package interoperability, for example [#1457](https://github.com/traefik/yaegi/issues/1457) and [#1700](https://github.com/traefik/yaegi/issues/1700). Evaluate required packages with tests instead of assuming README “complete support” means transparent compatibility with arbitrary current modules.

Research consequence: Yaegi avoids an external runtime and does support Go concurrency constructs, but execution shares godie's process, heap, scheduler, and exposed native calls. Context APIs are useful cooperative interruption; they are not a hard CPU/memory/security boundary, and script-created goroutines/native blocking calls complicate lifetime control. Its package model is a poor fit for arbitrary user modules.

## Model-native function/tool calls

- OpenAI function calling: <https://platform.openai.com/docs/guides/function-calling>
  - Functions are declared with name, description, and JSON-schema parameters. The model emits function calls; the application executes them and returns outputs matched by call ID.
  - Strict mode supports reliable schema adherence with documented schema restrictions. The application still validates and authorizes inputs.
- OpenAI Responses API reference: <https://platform.openai.com/docs/api-reference/responses/create>
  - Responses accepts tools and can emit function-call output items; the client returns `function_call_output` associated with a `call_id`.
- Anthropic tool use: <https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use>
  - Client tools have `name`, `description`, and `input_schema`. Claude emits `tool_use` blocks with IDs; the client returns corresponding `tool_result` blocks.
- Gemini function calling: <https://ai.google.dev/gemini-api/docs/function-calling>
  - Function declarations use an OpenAPI-compatible schema. The model returns a function call; the application executes it and sends a function response. Modes include automatic, forced/any, and none.

Research consequence: all three provider families already support the same portable application loop—declare a conservative schema, receive name/arguments/call identity, execute in Go, and return a correlated result. Provider adapters should retain provider call IDs and opaque provider state while the dispatcher remains provider-neutral.

## Tavily CLI search record

Queries attempted with `tvly search --depth advanced --include-raw-content markdown --json` included:

- `site:go.dev cmd go run documentation compile run packages`
- `site:github.com/traefik/yaegi README limitations goroutines interfaces Go interpreter`
- `site:pkg.go.dev github.com/traefik/yaegi interp Options Use EvalPath documentation`
- official-domain searches for OpenAI, Anthropic, and Gemini function calling
- a combined official-domain search for Go-native tools, `go run`, and Yaegi

The shared keyless Tavily quota repeatedly returned `hourly_cap_reached`. Successful primary-domain result captures are stored in `tools-go-run-search.json` and `tools-yaegi-search.json`; the provider search was quota-blocked. All claims were verified against the linked primary pages directly, and no search-result snippet is treated as evidence.
