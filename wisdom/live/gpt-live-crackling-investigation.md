# GPT-Live crackling investigation (v0.14.0, 2026-09-26)

Report: “a ton of crackling when im speaking with gpt live 1”. Direction/location of the sound, whether it occurs during assistant-only speech, output route, and headphones comparison are not yet known. Do not claim this report is reproduced or fixed from offline tests.

## Contract and production audit

Read values.md, GPT-Live wire/current-primary-docs/implementation/playback/production-integration/VAD-review notes, macOS local audio and OpenAI playback-accounting notes. The older VAD review describes an obsolete mute-until-restart policy; current playback and source use automatic captured-quiet recovery.

Primary source rechecked 2026-09-26: https://developers.openai.com/api/docs/guides/voice-websockets?api=live (HTTP 200). It explicitly specifies mono signed 16-bit little-endian PCM, 24k default or 16k selectable, same immutable format for input/output. GPTLiveSession selects audio/pcm rate24000 and validates session.started. Native capture is PCM16LE mono16k, 640-byte/20ms frames; stateful InputResampler converts to24k. Output uses 24k mono PCM16, rejects odd lengths, and slices callbacks to9600 bytes. Realtime uses the same input resampler and output/native scheduler; Gemini forwards explicit16k input and validates24k output. No supported evidence of a rate/channel/endianness mismatch.

Extension capture always forwards GPT mic audio, even during output/local suppression. Local activity only flushes output, interrupts backend context work, and advances a local epoch. Four loud frames trigger once; fifteen quiet frames end speech plus ten further quiet frames reopen arriving output. This is an acoustic threshold, not speech classification/AEC. Echo can trigger it, and stale server tails can resume, but those are known hypotheses/limitations, not a measured device root cause. No tuning or half-duplex gate was added.

One integration discrepancy: native played(queueMs) feedback goes to the ordinary this.playback scheduler rather than gptPlayback.scheduler. GPT pacing therefore uses its own nominal wall-clock reserve without native feedback. Existing scheduler tests explicitly cover no-feedback operation. No proven crackle from this discrepancy, so no speculative production edit. Likewise UI transcript/render pressure could delay the event loop beyond the80ms reserve, but no user trace proves that. Concurrent task_3d13e60c owns transcript flood; this task deliberately does not edit extension.ts.

## Deterministic waveform fixtures

New tests/gpt-live-waveform.test.ts uses nonzero437Hz PCM rather than silence-only fixtures:

- One second at24k, amplitude10000, irregular even packets of2/478/962/1440/318/1920 bytes. Fake-clock pacing outputs exactly the original48000 bytes, with no reorder/loss/duplication, no flush/error, and native writes <=960 bytes/sample aligned. This checks JS scheduling bytes, NOT physical render timing.
- One hundred20ms nonzero capture frames cause exactly one flush, not per-frame flushes; suppression lasts until exactly25 captured quiet frames; resumed waveform is unchanged.
- One second16k capture in640-byte frames is resampled byte-for-byte identically to one continuous buffer, produces24000 samples including final held tail. Against ideal437Hz sine, all but final held sample have <40 PCM units error and <1150 adjacent-sample step (amplitude10000). No frame-boundary spikes in this fixture. Linear interpolation error is expected and not a new defect.

Reproduction: use installed Bun1.4.2 explicitly: /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun test tests/gpt-live-waveform.test.ts. The shell's mise hook reports untrusted worktree config; we did not trust/run that config, and used the already installed executable. Dependencies for broader tests reuse a local untracked node_modules symlink to /home/tnfssc/Code/die/node_modules; no install/release/push.

Validation so far: waveform3 pass/74 assertions; focused GPT session/playback + shared playback/audio lifecycle suite58 pass/20711 assertions before third waveform case added; Realtime session/schema/diagnostics and Live extension111 pass/640 assertions. Asset preparation then TypeScript noEmit passed. Initial noEmit caught a Buffer generic mismatch in new test plus absent generated assets; corrected test and prepared assets before passing. Final combined run:170 pass,0 fail,21355 assertions across10 files. git diff --check passed.

## Proven native defect and bounded fix

