# Bundled Bun for Go execute

Status: packaging/protocol recommendation, **not an implementation or compatibility proof**. Researched 2026-09-13. This follows [the rewrite constraints](../CONSTRAINTS.md): Go owns the application and durable work; Bun is only the isolated JavaScript/TypeScript runtime.

## Decision

Use a **pinned official Bun executable as a child process**. For each release target, put the compressed Bun release asset, one bundled internal runner JavaScript asset, hashes, and notices into the Go binary with go:embed. On first use, extract them atomically into a private versioned cache and execute the extracted Bun binary.

Do **not** plan on in-process Bun/Go integration. I found no documented, versioned Bun embedding ABI, C API, shared library, or supported Go package in Bun's primary docs/repository. That is an absence-of-evidence result, not proof that an internal integration is technically impossible. Bun's supported distribution surface is a single executable. Direct JavaScriptCore/Bun-internals binding would be an unsupported native port with much greater build, LGPL, crash-isolation, and upgrade risk.

Do not confuse Bun's “standalone executable” with in-process embedding. bun build --compile produces another native **executable containing Bun and bundled JavaScript**. Embedded in a Go artifact, it would still be extracted and run as a subprocess; it is not a Go-linkable library. Keep that as a fallback, not the first choice.

## Primary-source findings

