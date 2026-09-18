# die

A coding agent built on [Pi](https://pi.dev), with a terminal interface, a bundled web UI, and first-class Herdr integration. One standalone executable includes background jobs, sub-agents, and project-local memory.

## Install

Linux x64/arm64, macOS Apple Silicon, and Android Termux arm64:

```sh
os="$(uname -s | tr A-Z a-z)"; [ "$(uname -o 2>/dev/null)" = Android ] && os=android; asset="die-$os-$(uname -m | sed s/aarch64/arm64/ | sed s/x86_64/x64/)"; mkdir -p ~/.local/bin && cd "$(mktemp -d)" && curl -fLO "https://github.com/tnfssc/die/releases/latest/download/$asset" && curl -fLO "https://github.com/tnfssc/die/releases/latest/download/$asset.sha256" && (sha256sum -c "$asset.sha256" 2>/dev/null || shasum -a 256 -c "$asset.sha256") && install -m 755 "$asset" ~/.local/bin/die
```

Make sure `~/.local/bin` is on your `PATH`, then run:

```sh
die
```

To upgrade later:

```sh
die update
```

## Common commands

```sh
die                         # Start the interactive TUI
die web                     # Start the web UI
die -p "Describe this tree" # Run one prompt and exit
die -c                      # Continue the latest session
die -r                      # Pick a saved session to resume
```

Inside `die`, type `/` to see available commands.

## Web UI

Run `die web` and open the local URL it prints. The browser interface is built on [T3 Code](https://github.com/pingdotgg/t3code) and is bundled in the executable—no separate Node or Bun installation needed.

Chat with die, switch models and agent modes, follow background agents, review changes, and use the integrated terminal. The server binds to `127.0.0.1` by default. Run `die web --help` for options.

## Herdr integration

Run die in a Herdr-managed terminal pane and it automatically reports whether it is working, idle, or waiting for input. Background jobs and sub-agents keep the pane marked as working even after the foreground turn ends.

The integration is built in: no extra extension or configuration needed. Herdr is optional; die works on its own too. See [Herdr integration](docs/herdr.md) for lifecycle and compatibility details.

## Build from source

Install Bun 1.4.1, Node 24, and pnpm 11, then run:

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

Install your local build:

```sh
bun run install:local
```

## Notes

- Released binaries currently support Linux x64/arm64, macOS Apple Silicon, and Android Termux arm64.
- Credentials and model configuration are supplied at runtime, like Pi.
- State is stored under `~/.die`.
- See `docs/` for design notes and deeper documentation.

## Resource limits

Die bounds retained job output, execute capture, and persistent session-body caching without deleting original session history. See [resource limits](docs/resource-limits.md) for defaults, truncation semantics, storage ownership, and web shutdown behavior.
