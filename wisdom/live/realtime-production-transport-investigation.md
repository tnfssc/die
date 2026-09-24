# Realtime production transport investigation (2026-09-24)

Read [values](../values.md). User confirmed a fresh v0.10.2 process and a working GPT-Live key. Neither stale executable nor invalid key is assumed. No authenticated provider call or audio device use is permitted. No release before parent review.

## Verified UI defect and path inventory

The Realtime adapter produces safe diagnostic messages, but src/live/extension.ts discarded every message at its callback: this.fail("Provider " + e.code). Thus ALL connect failures, including known HTTP 401/403/429 and local construction failures, displayed identical Provider connect_failed. Previous adapter-only diagnostic tests did not cover that terminal boundary. The extension now keeps Realtime's locally classified message (not arbitrary exception text); Gemini remains code-only. Constructor and rejected connect errors caught outside the adapter use constant stage labels and withhold their text.

Every current connect_failed producer was inspected:
- Realtime: 15-second connect timer; incoming provider error while connecting; socket error while connecting; close before session setup; outer factory/listener-registration catch. The last now distinguishes socket-construction and socket-listeners rather than calling a constructor error a network failure. Session.update send failures and invalid JSON use transport_error, not connect_failed.
- Gemini: connect timer; synchronous SDK factory/connect catch; rejected async connect catch. These are not the Realtime path and remain unchanged.
- Extension: no literal connect_failed producer; it previously discarded the adapter message. Its separate outer startup catch handles provider construction or rejected connect and never includes raw text. Constant labels distinguish provider-construction, provider-connect and audio-start. Audio helper launch still uses audioLaunchDiagnostic.
- Realtime class and upgrade transport are statically imported here. There is no Realtime lazy import before handshake. Static module load failure would prevent loading the extension rather than reach its callback. The CLI dynamically imports the extension after Pi setup; that startup failure is not a Realtime connect_failed producer.

## Evidence

Source Bun 1.4.2 bare ws import resolves to Bun's built-in BunWebSocket shim (import.meta.resolve returns ws), not the installed package. Fake-key localhost 401 through unmodified upgradeSocket source returned numeric status 401. Published ws 8.21.3 exports browser.js for browser, wrapper.mjs for import, index.js for require. A transport worker also verified source and minified small compiled success plus HTTP 403/model_not_found. Its constructor accepts headers. handshakeTimeout/followRedirects appear ignored by the shim, but no evidence ties either to this user failure; the session has its own timeout. Linux source CLI and full compiled CLI both passed full/mini session.updated and HTTP 401 classification. The compiled artifact was built with scripts/build.ts --reuse-web (real previously built web runtime, archive SHA256 681d39fae172b858b55ac2f80a68f8431f48d0e39aff6104f6878f10af7cfec3), not a miniature transport bundle. The probe directly exercises defaultSocket with a fixed loopback endpoint and fake key; the source unit regression separately exercises the full session by rewriting only the endpoint, keeping the production socket. No injected sockets are used in either. The full compiled probe does not run the extension/audio lifecycle. Localhost ws does not establish remote TLS/network/provider behavior.

Explicit CJS index.js and ESM wrapper.mjs package imports resolve to the same package WebSocket class, distinct from Bun's bare ws shim. Both bare import.meta.resolve and require.resolve return ws. Explicit browser.js construction throws its documented browser-only error; the default production probe does not hit that module. scripts/build.ts compiles src/cli.ts using Bun.build({compile, minify:true}), not a browser-target build. No transport constructor/export/options failure was reproduced. Do not replace the working transport speculatively.

Integrated local validation: 93 focused session/extension tests pass, TypeScript check passes, targeted formatting passes, lint exits zero (existing warnings remain). The new terminal integration uses real localhost 401/default transport for both models and proves HTTP 401 is displayed without fake key/body; startup construction/connect and adapter constructor/listener failures have safe-stage regression coverage.

Focused macOS full CLI/source probe dispatched on branch commit 5bc5a1c: https://github.com/tnfssc/die/actions/runs/36006968095 **passed**, macos-15 job 107657509138 in 6m25s. It built the full CLI through bun run build/scripts/build.ts, then passed both source and full compiled default transport probes for full/mini session.updated and HTTP 401. Native helper/device job was skipped. No release or merge is part of this branch.

Work retained:
- Parent: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5010a15e, branch die/trace-compiled-realtime-failure-5010a15e.
- Transport worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5010a15e-a86675007a5e-task_4e43a0e9, branch die/default-transport-reproduction-and-fix-4e43a0e9; commit d9cc30d, integrated as 19882ae.
- Full CLI worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5010a15e-a86675007a5e-task_7bda6eac, branch die/full-cli-default-transport-probe-7bda6eac.

Values reviewed; unchanged: existing rules require whole-product proof and honest limits. Do not call the UI correction proof of the user's remote connection root cause.