| Finding | Evidence and limit |
|---|---|
| Bun's supported install unit is an executable. | Bun says it “ships as a single, dependency-free executable” and publishes platform binaries. This supports executable bundling, not an embedding ABI. [Installation](https://bun.sh/docs/installation) |
| No stable in-process library was found. | The docs/repository expose FFI APIs from JavaScript and application embedding in compiled executables, but no public ABI for a Go host. This is deliberately not a universal impossibility claim. [Repository](https://github.com/oven-sh/bun), [FFI](https://bun.sh/docs/runtime/ffi) |
| Compile supports cross-target executables. | Documented targets are Linux x64/arm64 glibc and musl, Windows x64/arm64, and macOS x64/arm64. x64 requires SSE4.2. This describes Bun-compiled apps, not Go cross-compilation or one universal file. [Cross-compile](https://bun.sh/docs/bundler/executables#cross-compile-to-other-platforms) |
| Compile embeds known code/assets. | Bun documents bundled code plus explicit file/directory assets. Packages in the user's working directory remain runtime inputs, not runner build assets. [Embed assets](https://bun.sh/docs/bundler/executables#embed-assets-files) |
| Resolution behavior is runtime-specific. | TS, ESM, CJS, package exports/imports, conditions, and extension fallbacks need black-box coverage; moving the runner can change its resolution base. [Module resolution](https://bun.sh/docs/runtime/module-resolution), [TypeScript](https://bun.sh/docs/runtime/typescript) |
| Bun's special IPC is not a Go protocol. | Bun documents direct Bun-to-Bun IPC and requires JSON mode even for Node interoperability because engine formats differ. There is no documented Go endpoint. [IPC](https://bun.sh/docs/runtime/child-process#inter-process-communication-ipc) |
| Licensing is not “MIT only.” | Bun says its own code is MIT, but the binary statically links LGPL-2 JavaScriptCore/WebKit and LGPL-2.1 TinyCC, among other components. Its license calls out an LGPL static-relinking requirement. [LICENSE.md](https://github.com/oven-sh/bun/blob/main/LICENSE.md) |

Saved Tavily CLI source results are under [sources/bun-*](sources/). Exact upstream pages above are authoritative; search snippets are not.

## Current behavior to preserve

The current implementation already uses a subprocess, recursively starting the compiled Bun app with --die-internal-execute ([execution.ts:81-97](../../src/typescript/execution.ts), [runner.ts:10,124](../../src/typescript/runner.ts)). It has:

- source on stdin, stdout/stderr capture, and a bounded image channel on fd 3;
- bounded newline-delimited JSON job frames and request IDs;
- process-group TERM then KILL on timeout/cancellation ([execution.ts:108-130](../../src/typescript/execution.ts));
- ACK committed only after clean worker exit, so bridge loss restores durable notification ownership ([job-bridge.ts:488-501](../../src/typescript/job-bridge.ts));
- durable job creation in the parent manager followed by a cancellable foreground wait ([job-service.ts:133-151](../../src/tasks/job-service.ts)); and
- cleanup/ownership transfer on partial batch launch failure ([job-service.ts:169-237](../../src/tasks/job-service.ts)).

The Go design should preserve these semantics, not Node/Bun's IPC mechanism.

## Packaging

### One artifact, two runtime processes

Build **one Go artifact per OS/architecture/libc target**. “Single artifact” means one downloaded godie file for that target. At runtime it materializes and starts a second executable. It does not mean one process or a universal cross-platform binary.

For the first proof, support Linux x86-64 glibc only. Pin an exact Bun tag/revision, official release ZIP and SHA-256, runner protocol/hash, and version-matched license snapshot. The project currently requires Bun >=1.4.1, but the POC must choose one exact version.

Embed the official compressed ZIP, not raw bun: this reduces release size and preserves a verifiable upstream boundary. As a reference only, GitHub's v1.4.1 release API reports bun-linux-x64.zip at 36,659,492 bytes; the installed executable measured about 80 MB. Re-measure the selected release in CI. [v1.4.1 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.1)

### Runner asset and resolution

Bundle the internal runner and private dependencies to **one non-compiled JavaScript file** targeted at Bun and embed it in Go. Invoke the cached Bun with the cached runner's absolute path and the user's directory as cwd.

This is simpler than a custom compiled runner: runtime bytes remain an unmodified upstream artifact; runner edits do not create a custom native binary; only internal dependencies are bundled; and provenance/upgrades are easier to audit.

Do not assume bundling preserves resolution. The current runner explicitly anchors require and rewritten imports to the user's real cwd, handles package exports/imports, and has a compiled-CommonJS-loader workaround. Let compatibility tests decide whether that compiled-only workaround can be removed. Never resolve user bare imports from the runtime cache. Disable Bun auto-install/network fetching unless explicitly designed as a feature. Bun documents that its default auto mode downloads packages when no node_modules is found, while install.auto="disable" prevents this; the POC must force this without accidentally replacing project resolution configuration. [Auto-install](https://bun.sh/docs/runtime/auto-install), [bunfig install.auto](https://bun.sh/docs/runtime/bunfig#installauto)

### Versioned extraction

Suggested key: XDG_CACHE_HOME/godie/runtimes/bun/BUN_VERSION/GOOS-GOARCH-LIBC/RUNNER_HASH/.

Extraction must:

1. use a private directory (0700) and reject unsafe ownership/permissions;
2. serialize contenders with a lock/create-once protocol;
3. validate ZIP paths/contents, cap decompressed size, and write random temporary files in the destination directory;
4. verify the ZIP against pinned upstream SHA-256 and final files against build-recorded hashes;
5. chmod Bun 0700, fsync files, atomically rename, then fsync the directory;
6. verify existing entries before execution and never execute temp/partial files; and
7. explain noexec failures and support an explicit runtime-directory override.

Extract once per version, not once per call. Old-version cleanup is best effort and must not remove the active version. Never silently use system Bun, which breaks reproducibility.

## Protocol and ownership

Use an inherited full-duplex byte stream (Unix socketpair for the Linux POC), not Bun-specific IPC. Reserve stdin for source, stdout/stderr for output, fd 3 for images, and a separate fd for control. Pass its number and a random nonce in the environment; close unrelated inherited descriptors.

Use UTF-8 NDJSON, a hard 1 MiB frame cap, and a first-frame protocol/version handshake. Minimal shapes are:

- request: {v:1, id:1, method:"shell", params:{...}}
- response: {v:1, id:1, result:...} or one bounded structured error
- acknowledgement: {v:1, ack:1}

Reject malformed UTF-8/JSON, non-monotonic or duplicate IDs, unknown methods/ACKs, oversized frames, ambiguous response fields, and version mismatch. Bound pending calls. Restrict payloads to interoperable JSON: reject cycles, BigInt, non-finite numbers, and oversized results predictably.

### Durable job and cancellation rule

**Go creates, stores, supervises, and reaps every shell/subagent job. Bun only issues RPCs and waits.** Jobs are direct Go children in their own process groups (or stronger containment), never descendants of Bun's kill domain.

Cancellation has distinct meanings:

- execute timeout/abort: TERM then KILL only the Bun runner group and cancel RPC waits;
- jobs.stop(id): explicitly terminate that durable job's own group.

Bridge disconnect or a cancelled foreground wait must not imply jobs.stop. Once created, a Go job record survives runner death. If ID/result delivery is uncertain, Go keeps completion-notification ownership.

Retain the current two-phase rule: response ACK is provisional; commit delivery only when the runner exits successfully, including the defined clean-handoff path. Crash, kill, protocol failure, or failure after ACK restores Go notification ownership. Handler errors and fallback/oversize responses never transfer it. This small amount of protocol directly protects durable jobs.

## Proof-of-concept acceptance gates

### G1 — provenance, license, size (blocking)

- CI fetches one exact official asset, verifies published SHA-256, and records tag, revision, URL, size, and hash.
- Produce one Linux x64 glibc artifact and report release-size delta, extracted disk, and cold/warm execute latency.
- A discoverable embedded license command reproduces Bun's version-matched LICENSE.md and all required texts/notices.
- **Legal review resolves LGPL redistribution/relinking obligations.** It is plausible the Go file plus embedded separately executed Bun is an aggregate and does not require relinkable Go objects, but that is an unverified legal assumption. Determine what corresponding source/object files or written offer must accompany Bun.

### G2 — extraction and offline reproducibility (blocking)

- 50 concurrent first runs yield one valid cache entry and never execute a partial file.
- Cover corrupt embedded/cache bytes, symlink/path attacks, interruption, read-only/low-space/noexec cache, and hash mismatch.
- The runtime reports the pinned version/revision; modified cache bytes are rejected.
- A host with no system Bun and no network runs execute from only the Go artifact.

### G3 — execute compatibility (blocking)

Black-box test TS/top-level await, dynamic import, CJS require, ESM, JSON, built-ins, relative files and symlinks; package exports and bun/import/require conditions; package imports (#name), scoped packages, and mixed cycles; spaces/non-ASCII paths and errors; image/output/diagnostics behavior; and absence of accidental cache resolution or network auto-install. Compare the supported contract with the current runner, not only exit status.

### G4 — cancellation and durable jobs (blocking)

- timeout, abort, and shutdown reap runner descendants after TERM/KILL grace;
- a handed-off Go shell/subagent continues after runner kill, remains inspectable, and stops only explicitly;
- cancellation racing launch cannot create an untracked process; partial batches retain/clean every ID;
- disconnect before response, after response, after ACK, and before clean exit produces exactly one completion owner;
- malformed/oversized/mid-write frames neither deadlock Go nor kill durable jobs; and
- repeated runs pass race/leak checks for goroutines, fds, zombies, sockets, and process groups.

### G5 — each added target (blocking per target)

Pin the matching Bun artifact and rerun all gates. Go cross-build alone is insufficient. glibc/musl are separate; x64 requires SSE4.2. macOS signing/quarantine and Windows job objects/handle inheritance need separate designs and are not validated by Linux.

## Explicitly unverified assumptions

- No stable embedding API exists: supported by public surfaces found, not an upstream promise.
- One bundled runner JS preserves semantics: G3 must prove it.
- An inherited Unix socketpair behaves correctly across the full lifecycle: G4 must prove it.
- Auto-install can be disabled while local package resolution remains compatible: test the pinned version.
- Go artifact plus separately executed Bun is legally an aggregate: counsel must confirm; Bun redistribution duties still apply.
- Published checksums alone authenticate a release: CI must define signing-key/checksum trust.

## Bottom line

The simplest credible design is **Go core + embedded official Bun ZIP + one embedded runner JS + ordinary framed socket RPC**. It gives one distributable file per target but remains a multi-process system with extracted files. Keep durable work in Go, preserve ACK-on-clean-exit ownership, and make license, resolution parity, extraction integrity, and cancellation isolation release gates.
