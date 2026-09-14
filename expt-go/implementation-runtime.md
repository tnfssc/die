# Runtime implementation

## API

Package `godie/internal/runtime` exports:

`Config{CWD, StateDir, SessionFile, BunPath string; Helper core.Helper; KillGrace, ShutdownTimeout time.Duration}`, `New(Config) (*Runtime, error)`, `Execute(context.Context, string, time.Duration)`, `Call(...)`, `Launch(ctx, argv []string, LaunchOptions) (Job,error)`, `LaunchForeground(ctx, argv, LaunchOptions, wait time.Duration) (Inspection,error)`, `Events()`, `Running()`, and idempotent `Close()`. `LaunchOptions{ID,Kind,CWD,DisplayCommand,CallerID string; Env map[string]string; Timeout time.Duration; CloseInput bool; Agent *AgentInfo}`. `AgentInfo` carries type/model/thinking/depth/sessionFile/parentSessionFile/phase. Public `Launch` is immediately background-owned; use `LaunchForeground` for helper wait semantics and provisional ACK ownership.

`Call` accepts the existing wire names and lower-camel JSON fields: `shell`, `jobs.list`, `jobs.inspect`, `jobs.input`, `jobs.closeInput`, `jobs.stop`, `jobs.snooze`, and `jobs.setWatch`. Unknown methods, including `subagent`, `history.*`, and `goal.*`, are passed unchanged to `Config.Helper`. Execute intercepts `handoff` and records its message in `core.ExecuteResult`.

## Ownership and behavior

Go owns all shell jobs. Jobs use unique process groups, a one-megabyte bounded byte ring, absolute monotonic offsets, UTF-8-safe inspection pages of at most 5,000 bytes, writable/closable stdin, independent job timeouts, TERM/KILL escalation, and shutdown reaping. Foreground waits return after `waitSeconds` (default 3); expiration or execute cancellation transfers the durable job to the background rather than killing it. Completion and inactivity-attention events are event driven. Watches begin enabled, first notify after five quiet minutes, repeat every ten minutes, and support snooze/disable.

Bun 1.4.1 executes one isolated stdin module per call with a synthetic `<cwd>/__die_execute__.ts` `__filename`, TypeScript, top-level await, project module resolution, Node/Bun APIs, imports and require. A preload exposes shell/jobs/subagent/history/goal/handoff/showImage and uses bounded newline JSON RPC on inherited fds. stdout/stderr are captured together; output over 4,000 Unicode characters spills complete bytes to a mode-0600 session artifact and returns a Unicode-safe bounded tail. Artifact failures are explicit in the result. Image frames accept PNG/JPEG/WebP and enforce four images, 25 MB input, and 10 MB total. Execute cancellation or runtime shutdown signals only the Bun worker process group; Go-owned jobs survive execute cancellation.

When `BunPath` is supplied it must be an executable regular file. Otherwise Linux/amd64 extracts the embedded, pinned Bun into a runner-hash-versioned private state cache. Extraction is create-exclusive, size bounded, SHA-256 checked, synced, chmod 0700, and atomically renamed. Existing cache bytes are re-hashed before execution. `scripts/build-runtime-assets.sh` only copies verified Bun bytes into godie and performs no install/download.

## Completed parity work

- Images over 5 MB are resized in the isolated Bun runner with embedded Photon (up to 25 MB input), and Photon is not an app dependency.
- Async framed RPC supports concurrent `Promise.all` calls; responses may complete out of order. Foreground completion ownership is provisional until response ACK plus clean worker exit; crash/protocol/cancellation restores one Go completion. Only background-owned jobs emit completion events. Completion/attention use bounded channel backpressure and are never default-dropped; UI lifecycle hints may coalesce.
- A metadata-only, locked, fsynced, mode-0600 `<session>.jobs.jsonl` lifecycle sidecar records spawn/stop/complete and excludes command/output/prompt.
- The 20:03 independent-review runtime findings are covered: blocked stdin writes no longer hold the job mutex; capture pumps finish before completion; normal execute leader exit SIGKILLs remaining process-group descendants; timeout contexts remain attached to registered shutdown cancellation. Execute previews now use the original 4,000-Unicode-character shared bound, spill complete bytes, and explicitly report artifact creation/write/sync/close failures.

- Targeted execute parity maps explicit execute deadlines to `Execution timed out (SIGTERM).`, preserves parent/shutdown cancellation errors, and matches the invalid-image header diagnostic while retaining the four-image, 25 MB input, and 10 MB total bounds.

## Validation performed

- `go test -race ./internal/runtime`
- Integrated original/candidate execute parity: all six scenarios match (`language-modules`, Unicode/space paths, stdout/stderr spill, exception, 250 ms timeout, and bounded images), recorded in `evidence/execute-parity-integrated`.
- 50 concurrent shell jobs; 50 actual helper calls from one `Promise.all` (measured concurrent); foreground clean/crash ownership; blocked-input stop; clean-exit descendant reap; Unicode 4,000-character output/artifact behavior; 270 completion events beyond channel capacity; argv agent metadata; lifecycle sidecar; oversized Photon resize; output/UTF-8 offsets; execute cancellation with a surviving durable job; and actual `die-original --die-internal-execute` differential TS/dynamic-import/Promise snippets in isolated homes.
- Embedded payload is Bun 1.4.1 Linux amd64, decompressed SHA-256 `69293d3be4f0d6d624ca8581af4574435fa39209ab67e89eb03912866f3e14cb`.

## Gaps / release blockers

- Linux amd64/glibc is the only embedded target. Windows Job Objects and other Bun target payloads are not implemented.
- Bun's version-matched complete notices/source-offer and LGPL redistribution review still need coordinator/release ownership; do not distribute this artifact as legally cleared.
- Attention timing has unit-level implementation but no five-minute wall-clock acceptance run. PTY, package-resolution golden matrix, noexec/low-space/interrupted-extraction, symlink-adversary, and original-binary black-box comparisons remain release validation work.

## Final coordinator packaging repair
Replaced crash-stale O_EXCL extraction lock with bounded kernel flock, retaining lock inode to avoid split-lock races. assets_recovery_test.go verifies a stale lock file is harmless. scripts/extraction_probe.py exercised16 concurrent first launches, actual kill during .bun temporary extraction, recovery, deliberate cache corruption and read-only valid cache. All pass in evidence/final-extraction; no host Bun required.

## Final independent distribution findings incorporated
Cache parent/asset symlinks are rejected without following targets, unsafe owned asset modes repaired through file descriptors, and only owned private cache directory modes normalized. Bun and lock opens use O_NOFOLLOW. Independent distribution11 gates pass after these changes. More importantly, the intermittent empty output had a concrete remaining StdoutPipe/Wait race in Execute: now os.Pipe pairs are parent-owned so cmd.Wait cannot close read ends before capture drains. New16-way fast-output test covers this. Corrupted temporary ELF payload exits1 gzip checksum error and publishes no Bun; original binary untouched.
