# Live redesign research

## Why restart

User tried v0.7.1 on macOS and says live experience is very poor. Suspects wrong/old model and questions SoX maintenance. Requests current technologies and actual open-source official/reference app research, then reconsider all decisions and remake properly. Do not patch/release more before evidence and design discussion. Keep priority: naturally responsive live talk alongside configured die agent work, CLI inline status, local macOS first. No need preserve flawed internals.

## Known vs unknown

Tag v0.7.1 src/live/transport.ts explicitly sets LIVE_MODEL=gemini-3.8-live. This verifies requested model in source, not what user saw/runtime identity. Coding-agent model vs Live UI confusion is a hypothesis. No physical Mac audio quality test yet; earlier provider tests proved limited wire behavior, not a good conversation. Lack of acoustic processing and channel/context design need fresh review. Do not assume SoX age alone diagnoses poor UX.

## Active read-only research

- task_051143cf: current Google model/protocol/SDK and actual official sample source.
- task_edd8bc18: maintained audio stacks/reference projects; real local AEC/device/packaging tradeoffs.
- task_de24a3a6: current implementation and loop/UX/test gaps.

All use current workspace read-only; no independent code worktrees yet. Use tvly and original source links, exact repo files/commits/dates; distinguish claims from verified facts. No real key reads, paid API, mic or speakers. Parent synthesizes recommendations and measurable acceptance before implementation. Values review pending after synthesis; existing truthful proof/real-user-path guidance already applies.

## Parent verification and disputed finding

Confirmed tag requests gemini-3.8-live. Model label confusion remains a hypothesis, not runtime proof. Research found current official repo google-gemini/gemini-live-api-examples at 3bcae1162d1bc6955672153310e4f84eba6621ff (2026-09-15): native CLI sample plus browser AudioWorklet examples. Python CLI explicitly recommends headphones; PortAudio alone does not solve echo. LiveKit console demonstrates feeding actual rendered output into its audio-processing module. A direct replacement capture library alone would retain the key acoustic gap.

One research report called existing sibling scheduling/willContinue invalid based on guide examples. Parent checked official googleapis/js-genai src/types.ts at d4bcdad45f105a7b4c035872406c04e2d42d63d4: FunctionResponse explicitly includes scheduling and willContinue, describing generator-style responses. Therefore do NOT report protocol invalidity as proven. Sample/guide shape conflicts need SDK/wire reconciliation. Existing overlong tool-response observation channel can still be poor design independent of schema validity.

Sources:
- https://github.com/google-gemini/gemini-live-api-examples/tree/3bcae1162d1bc6955672153310e4f84eba6621ff
- https://github.com/googleapis/js-genai/blob/d4bcdad45f105a7b4c035872406c04e2d42d63d4/src/types.ts
- https://ai.google.dev/gemini-api/docs/live-tools

Proposed direction (not yet user-approved): preserve full-duplex live talk, not push-to-talk as default; official SDK; native macOS voice-processing audio helper prototype; device/permission/echo/interruption acceptance before full integration; visible voice vs work model, transcript, state and latency metrics; task-scoped bridge with clear context/results rather than permanent function-response event bus. No automatic switch to a browser product, hosted framework or new reasoning model.

## Combined findings and next design

All three reviews completed. No runtime code changed. tvly daily unauthenticated cap was reached; researchers continued with original official docs and repository source. Do not claim all evidence came through tvly.

Verified implementation gaps:
- Footer shows coding-agent model but not voice model. Add distinct labels; no model swap needed to meet requested gemini-3.8-live.
- SoX capture/render have no shared echo-processing reference. Default device streams, arbitrary stdout chunks, no measured device/capture/playback latency. Interrupt waits for server then kills/restarts player.
- Input transcript is requested but extension does not consume it. Output transcript not requested. Status mixes mic and speaker amplitude and lacks conversation states.
- Live starts with no bounded project/session context snapshot. Only gets selected session events after first handoff.
- Work updates depend on a lingering tool-call channel. Provider cancellation drops reporting but work continues. Separate real work state from provider call lifetime.
- Fake tests prove packet flow, not meaningful conversation during slow coding work. Prior real acceptance used synthetic speech then text to trigger handoff; not a full voice/agent test.

Do not overstate suspected causes: echo/self-interruption, latency and misheard speech were not measured on user's Mac. User symptoms beyond “awful” still needed. A 96 KB queue limit is a capacity, not proof that all playback always has two seconds of delay.

