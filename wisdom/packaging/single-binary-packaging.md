# Single-binary CLI + web — main review handoff

## State / boundaries

No commit, tag, push, release, or install ran. The last official release is still 0.2.12. The failed immutable v0.2.13 tag did not change. Repo `dist/die` and installed software did not change. Packaging work did not edit protected `src/tasks/native-compaction.ts`, `tests/native-compaction.test.ts`, or the separate `tests/task-monitor-tui.test.ts`. Isolated checks only copied and ran them. Package version is still 0.2.13. Main must choose a new version and tag before any release.

## Current candidate

- `dist/die-bundled` — Linux x64 baseline, Bun 1.4.1
- SHA-256 d8de9e58f01095f208be66c2c61aca35aaa627a3ae9e1230c1cd97cf93785380
- 151487968 bytes
- Older `dist/die-bundled-final` and `-next` files are replaced and must not ship. They have the node-pty terminal bug. Only current `dist/die-bundled` has the native Bun PTY.
- Backend pin stays 6f00d3881a197dd33c2cb43c6a11a9e759e56089.
- Canonical `web/t3.patch` SHA-256 is 1215e936aaf99997ae7f5cfc98fced37baccddf985abe173f093a11154f255f3.
- Main staged every tracked and untracked `apps` and `packages` file in a private temporary index, reversed the canonical patch, and got the exact pinned tree 71d7686c11723058d57d08a4271d5fb01aa7e537. The worktree reverse check passes. Embedded `SOURCE.txt` matches the pin and patch hash.

## Architecture / why

1. A normal build makes the pinned, patched T3 frontend and backend. It deploys the production graph, then packs a stable gzip manifest and bytes while keeping internal pnpm symlinks and executable bits. A Bun file import embeds the archive, and the build compiles one executable. Runtime needs no web download and no outside Node or Bun install.
2. The first `die web` extracts to private `XDG_CACHE_HOME/die/web-runtime/<archiveSHA256>`, or `~/.cache/die/web-runtime` by default. Unique staging siblings, a complete marker, and atomic rename let concurrent starts settle on one result. Tests cover stable output, corrupt-payload cleanup, concurrent first starts, symlink-target rejection, modes, and reuse. CLI-only starts do not unpack web files.
3. A compiled Bun process could not dynamically import the backend in-process because real `createRequire(@ff-labs/fff-node)` lookup failed even though the package existed. A self-exec interpreter proof passed. The parent now starts its own executable with `BUN_BE_BUN=1` on extracted `bootstrap.mjs`. Bootstrap removes the flag before importing the backend. The backend exports `runCli(args): Promise<number>` with explicit args, scoped Effect services, and signal and teardown lifetime. The parent forwards signals only to its own child.
4. Optional `process.getBuiltinModule` lookup replaced the static `node:sea` import. SEA detection remains SEA-only. Tests showed `Bun.main===execPath` is false, and Die does not use T3 hidden commands. LocalDeviceHost, AgentDeviceShim, and Claude JavaScript helpers opt into Bun interpreter mode. Pi and provider CLI children clear it. The POSIX shim starts with `BUN_BE_BUN=1 exec`. A compiled two-hop agent-device fixture passed.
5. A second real blocker appeared. Bun 1.4.1 with node-pty 1.1.0 emits `EAGAIN` from interactive `tty.ReadStream`, closes the PTY master, and gives the shell `SIGHUP` within milliseconds. Short noninteractive PTY checks missed it. A delayed interactive check and browsers on both draft and saved threads reproduced it. Native `Bun.Terminal` worked. A small `BunPtyAdapter` now loads before node-pty when Bun hosts the backend. It handles buffered early data and exit, write, resize, kill, signal mapping, and handle close. Delayed native shell, resize, exit, and kill tests passed. Node development still falls back to node-pty.
6. Old Node sidecar launchers are gone. The local installer copies only the executable. Releases publish one executable plus checksum, licenses, and source, with no web tarball. CI now installs pinned build-time pnpm. The release gate runs native Bun PTY tests. Upstream build tools still need Node 24 and pnpm at build time, but runtime does not.

## Validation

- A fresh baseline build passed. Log: `artifacts/single-binary-native-pty-build.log`.
- The current candidate passed 29 focused packaging, runtime, launcher, install-fixture, and release-workflow tests. Log: `artifacts/single-binary-latest-tests.log`. One test copies only the executable to a private directory and runs `die web --help` with `PATH=/nonexistent`. There is no nearby sidecar or runtime.
- Core typecheck and format passed. Lint exited 0 with old warnings and infos. Root and patched-source diff checks passed. `.gitattributes` keeps the unified patch's meaningful space-only context lines out of whitespace lint; source checks still run.
- Before the small native adapter change, 127 backend Pi, RPC, auth, startup, and LocalDeviceHost tests passed. After it, eight native-adapter and Node-fallback tests plus backend typecheck passed. Five agent-device and shared-helper tests passed.
- The current binary passed real browser chat, execute, background subagent, and terminal work with a private runtime PATH containing only `sh`, `bash`, `git`, `uname`, and `sleep` links. It had no `node`, `bun`, or `npm`. HOME and TMPDIR were private, `HERDR_ENV=0`, and the server used its own random port. The fake provider received four requests. The terminal command used octal escapes, so keyboard echo could not fake success. Marker `DIE_PTY_50ba713b455a4f1ea212280ab64fd882` arrived in terminal output frames and was visible in Ghostty. Canvas resize passed. Evidence: `single-binary-native-terminal-browser.log`, `die-web-terminal-summary.json`, `die-web-terminal-frames.json`, and `die-web-smoke.png`. Command: `DIE_WEB_TEST_TERMINAL=1 DIE_WEB_BINARY=<candidate> bun scripts/die-web-smoke.ts`, with `DIE_WEB_CHROMIUM` set when needed.
- Mode, model, and Stop all passed on the current hash without Node, Bun, or npm on the candidate PATH. A full stable suite used a private source mirror with the candidate copied to `dist/die`: 616 pass, 14 skip, 0 fail; 630 tests in 87 files with 3872 assertions in 70.97 seconds. The candidate hash did not change. Repo `dist/die` stayed untouched, and the mirror was removed. Long-lived evidence is in `artifacts/single-binary-final-validation/SUMMARY.md` and `core-suite.log`. Two kept diagnostic logs came from invalid, overly narrow PATH attempts. They are not the main result. Core tests intentionally use environment and Node fixture helpers. Runtime independence is proved separately by the moved executable and browser smoke tests.
- The browser terminal fixture waits for initial output and then 500 ms for Ghostty input attachment. The textarea appears just before handlers attach, so immediate typing can lose a prefix. This wait is fixture readiness, not a claim about all cold-input timing.

## Safety / remaining scope

No paid provider ran. Tests used only a loopback fake provider. Browser and server work used private HOME, random ports, and owned child handles. It never used port 13773, searched for or killed existing PIDs, or touched user server, session, or settings data. Nothing was deployed.

Checks covered Linux x64 and headless Chromium 1228. They did not cover other platforms, remote SSH device install, real iOS simulators, or paid or real Claude history integration. Local helper paths were fixed, but those optional paths remain unproved. The backend license bundle gathers packaged licenses and the T3 license. It is not a full third-party legal or ABI audit. Main review and a new-version choice are still needed before release.
