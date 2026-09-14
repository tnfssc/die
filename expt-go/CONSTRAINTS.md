# Experimental Go rewrite constraints

**Status: experimental; not production-ready or parity-complete.**

Latest user direction (2026-09-13): **investigate embedding/bundling Bun for execute**. This supersedes the earlier full-Go-only runtime restriction.

- App core, TUI, provider integrations, sessions, and agent/job orchestration remain Go.
- Preserve programmable JS/TS execute by bundling a Bun executable, subject to packaging/protocol validation. Bun is a child-process runtime, not an assumed in-process Go library.
- Proposed packaging: embed Bun bytes and runner assets in the Go release binary, extract into a versioned cache, launch as a subprocess. Validate binary size, notices, atomic extraction, Linux support, and cancellation before committing to this distribution design.
- The Go process owns durable jobs and subagents; cancelling an execute runner must not accidentally kill already handed-off jobs.
- No implementation or compatibility proof yet. Earlier research may discuss now-rejected Go-only alternatives.