Proposed remake, not yet approved implementation:
1. Keep full-duplex gemini-3.8-live and configured die agent. No default push-to-talk downgrade.
2. Use official @google/genai, pin/test SDK and Gemini Developer API wire behavior. Raw websocket is valid but own schema maintenance adds care. SDK does not itself fix acoustic or UX issues.
3. Prototype bundled macOS helper using VoiceProcessingIO or supported AVAudioEngine voice processing. Fixed short frames, bounded render ring, immediate flush without process restart, device/error events. Verify actual AEC and packaged mic permissions on Mac before claiming readiness. No blanket promises about Bluetooth or arbitrary device pairs.
4. Use provider VAD first; compare local speech detection on echo-processed audio for faster interruption/end-of-turn only after measuring. Do not gate mic while model talks.
5. Keep a small session work registry independent of function-call IDs. Short task-scoped handoff/status calls, correlated outcomes, bounded context snapshot, confirmed results. Choose tested mechanism for idle-time result injection; cannot simply assume clientContent does not interrupt active speech. Do not introduce persistent scheduler or full LiveKit/Pipecat runtime without need.
6. CLI line shows voice model and real listening/speaking/reconnecting state; offer visible input/output transcript without dumping private tool logs.
7. Establish clean voice-only baseline first, then add real slow agent work, interruption, second request and results. Compare measured distributions for response onset, local playback cut-off, queued audio ms and false interruptions on actual Mac routes. Synthetic/offline checks continue but do not stand in for experience acceptance.

Reference sources:
- Google CLI and browser examples: https://github.com/google-gemini/gemini-live-api-examples (inspected 3bcae1162d1bc6955672153310e4f84eba6621ff, 2026-09-15). Python command-line sample uses PyAudio, concurrent loops, headphones warning. Browser sample requests echoCancellation/noiseSuppression/autoGainControl and AudioWorklet framing. Examples are references, not production-quality proof.
- LiveKit console audio processing: https://github.com/livekit/agents/blob/main/livekit-agents/livekit/agents/cli/_legacy.py (render-reference processing pattern; inspect current console too before copying).
- Pipecat: https://github.com/pipecat-ai/pipecat (local transport/interruption references; no proposal to adopt full Python framework).
- Apple VoiceProcessingIO: https://developer.apple.com/documentation/audiotoolbox/kaudiounitsubtype_voiceprocessingio
- SDK FunctionResponse source pinned above is authoritative evidence against unsupported-generator claim; schema conflict remains a verification task, not a confirmed bug.

Values: strengthened existing “Finish what user needs” with user-platform/device interaction evidence. This repeated across Linux-only assumptions, protocol-only acceptance, and macOS device-free CI. Applies when physical interaction is central; does not require costly hardware tests for unrelated small edits. No new value added.

## Approved phase one underway

User approved proposed rebuild. task_9c806e5d leads voice-only macOS candidate before coding bridge. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_9c806e5d; branch die/rebuild-live-macos-voice-first-prototype-9c806e5d; base 53fb9a8. Official SDK + native Apple voice processing, full-duplex, inline status/transcripts and metadata diagnostics. Keep isolated from shipped Live; no version bump/release. No physical mic/paid test without explicit start; no real key reads in model/logs. Need early packaging/Mac feasibility checkpoint, native CI validation and real-user baseline acceptance before phase two bridge. Parent reviews/integrates.

## Worker restart

Stopped task_9c806e5d after failed delegation syntax and no code changes (worktree clean). Parent now integrates three focused workers: task_53edad03 native helper at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_53edad03 branch die/native-macos-voice-processing-helper-53edad03; task_f5f78fb2 SDK at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_f5f78fb2 branch die/official-gemini-sdk-voice-only-session-l-f5f78fb2. Third controller/CI task path recorded in next entry. Shared helper protocol newline JSON v1, hello before start, explicit start, capture16k/play24k PCM16, generation-based flush, ready/played/stopped/error. CLI integration waits for these interfaces.

Controller/CI worker task_4cc51088: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4cc51088, branch die/native-audio-helper-controller-and-mac-c-4cc51088. Owns src/live-lab/audio.ts fake-process tests and optional focused Mac workflow. Parent owns final interface alignment and CLI wiring.

Controller first commit 5867171 and SDK first commit 052374b ready but NOT integrated. Parent found concrete interruption/lifecycle gaps and assigned hardening before wiring: task_df78d881 /home/tnfssc/.die/worktrees/die-a86675007a5e-task_df78d881 branch die/harden-native-helper-controller-before-i-df78d881 (base controller), task_4e7e739f /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4e7e739f branch die/harden-sdk-session-lifecycle-and-audio-g-4e7e739f (base SDK). Fixes needed: runtime helper failure visibility and cleanup, flush must not queue behind stale audio, startup cancellation; SDK interrupted packet audio must not refill flushed queue, normal turn completion distinct from cancellation generation, setup-ready and timeout semantics, transcript bounds/metadata. Await native helper and these fixes before CLI composition.
## SDK voice-only session verification (integration prototype)

