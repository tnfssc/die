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

Source Bun 1.4.2 bare ws import resolves to Bun's built-in BunWebSocket shim (import.meta.resolve returns ws), not the installed package. Fake-key localhost 401 through unmodified upgradeSocket source returned numeric status 401. Published ws 8.21.3 exports browser.js for browser, wrapper.mjs for import, index.js for require. A transport worker also verified source and minified small compiled success plus HTTP 403/model_not_found. Its constructor accepts headers. handshakeTimeout/followRedirects appear ignored by the shim, but no evidence ties either to this user failure; the session has its own timeout. Full CLI evidence is pending, not inferred from these smaller successes.

Work retained:
- Parent: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5010a15e, branch die/trace-compiled-realtime-failure-5010a15e.
- Transport worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5010a15e-a86675007a5e-task_4e43a0e9, branch die/default-transport-reproduction-and-fix-4e43a0e9; commit d9cc30d, integrated as 19882ae.
- Full CLI worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5010a15e-a86675007a5e-task_7bda6eac, branch die/full-cli-default-transport-probe-7bda6eac.

Values reviewed; unchanged: existing rules require whole-product proof and honest limits. Do not call the UI correction proof of the user's remote connection root cause.
