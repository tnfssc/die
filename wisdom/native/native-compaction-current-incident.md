# Native compaction current incident (read-only diagnosis)

Date: 2026-09-14

## Evidence

- Source: src/tasks/native-compaction.ts:763-797 computes nativeFallbackCode(); when coverage fails it records coverage_incomplete, clears the native capture, returns without cancelling, and lets the later cache-affine handler run. With an existing opaque checkpoint the same branch is blocked/cancelled instead (lines 765-779), preserving the checkpoint.
- The current coverage predicate (lines 426-441) is ordered subsequence matching of all messages-to-summarize plus turn-prefix messages, followed by the first-kept-entry/leaf boundary guard. It is not a projection or “newer messages” test.
- The prior investigation’s concrete mismatch is real: live custom messages carry a runtime Date.now() timestamp, while session reconstruction uses the persisted entry timestamp. The captured request and reconstructed compaction event can therefore differ by 1 ms. Before the current source’s coverageMessageKey() normalization, whole-message JSON keys differed and coverage returned false. The suspected first turn-prefix task-complete custom message was entry 2a1463ed (task_1f86111); persisted time was 1789368711432, while 1789368711431 is inferred from adjacent live evidence. The live capture is memory-only, so that exact runtime value cannot be proven from the JSONL.
- Session metadata confirms incident compaction entry a67410ef at 2026-09-14T07:09:13.397Z. Its details are cache-affine-plaintext metadata (version 5, priorPayloadAffine false); no opaque/native checkpoint was written there. Later JSONL metadata contains native entries at lines 1802 and 2461, but no plaintext/ciphertext/auth material was read.
- The source now strips only top-level timestamp for role custom; all other message fields, roles, ordering, multiplicity, and the boundary check remain strict. This is the minimal safe correction and does not bypass guards or create a plaintext fallback for an opaque checkpoint.

## Retry/fallback mechanism

The warning repeats because native failure is normal fall-through: the native hook clears its capture and returns, then the registered cache-affine compaction hook owns the same session_before_compact event. A later automatic compaction/context pass can capture a new provider request and repeat the check. It is not evidence that native HTTP was repeatedly dispatched: this coverage failure has dispatch none; no native request is safe to send. Existing opaque checkpoints take the conservative blocked path and do not fall through.

## Minimal safe fix

Keep the current narrowly scoped semantic coverage key for reconstructed custom messages (ignore only their nonsemantic top-level timestamp), plus a regression test for live-vs-persisted custom timestamps. Do not weaken content/order/boundary checks, bypass the opaque-checkpoint guard, or use plaintext when an opaque checkpoint exists. No source edits, provider calls, installs, server kills, or packaging were performed during this diagnosis.

## Remaining uncertainty

The source-level timestamp reconstruction defect is confirmed. The exact unseen live timestamp in the memory-only capture is inferred rather than directly recoverable from the session JSONL. The JSONL provides event/entry metadata only; it does not independently establish the in-memory captured request.

## Main correction/current evidence
The worker conclusion above repeats the OLD07:09plaintextincident and does NOT establishcurrentcause. Mainscanfoundnativecheckpoints d9e961ca10:15:52Z and54709353 at13:09:12Z. Latestdurablediagnosticsarefrom09/13~19:51because128record durablebudgetexhausted; latestin-memoryreasonunavailablefromJSONL. The genericopaqueblockmessagecoversmultiplefallbackcodes, so cannotinfercoverage_incomplete. Mainaskeduser /diagnostics latestcomponentcompaction code (metadataonly). Packagingpaused; guardmustremain. Code-onlyworker task_eda7b808 running toinvestigatecapturelag/safe-boundaryandothercauses; no fix made.

## Confirmed narrowed cause/fix (main)
Userpostedlive /diagnostics: repeatedcoverage_incomplete dispatchnone betweenfreshresponses. Mainread-onlySDKreplayat15:15:25: required472 available518 rawreconstructionmatched. Requiredindex352 isassistant error timestamp1789396082526 (14:28:02.526Z), content[] andusage0. SDKagent-session._prepareRetry removesfailedassistantfromliveagentstate butkeepsjournal. Emulatingthatprune reproducedfirstmissingindex352. ExcludingONLYemptyassistant error fromrequiredchecks restorescoveragewithunchangedboundary. No plaintext/messages/ciphertextoutput; metadata-only artifacts/native-coverage-confirmed.log. MainprocessPID168303 stillrunning0.2.10 since10:38UTC (deletedoldinode), confirmedbinarycodealreadyhastimestampfix; restart/resume necessaryforanynewfix. src/tasks/native-compaction.ts nownarrowfiltersroleassistant stopReasonerror contentarraylength0 only; partialreplies/signatures/toolcallsprotected. Testworker task_2b12ba50 ownstests/native-compaction.test.ts. No install/releaseyet. PackagingremainsPAUSED.

FIX VALIDATED/INSTALLED locally: task_96732165 passedtypecheck/buildand612tests14skip0fail(3849assertions87files); focusednative38tests includingemptyfailedretrycase, partialtext, encryptedthinkingSignature/toolcallrejection, missinguser/toolresultblocking. Mainofflineproof showsfirstmissingindex352 disappearsONLYafteremptyfailedassistantfilter; boundaryunchanged. AtomicCLI-onlyinstallto~/.local/bin/die, version0.2.13(unpublisheddevelopmentfix), identicaldistSHAverified. Websidecar/userserverunchanged. CurrentliveparentPID168303 stillold0.2.10 inode; usermustexit/resumethisconversation toloadnewcode. Existingjournal/checkpoints nevermutatedbydiagnosis. No commit/tag/release; bundlingstillpaused.

After restart user still reports generic compaction refusal plus expected /shake opaque refusal. Verified NEW parent PID442354 executing installed fix SHA1f1f3558a0de4c68e1f578caf78c74af7ff6df6dc0bde4fc9198354d7e7f9623. Latest fallback code unknown; capture_missing immediately afterrestart is possible, NOT confirmed. Current normal exchange should establishfreshcapture. Askuser retry /compact afterreply; ifblocked needlatest /diagnostics componentcompaction code. Do not infercoverage_incomplete fromgenericUItext or bypassguard.

User confirms resolved after fresh exchange: "ok. now we done. continue". Single-binary work authorized to resume. Patched process verified; no additional compaction changes needed now.