Pinned @google/genai 2.24.0 dist/index.mjs Live.connect waits for websocket open, sends setup, then awaits setupComplete before resolving; queued callbacks are delivered immediately before promise return. Socket-open alone is not readiness. A local 15-second timeout and cancellation race is needed because SDK connect can remain pending when setup never arrives; pending SDK connect is not abortable, so late resolved connections must be closed. Explicit realtimeInputConfig.automaticActivityDetection.disabled=false uses supported SDK schema (default is also enabled). Transcription.finished is supported in SDK Transcription and should be preserved even when text is empty. Playback cancellation epoch must move only on interruption, not turnComplete: turnComplete does not mean queued audio should be flushed. These are source/code findings and synthetic test coverage, not real-key/audio-device acceptance.

## Linux requirement and integration

User explicitly requires Linux build so real tests can run here. Added task_14adfd8d Linux native APM helper at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_14adfd8d, branch die/linux-voice-processing-helper-and-real-l-14adfd8d. Host has libpulse/pipewire and webrtc-audio-processing-1 development libs. Allow isolated synthetic null-sink testing, never physical mic/speakers/user default rerouting. Mac permission/AEC still distinct acceptance. Controller and SDK hardening integrated through 1aad5b2; parent fixed TS narrowing/import issue and pending Bun assertion deadlock; 19 tests/check pass. CLI lab integration worker assigned next; no coding bridge yet.

CLI lab integration task_2bf99cc9: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_2bf99cc9, branch die/wire-voice-only-lab-into-cli-and-native--2bf99cc9. Parent owns Linux controller resolver adjustment and native builds/CI after pieces return.

## Integration checkpoint

CLI first pass integrated b3d2cf9; polish/review task_3b0595d5 at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3b0595d5 branch die/polish-lab-conversation-presentation-and-3b0595d5 addresses per-frame UI spam, transcript delta assembly, real speaking/drain states, confirm races. Native Mac task_53edad03 stalled after syntax error, stopped with uncommitted draft safely retained. Replacement task_e90502c0 at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_e90502c0 branch die/finish-native-macos-helper-from-saved-dr-e90502c0 copies/reviews draft. Linux 759596a passed virtual null-sink tests but parent requested actual buffering/shutdown review before integration: task_15bdfb0b at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_15bdfb0b branch die/review-linux-helper-realtime-and-shutdow-15bdfb0b. Parent added Linux helper resolution, compiled-sibling path and minimal audio env forwarding (not model keys), 27 lab tests passed; typecheck job task_401d538d finishing. No real paid SDK or physical device test this phase yet.

## User symptom: spoken reply cut off

User reports latest released Live starts responses but cuts speech off before response finishes. This is a concrete top-priority acceptance case, not merely latency dissatisfaction. Causes NOT established: mic recapturing output causing false server interruption, queue overflow/transport failure, or premature playback teardown. Released client does not itself use turnComplete to stop playback, so do not claim that cause proven. Rebuild must keep generationComplete distinct from audible drain and retain all accepted queued tail until rendered; normal turn boundary must never flush. Test a multi-second reply with distinctive final phrase/signal and actual virtual-output capture verifying complete tail, no user input; separately test intended interruption while ongoing, false interruptions during speaker echo, and timing of native queuedMs reaching zero. Existing fake loop tests insufficient. Human Mac test must include several long replies on headphones and speakers to classify acoustic route. No default buffer drops/flush at silence/turn end.

Mac native draft e67135b integrated as a3233df. C core ASan/UBSan passes on Linux. Added Native Live Lab workflow to compile Swift helper on macos-15, run device-free self-test and upload experimental helper. NOT a user-ready bundle or physical validation. Parent notes remaining native capture-overflow/reporting and callback/output lifecycle deserve review; CI compilation first. Formatted lab TS, 27 tests and typecheck pass. Linux review and UI polish still running.

Pushed prototype 7c9de39 for CI: Native Live Lab 35902056407 (/tmp/die-lab-native-ci.log) and general CI 35902056499 (/tmp/die-lab-ci.log). Native review task_8230f4df at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_8230f4df branch die/review-native-mac-audio-tails-and-callba-8230f4df focuses callback safety, bounded output, capture chunking, full speech tail and flush. No release.

Initial native CI failed Swift Int vs Int32 frame argument; fixed 215182b. General CI failed src/cli.ts formatting; fixed same commit. Follow-up native35902191803/general35902191753 logs /tmp/die-lab-native-ci-2.log and /tmp/die-lab-ci-2.log. Linux helper759596a + b3f00ad integrated 2ea6c1a; parent built and passed protocol/isolated virtual test (source-removal can reroute, not proof device-loss event).

