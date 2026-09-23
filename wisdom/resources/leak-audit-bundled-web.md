# Bundled Bun web runtime leak audit

Date: 2026-09-18

## Scope and result

This closes the shipped-runtime gap left by the Node/inspector audit.
I ran the actual compiled `dist/die web serve`, which extracted and self-executed its embedded backend with Bun.
The product was not modified.
The run completed 600 ticket/WebSocket reconnects with successful Effect RPC `subscribeServerConfig` handshakes, then held 64 subscribed sockets open and closed them.
All 674 expected subscription responses arrived and the audit recorded no errors.

**Result:** no retained process-level resource growth was visible after the 5-second quiescence point.
During reconnect churn and while sockets were held, backend RSS rose substantially.
After sockets closed and the runtime became quiescent, RSS fell to 294,180 KiB, below the 301,204 KiB warmed baseline.
This is **process RSS, not JavaScript/Bun heap**. No heap claim is made.
FDs returned from 86 while held to 21 (warmed baseline 25).
Threads remained at 21.
No backend descendants appeared.

## Provenance

- compiled candidate: `dist/die`, version `0.3.4`
- binary SHA-256: `da358b97c8fadadeeef2ff6caab82787d4ddb30a5c42dbd8709e4a3bfdc1222a`
- repository HEAD: `f9d3e5cc51f164dca43fc445bd9057e70fac578b`
- pinned source checkout: `.cache/die-t3code-v0042`
- expected and observed pinned HEAD: `719a76ca1dbf5490f1aa33ffb9966301e02be9a9` (pin719a)
- extracted archive directory key: `08cd5600ffdefefcd294d897954509ccc61be7b69fdf23e6e65edc6cb2ec4634`
- extracted `bootstrap.mjs` SHA-256: `154fc94a56be176ef6f4e6591f594a5834fd81bc2afe101442cc0b8d6364ebc2`

## Isolation and ownership

The harness is `scripts/leak-audit/bundled-web-runtime.mjs`.
Raw output is in `wisdom/resources/leak-audit-bundled-web-results.json`.

- Fresh `mkdtemp` directory supplied as `HOME`, all relevant `XDG_*` directories, `T3CODE_HOME`, cwd, and `--base-dir`.
- Loopback-only `127.0.0.1` and an OS-selected ephemeral port.
- Launcher identity was PID 2131490, start time 292158298. The exact direct backend child discovered through `/proc/<launcher>/task/<launcher>/children` was PID 2131526, start time 292158470.
  Command line validation required the extracted `bootstrap.mjs`.
- Sampling and shutdown used only those ancestry-discovered PIDs plus Linux process start times to reject PID reuse.
  There is no `pkill`, process-name matching, or interaction with a pre-existing server/session.
- The shipped launcher activates loopback no-auth mode (its output has no pairing token), so tickets were correctly requested without a bearer token.
  Ticket minting and the real Effect RPC subscription handshake were still exercised on every connection.
- Shutdown closed owned WebSockets, sent SIGTERM only to the exact launcher identity, and rechecked every exact owned identity.
  The launcher reported exit 130. No process needed the fallback kill and `allOwnedStopped` was true.
  Temporary state was removed.
- No provider/model operation or paid API was invoked.

## Measurements

All memory values are Linux `/proc/<exact-backend-pid>/smaps_rollup` KiB.
FD and thread counts are from `/proc/<pid>/fd` and `/proc/<pid>/task`.

| checkpoint | RSS KiB | PSS KiB | private dirty KiB | FDs | threads | descendants |
|---|---:|---:|---:|---:|---:|---:|
| baseline-after-10-warmup | 301204 | 279543 | 249048 | 25 | 21 | 0 |
| after-cycles-300 | 349216 | 327524 | 296740 | 22 | 21 | 0 |
| after-cycles-600 | 376248 | 354556 | 323772 | 22 | 21 | 0 |
| while-held-64 | 437136 | 415444 | 384660 | 86 | 21 | 0 |
| after-held-close-64 | 429532 | 407840 | 377056 | 22 | 21 | 0 |
| after-quiescence-5s | 294180 | 272487 | 241704 | 21 | 21 | 0 |

From warmed baseline to final quiescence: RSS -7,024 KiB, FDs -4, threads unchanged.
The temporary 64 held connections accounted for exactly +64 FDs relative to the immediately preceding 22-FD checkpoint. All were released.

## Limitations

- This is one short Linux run (600 reconnects, 64 held sockets), not a long soak, multi-platform test, or proof that no leak exists.
- RSS/PSS/private-dirty include allocator arenas, JIT/runtime pages, stacks, mappings, and other native memory.
  Without an inspector or allocator instrumentation they do not identify heap objects or allocation ownership.
- The 5-second quiescence result is encouraging, but longer-period timers, rarely used RPC paths, provider sessions, task execution, uploads, and non-loopback authenticated deployment mode were not exercised.
- The compiled `die web` path intentionally selected loopback no-auth mode, unlike the separate authenticated Node source-server audit.
  So this run covers the shipped launcher/Bun backend lifecycle and ticket/RPC behavior, but not OAuth token exchange.
- The ephemeral port is reserved and released immediately before spawn. As usual there is a small bind race, though this run bound successfully.

## Reproduce

`node scripts/leak-audit/bundled-web-runtime.mjs`

Optional bounds: `LEAK_CYCLES`, `LEAK_HELD`, `LEAK_OUTPUT`, and `LEAK_KEEP_STATE=1`.
