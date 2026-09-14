# Bundled distribution acceptance report

Date: 2026-09-13 UTC  
Scope: independent acceptance only; no app/runtime source was modified.

## Decision

**Not accepted for bundled release.** The isolated binary works offline for ordinary execute use, but first-start concurrency, crash recovery, and cache-path safety have concrete release-blocking failures.

Candidate: `artifacts/distribution-godie-source-build`  
SHA-256: `2ae5cd1dc1ba5a889b5462ac3b756946e3d6b26c4716b759fd32c10f7bfb76de`  
Size: 48,591,140 bytes  
Source HEAD reported by Go: `14981b44d68988261dbe056227c952671963c838`, `vcs.modified=true`

The executable was copied to a space-containing directory outside the repository for every probe. Candidate invocations used `PATH=/nonexistent`, `--offline`, loopback-refusing proxy variables, an isolated HOME/state/CWD, and no credentials or provider calls. Cleanup targets only children launched with `start_new_session=True`; before signaling, the harness verifies that child PID equals process-group ID.

Final harness result: **5 PASS / 6 FAIL / 0 SKIP**. Machine-readable evidence is in `artifacts/distribution-results.json`.

## Release blockers

1. **50-way first startup can silently lose execute output.** On the final run task 21 returned status 0 with `{"output":"","exitCode":0}` instead of `startup-21-1.4.1`. The same symptom occurred on prior runs at tasks 18, 27, and 35; one earlier run passed. The extracted cache itself had the expected hash and no lock/temp residue. This is reproducible concurrency failure, not merely latency.
2. **SIGKILL interruption leaves an unrecoverable extraction lock.** The harness observed the real `.extract.lock`, sent SIGKILL only to that owned process group, then retried. Retry waited about 5.1 s and failed with `runtime extraction lock: ... file exists`. A separately precreated stale lock fails identically. There is no stale-owner recovery.
3. **An exact-byte runner symlink is trusted.** Replacing cache `runner.js` with a symlink to a harness-owned file containing the expected bytes leaves the symlink in place and executes successfully. Cache code identity is therefore not anchored to a regular file in the private runtime directory.
4. **A parent cache symlink is followed.** With only `STATE/runtimes` symlinked into another harness-owned directory, startup writes Bun and assets through that link and succeeds. No unowned path was targeted by this test.
5. **Current binary provenance is development provenance.** `go version -m` records module `(devel)` and `vcs.modified=true`. The supplied source manifest pins the tested bytes, but a release artifact should have a clean/reproducible source identity rather than relying only on this mutable-worktree marker.
6. **Corrupt-embedded-payload runtime behavior was not directly exercised.** The build reconstruction rejects a wrong source hash and proves deterministic gzip equality, and corrupt extracted cache was tested, but the ELF's embedded gzip was not surgically corrupted. G2 evidence remains incomplete until a controlled malformed-payload fixture exists.

## Passing evidence

- Isolated copied executable ran without host PATH/network: TypeScript annotation, top-level await/dynamic import, Node `fs/promises`, `Bun.write`, non-ASCII/space CWD, and PNG `showImage` all succeeded.
- Runtime reported Bun `1.4.1`; extracted Bun SHA-256 was `69293d3be4f0d6d624ca8581af4574435fa39209ab67e89eb03912866f3e14cb`, mode `0700`.
- Corrupt/non-executable cached Bun bytes were replaced and reverified before execution.
- A damaged cache made read-only failed closed and did not run the marker code.
- `--licenses` worked with `PATH=/nonexistent`; output included Bun 1.4.1, Photon 0.3.4, and LGPL text. The generated “modules without a root notice” section was empty.
- The payload recreation path accepted only the documented Bun hash and produced gzip SHA-256 `b847b1df184228a6d90b7625089bc5e2a10b0c052bf754788cbc1c1bc4d4c44c`, equal to the checked-in payload.

## Non-blocking/local-development findings and bounded gaps

- Exact-byte `runner.js` at mode `0644` remains `0644` rather than being normalized to intended `0600`. Because normal parent directories are `0700`, this is hardening/mode-invariant debt rather than a separate local-development stop; the symlink findings above remain release blockers.
- Low-space and noexec-mount behavior were not run: safely creating those mount/storage conditions was outside this unprivileged owned-cache probe. Read-only failure was covered.
- No network namespace was required or assumed. The tested contract used `--offline`, no provider/package request, no credentials, and no downloads.
- Only Linux amd64/glibc was assessed. The Bun input is named “Linux x64”; available local evidence does **not** establish whether it is Bun's baseline-CPU build. CPU baseline is **unknown**.

## Notices/provenance assessment

`internal/notices/THIRD_PARTY_LICENSES.txt` is discoverable and contains the locally available Bun, Photon, Go, project, Pi, and used-module texts. Its Bun section factually says Bun statically links LGPL components and points to upstream source/relink instructions; this artifact set does not include a corresponding-source/object bundle. This report does not give legal approval. That redistribution packaging question is not a blocker to local development, but must be resolved for the intended release terms.

Build metadata, complete dependency records, source-file hashes, and CPU-baseline status are in:

- `artifacts/distribution-provenance.json`
- `artifacts/distribution-source-manifest.sha256`
- `artifacts/distribution-inputs.md`

## Reproduce

From `godie/`, with dependencies already in the local Go module cache:

```sh
# Offline source build; does not overwrite bin/
./artifacts/distribution-build.sh
sha256sum artifacts/distribution-godie-source-build

# Also reconstruct and byte-compare the embedded gzip from an already-obtained
# exact Bun input (no download):
./artifacts/distribution-build.sh /path/to/bun-1.4.1-linux-x64

# Acceptance intentionally exits nonzero while blockers remain:
python3 validation/distribution-acceptance.py \
  --binary artifacts/distribution-godie-source-build \
  --concurrency 50
```

The build script uses `GOTOOLCHAIN=local GOPROXY=off`. It never installs/downloads Bun and writes only `artifacts/distribution-*`.