Top-priority new-draft overflow risk: extension eager writes into1s native ring and2s pending cap can cut normal model bursts. Added task_c17d3e72 paced playback preserving full tails, /home/tnfssc/.die/worktrees/die-a86675007a5e-task_c17d3e72 branch die/paced-playback-preserving-full-reply-tai-c17d3e72. It owns separate playback.ts/tests; parent wires after UI polish. Pace20ms frames, sensible bounded pending response budget, keep turnComplete separate from audio drain. Not yet integrated.

Native Mac CI35902191803 passed corrected215182b helper compile and device-free self-test; real AEC/permissions unverified and further native safety review still pending. Added acceptance harness task_8de5fdd8 /home/tnfssc/.die/worktrees/die-a86675007a5e-task_8de5fdd8 branch die/end-to-end-linux-voice-and-full-tail-acc-8de5fdd8. It uses actual Linux helper and scheduler with isolated virtual capture/render, verifies distinctive tail reaches output monitor; paid mode explicit env/flag max1session60s, parent triggers only after review, no real key access during development.
Native Mac review (device-free, 2026-09-23): bounded C SPSC queues now admit whole play commands or reject them, account for actual PCM frames, preserve final interpolation sample and distinguish generation flush from drain. Tap bufferSize is only advisory; split callback into bounded slices and report dropped capture frames from atomic counter on non-realtime queue. Main/output queue sequencing orders ready, stop and reset; stdout is nonblocking with fatal backpressure rather than indefinite print/fflush. Ring-zero plus 200ms grace is **not** hardware playback confirmation. Sanitized C tests pass on Linux; Swift build and physical route/echo behavior remain unverified. Values unchanged: existing bounded-use, truthful-status and preservation principles cover this.

Paced playback de7b24a integrated. Parent stopped UI polish worker after long stall at single timing assertion, retained draft and completed integration: throttled short status, assembled transcript deltas, confirm ownership, lifecycle-running independent of speaking, paced scheduler connected to helper drain/flush and turnComplete (never normal flush). Added consent-race/transcript/full-duplex tests, removed raw playback exception detail. Native Mac safety18d9479 integrated6497694 with prior Int32 compile correction retained. Parent C sanitizer tests pass. Full build at6497694 passed. Post-pacing lab tests/check/format passed task_25122e1b; optional Mac full bundle workflow added (manual dispatch only), not run yet. Need native latest CI and Linux tail harness acceptance before user-ready claim.

Pushed dae6906 paced/voice UI prototype. General CI35903524129 (/tmp/die-live-lab-paced-ci.log), native push35903523994, and explicit Mac candidate bundle dispatch35903548678 (/tmp/die-live-lab-candidate-ci.log). Candidate contains actual CLI + sibling native helper, no brew requirement; unsigned experimental artifact, not release. Prior general CI35902191753 passed. Compiled Linux resolver probe confirms helper path uses executable sibling rather than Bun virtual filesystem or current user project. Need final output-tail harness and latest native/CI before offering candidate.

Native latest drain-clock Swift inference failed candidate35903548678; fixed explicit DispatchTime in9e84c9e. New candidate35903739250 (/tmp/die-live-lab-candidate-ci-2.log), native push35903715022, generalCI35903715099 (/tmp/die-live-lab-ci-3.log). Candidate remains voice-only. Parent building Linux candidate with reused embeddedweb at dist/live-lab-candidate/die and native sibling; task_238bd96c. Added user candidate README (pending commit), helper/CLI must remain siblings.

Linux acceptance79349b3 integrated8b908de but fixture failed explicit routing guard on desktop PipeWire. Do not call final-tail proven. Follow-up task_e2d5ec5d /home/tnfssc/.die/worktrees/die-a86675007a5e-task_e2d5ec5d branch die/isolate-linux-audio-acceptance-from-desk-e2d5ec5d verifies metadata parsing then adds private no-hardware audio server if needed; explicit-device cork+verify before capture recommended. No system/user audio config changes allowed. Parent Linux full candidate compile+isolated help passed. Mac candidate35903739250 still running; previous generalCI35903524129 was cancelled by newer push, not failed checks.

Final prototype evidence: Mac candidate run35905027767 passed at e6f0597; artifact live-lab-macos-arm64-experimental is nonempty (138898592 bytes). This is voice-only /live-lab, not a release or agent-bridge acceptance. Linux isolated harness09cfcae integrated3c8756c; parent rebuilt helper and reproduced fixture pass in /tmp/die-lab-isolated-parent.log: tail score0.839, old-before0.936, old-after0.009, new-epoch0.968, capture continued. Earlier desktop routing root cause remains unknown. No paid/provider or physical-device test performed. Review confirmed monitor assertions; noted low-probability saved-PID reuse in cleanup escalation, worth hardening before broader automation. Values unchanged; current evidence-first and truthful-status values apply.
