# Direct dependency registry audit (2026-09-24)

Queried the public npm registry latest endpoint for every root direct dependency and devDependency (HTTP 200 for all); these are registry results, not semver guesses:

| Direct package | Manifest / resolved lock | npm latest |
| --- | --- | --- |
| @earendil-works/pi-ai | 0.87.1 | 0.87.1 |
| @earendil-works/pi-coding-agent | 0.87.1 | 0.87.1 |
| @earendil-works/pi-server | 0.87.1 | 0.87.1 |
| @earendil-works/pi-tui | 0.87.1 | 0.87.1 |
| @google/genai | 2.24.0 | 2.24.0 |
| es-module-lexer | ^3.0.2 / 3.0.2 | 3.0.2 |
| resolve.exports | 2.0.3 | 2.0.3 |
| zod | 4.6.5 | 4.6.5 |
| @biomejs/biome | 2.5.14 | 2.5.14 |
| @types/bun | 1.4.2 | 1.4.2 |
| typescript | 7.0.2 | 7.0.2 |

Only root package.json and bun.lock are tracked owned manifests/locks; a filesystem walk excluding generated caches and node_modules found no other owned manifests. The lock workspace specifications and resolved direct entries match the manifest. No newer major or other latest direct version exists to inspect or defer today. No manifest or lock change is warranted.

Pi remains pinned at 0.87.1. src/live/credentials.ts imports private Pi dist/core/auth-storage.js; the session-manager adapter also depends on guarded SDK internals. A future Pi release needs source/contract review and focused tests before bumping. Native SDK/T3 web source is pinned separately; no vendored tree was regenerated. See pi-0.87-upgrade.md and pi-0.87.1-update.md.

Static registry and manifest/lock comparisons passed. Full tests/check/build could not run without installing dependencies: this worktree has no node_modules and shell has no bun executable (bun run check exited 127). No tools or packages were installed; no paid providers, devices, secrets, pushes, or vendored web regeneration were used. Values stayed unchanged: “Know what a change means” already covers this decision.
