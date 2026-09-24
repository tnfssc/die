# Real-provider synthetic speech validation — 2026-09-24

Candidate: 00ab6f972283d4cc9596783349ec9f322cb337cc. Google SDK 2.24.0,
model gemini-3.8-live. User explicitly authorized paid provider tests.

## Result

**Manual activity speech passed the captured-dispatch boundary.** One real
Google input transcription caused one real provider agent_send call through
VoiceSession + createOrchestration to an inert capture-only host. No real job
or coding agent was launched. This is not installed CLI/Run/host-bridge proof.
The probe mirrors Run's input capture callbacks; it never calls those callbacks
itself or seeds orchestration authority from the synthetic phrase.

Manual event order (milliseconds since probe start):
- 1942: client activityStart, with automatic detection disabled.
- 8416: activityEnd after paced 20ms PCM16 mono 16kHz frames.
- 8669: provider inputTranscription, envelope 3, raw finished absent.
- 8670: Session finished=true, finalitySource=model_contract, rawFinished absent;
  capture committed from this provider event.
- 9094: provider agent_send, envelope 7, args contain requestId only.
- 9096: fake host send receives the captured ASR string; successful capture-only
  tool response goes to Google (WHEN_IDLE).
- 9099: first model turnComplete, envelope 9; second at 14218.
- 30851: session closed. One host call, no error, zero interruptions.

Host payload exactly matched provider input:
> Please ask the coding agent to inspect the README and report its first heading without changing any files.

Thus absent wire finished no longer blocks this supported-model request, and
model-authored/paraphrased tool text cannot replace capture (tool supplied none).
This observed transcript-before-tool order does not validate cross-message
call-before-transcript handling or multi-sentence grouping. It is ASR provenance,
not proof of perfect recognition or user authentication.

**Automatic-VAD control remained inconclusive/unsuccessful:** same synthetic
speech, production automatic detection enabled, paced frames and audioStreamEnd;
ready at 1399ms, stream end at 8222ms, close at 30747ms. No input transcript,
no tool call, no host dispatch, no model turnComplete or provider error observed.
Do not claim automatic mode, physical microphone/speaker, or acoustic success
from the manual test. Automatic synthetic detection remains an independent
unresolved issue; no production VAD change is justified by this probe alone.

## Reproduce / evidence

- [Probe](grounded-spoken-provider-probe.ts)
- [Manual selected event trace](grounded-spoken-provider-manual.jsonl)
- [Automatic selected event trace](grounded-spoken-provider-automatic.jsonl)

From repository root with existing dependencies and configured Google API-key auth:

    bun wisdom/live/grounded-spoken-provider-probe.ts --paid manual
    bun wisdom/live/grounded-spoken-provider-probe.ts --paid automatic

Each invocation performs one paid session bounded to 30 seconds from connect.
Requires macOS say and afconvert; synthesis writes files, never speakers. Uses
100ms leading and 300ms trailing silence; 181610 speech PCM bytes in this run.
Output audio is discarded. Temporary audio is removed in finally, confirmed in
both traces. Selected logs contain only the synthetic request, provider tool IDs,
finality/order metadata and fake-host results, not audio/auth/config dumps.
Credential module was read first; createDefaultLiveCredentialService().loadKey()
uses canonical configured auth, with no legacy-file import or key printing.

No production edits, installs, microphone/speaker access, real jobs, text-seeded
transcripts or tool-declaration-only test. Two paid sessions used; a preliminary
launch failed before connecting because this fresh worktree lacked node_modules.
Reused main checkout's existing dependencies via a temporary symlink (removed afterward); no install.
Probe-specific strict TypeScript check passed (--ignoreConfig --noEmit --target
ES2022 --module Preserve --moduleResolution Bundler --strict --skipLibCheck
--types bun). Parent owns full tests/build independently.

Candidate file SHA256:
- session.ts: 1f3f8d8e5be29fc757c6d77b2975f253352f3572b85b5d056af78934ca69762f
- orchestration.ts: e99447d28a1395544c9de8ffa80cf4034f13045ab63951f46e75432e3da663c5
- extension.ts: 825e0a1ba6cf97f45365b5e7f61e25bafaba83034695b518f8bb5d7d86e4816a

Next evidence needed: physical automatic-mode input and actual installed-host
handoff, separately from this capture-only test. No third paid session needed
for the requested manual regression. Values unchanged: bounded tests, real-path
provenance and truthful limits already cover this lesson.
