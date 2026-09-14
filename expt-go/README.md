# expt-go — experimental Go implementation of Die

**Experimental:** this project is under evaluation and is not production-ready or parity-complete. Go owns CLI/TUI, providers, sessions, turns, jobs and child agents. **Bundled Bun 1.4.1 runs execute JS/TS only**; this is not a Pi launcher. Linux amd64 development artifact: **bin/godie**.

## Build and run

Requires Go 1.25.7 to build; no host Go, Bun, Node or repository is needed to run the binary.

~~~sh
cd expt-go
./scripts/build.sh
./bin/godie --help
./bin/godie --offline --execute 'const n: number = 42; console.log(n)'
./bin/godie --provider openai --model gpt-4o -p 'Hello'
~~~

Default state is **~/.godie**; use --state-dir DIR or GODIE_STATE_DIR for isolation. Existing global Die auth/sessions are not implicitly imported or rewritten. Project AGENTS/CLAUDE guidance and trusted project .die/.godie prompt/settings files are read-only. --no-context-files disables context discovery; --no-approve ignores project-local prompt/settings/context files.

Explicit, source-read-only Codex credential import:

~~~sh
./bin/godie --state-dir /isolated/state --import-codex-auth /path/to/die/auth.json
./bin/godie --state-dir /isolated/state --provider openai-codex --model gpt-5.6-luna -p 'Hello'
~~~

Use --login-codex for browser OAuth into isolated Go state. Never pass production credentials to fixture scripts.

## Interfaces

- No -p: inline terminal editor, compact prompt/footer, streaming transcript, job/model/profile overlays, double Ctrl-C exit.
- Type `/` for command completion, including skills/templates. Up/Down select, Tab fills, Enter fills and runs, Escape dismisses.
- -p: final assistant text after owned background jobs settle. Leading slash text is literal model input, matching the original.
- --mode json: streaming compatibility events. --mode rpc: supported JSON-line RPC operations; not the entire Pi SDK protocol.
- --continue, --resume catalog, --session PATH|ID-PREFIX, --session-id UUID, --fork PATH|ID, --name, --export SESSION [HTML].
- Interactive /new, /resume PATH|ID, /fork [ENTRY], /clone close the old application before replacing it; running jobs and child identity prevent unsafe navigation.
- @file text and PNG/JPEG/WebP prompt attachments. Image input currently has a 3,000,000-byte aggregate cap; it is not the original full image-size envelope.
- /goal, /history search|read, /session, /tree, /export, /mode, /cache-ttl, /fast, /shake, /compact, /memory, /diagnostics [durable].
- Development controls: --command '/status' explicitly executes a local command; --execute CODE invokes bundled execute without a provider. Go's --offline disables provider requests, stronger than the original startup-only offline flag.

Execute exposes shell, subagent, jobs, history, goal, handoff, Bun/Node/Web APIs and images. Go owns durable jobs separately from execute workers. **Arbitrary code execution, not a sandbox.**

## Provider configuration

Native OpenAI Responses, Codex, Anthropic and Gemini adapters are included. Set provider keys through environment or explicit CLI options. Custom providers load from STATE/models.json (also STATE/agent/models.json). Supported API mappings: openai-completions, openai-responses, anthropic-messages and google-generative-ai:

~~~json
{"providers":{"local":{"api":"openai-completions","baseUrl":"http://127.0.0.1:8080/v1","apiKey":"local-key","models":[{"id":"model","name":"Local model"}]}}}
~~~

Then run --provider local --model model. Provider/model base URLs, headers, reasoning capabilities, token/context limits and supported built-in model overrides are resolved before requests. See [configuration details and limits](implementation-config.md); command/environment value expansion and other Pi-specific knobs remain unsupported. Read-only settings.json startup defaults support defaultProvider/defaultModel/defaultThinkingLevel; explicit flags win.

## Markdown resources

Go-native skills and prompt templates support default global/project discovery, `/skill:name`, template slash expansion with arguments, repeatable `--skill` / `--prompt-template` paths and `--no-skills` / `--no-prompt-templates`. `--no-approve` excludes project resources; `--no-context-files` affects context files only. Discovery does not execute resource scripts. See [resource behavior](implementation-resources.md) for exact paths and limits.

## Evidence and remaining boundaries

Run scripts/final-checks.sh from any directory for the full local regression/build sequence (requires the already-built bin/die-original baseline). It performs no live calls. Inspect manifest results, not just script exit: capture harnesses retain known FAIL/DIFF classifications.

See [PARITY.md](PARITY.md), [IMPLEMENTATION.md](IMPLEMENTATION.md), and evidence/final-* for actual gates and remaining mismatches. Main-owned validation/ reports record independent findings, later rechecks and explicit oracle corrections. Passing package tests is not whole-app parity.

Still incomplete: writable legacy Pi-session migration; arbitrary JavaScript extensions, package/theme resources and settings-based resource arrays; full RPC/event and CLI catalog compatibility; exact terminal styling/warnings/selectors and every interaction; full diagnostic-ring parity; larger CLI images; all provider/model/live-native paths. Native compaction live evidence is candidate-only. No premium live request was made; no additional live calls were made in the final integration pass.

## Bundled runtime and redistribution

The binary embeds compressed Bun, runner JS and Photon image assets. Extraction is hash-verified, atomic and process-lock protected; cache components reject symlinks and normalize owned asset modes; interrupted/corrupt cache recovery, 50 concurrent first starts, read-only valid cache and relocation with PATH=/nonexistent have executable evidence. --licenses prints bundled notices.

scripts/build-runtime-assets.sh regenerates assets from an explicit existing Bun executable; it does not install/download Bun. scripts/notices.py collects local pinned notices. Neither is needed for ordinary builds from this tree.

**Not approved as a redistributable release:** official runtime asset provenance and complete version-matched notices/LGPL source/relinking obligations still need review. Nothing installs over the existing Die executable.
