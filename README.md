# die

A coding agent built on [Pi](https://pi.dev). One standalone executable gives you a terminal interface, a bundled web UI, Herdr integration, background jobs, sub-agents, and project wisdom.

## Install

Linux x64/arm64, macOS Apple Silicon, and Android Termux arm64:

```sh
os="$(uname -s | tr A-Z a-z)"; [ "$(uname -o 2>/dev/null)" = Android ] && os=android; asset="die-$os-$(uname -m | sed s/aarch64/arm64/ | sed s/x86_64/x64/)"; mkdir -p ~/.local/bin && cd "$(mktemp -d)" && curl -fLO "https://github.com/tnfssc/die/releases/latest/download/$asset" && curl -fLO "https://github.com/tnfssc/die/releases/latest/download/$asset.sha256" && (sha256sum -c "$asset.sha256" 2>/dev/null || shasum -a 256 -c "$asset.sha256") && install -m 755 "$asset" ~/.local/bin/die
```

Put `~/.local/bin` on your `PATH`. Then run:

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

Run `die web` and open the local URL it prints. The browser interface is built on [T3 Code](https://github.com/pingdotgg/t3code). It comes in the executable, so you need no separate Node or Bun install.

The bundled source is pinned to the official **preview** channel (`v0.0.43-preview.20260921.2045`), not nightly. Exact upstream revision and local integration changes are recorded in `web/t3-source.json` and `web/t3.patch`.

Chat with die, switch models and agent modes, follow background agents, review changes, and use the integrated terminal. The server binds to `127.0.0.1` by default. Run `die web --help` for options.

## Subagent workspaces

Subagents share the current checkout by default. Work that needs isolation can use a separate Git worktree and branch. The configured setup runs there. CLI worktrees do not need the web server. See [subagent workspaces](./wisdom/worktrees/subagent-workspaces.md) for the API and retention behavior.

## Herdr integration

Run die in a Herdr-managed terminal pane and it automatically reports whether it is working, idle, or waiting for input. Background jobs and sub-agents keep the pane marked as working even after the foreground turn ends.

The integration is built in. It needs no extra extension or setup. Herdr is optional; die also works on its own. See [Herdr integration](./wisdom/integrations/herdr.md) for lifecycle and compatibility details.

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

## Project wisdom

- Released binaries currently support Linux x64/arm64, macOS Apple Silicon, and Android Termux arm64.
- Credentials and model configuration are supplied at runtime, like Pi.
- State is stored under `~/.die`.
- See `wisdom/` for durable project context and deeper feature notes.

## Resource limits

Die limits stored job output, execute capture, and persistent session-body caching. It does not delete original session history. See [resource limits](./wisdom/resources/resource-limits.md) for defaults, truncation semantics, storage ownership, and web shutdown behavior.