High confidence in a native packet-boundary interpolation defect, NOT in its attribution to the user report. AudioCore holds the last source sample when lookahead is absent. Previously, if a new packet arrived while that held sample was still being rendered, it did not retry the lookahead until after the tail finished. At fractional output phases this replaces the intended interpolated value with a held sample; at non-integer device rate ratios it can also reset phase late. Fix: retry pull while tail is held and retain the existing interpolation phase. No queue size, scheduling budget, mic gate, activity threshold, provider format or normal fully-buffered render path changes.

Native test-core now covers two48k boundary timings plus packetized/contiguous equivalence at24k/44.1k/48k/96k. It checks true starvation drains to zero, a flush between callbacks discards held old-epoch lookahead, and stale writes fail. These are sequential deterministic flush/callback interleavings, NOT exhaustive simultaneous producer/render-thread race proofs. Existing admission/overflow/capture tests remain intact. Compile/run passed with warnings-as-errors and ASan/UBSan:

    clang -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined native/live/AudioCore.c native/live/test-core.c -o /tmp/live-core-test && /tmp/live-core-test

Against original1f4e096, a two-sample packet boundary in a ramp fixture failed contiguous equivalence at44.1k: maximum normalized error0.305175781; fixed output was bit-identical at all four rates.24k already matched and is a preservation case.

Durable native/live/test-waveform.c reproduces a more audio-like case: one second437Hz PCM16 sine, amplitude10000, source24k/render48k,480-source-sample/20ms packets. First render consumes958 output frames, subsequent packets arrive before the held sample finishes, then960-output-frame callbacks. Fully buffered and packetized waveforms should match:

    clang -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined native/live/AudioCore.c native/live/test-waveform.c -lm -o /tmp/live-wave-test && /tmp/live-wave-test

Original1f4e096 renderer:49 mismatched output samples (one per packet seam), maximum error0.017425537 full-scale (about571 PCM16 units), RMS error0.000390131. Fixed renderer:0 mismatches and0 maximum/RMS error. To reproduce original, use git show 1f4e096:native/live/AudioCore.c > /tmp/live-core-before.c and compile that with -I native/live and the same test-waveform.c; it prints baseline metrics then intentionally fails errors==0. This is computed offline waveform evidence, not a listened-to or device-captured recording. The waveform probe is standalone; test-core regressions run through existing native CI commands.

The fix necessarily touches shared native rendering, but only the demonstrated missing-lookahead case. Gemini/Realtime wire/JS paths are unchanged. Native worker and independent reviewer both identified the narrow boundary defect; main investigator reproduced before/after and sanitizer tests. Reviewer task_33fb11c4 workspace: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_31e38b23-a86675007a5e-task_33fb11c4, branch die/review-native-packet-tail-fix-33fb11c4. Its requested multi-rate/starvation/flush-between-callback coverage was added; no claim of physical shared-provider acceptance.

## Limits and next diagnostic

No paid provider connection, key discovery, real mic/speaker recording, Swift AVAudioEngine execution, device acoustic measurement, or packaged-app acceptance here. Host is Linux. Normal OpenAI key was reportedly absent at parent's last check; no secret hunt or alternate credential use. No evidence justifies changing working Realtime/Gemini shared production paths.

First ask: is the crackle in assistant sound, and does it persist when the user is silent? Does headphones vs built-in speaker change it? On the affected route, compare /live speaker-check local synthetic playback with GPT-only listening, then overlap speaking. With explicit consent, bounded same-run provider PCM vs native-render timing/capture evidence would distinguish provider waveform corruption, underruns/UI stalls, threshold flushes, and acoustic feedback. Device-specific reproduction must precede claiming an acoustic fix.

## Durable work

Main: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_31e38b23.
Wire audit worker task_d6a876cf: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_31e38b23-a86675007a5e-task_d6a876cf, branch die/gpt-wire-audio-contract-audit-d6a876cf. Public primary docs/source review found no wire mismatch; no code commit, worker did not rerun Bun (parent ran suites).
Native worker task_8b783441: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_31e38b23-a86675007a5e-task_8b783441, branch die/native-playback-crackle-investigation-8b783441. Produced the minimal patch and two48k regression cases, but model response stalled. Parent requested cancellation after15 minutes; worker subsequently exited143. No worker commit/final evidence claim; parent copied the preserved patch, independently validated it, and completed the cross-rate tests.

Values review: unchanged. Existing whole-path proof, distinguish evidence from inference, minimal justified changes, shared-path safety, and durable handoff cover this investigation; adding a new global rule is not justified.
