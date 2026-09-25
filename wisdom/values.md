# Values from wisdom

Use these to choose what to do. Not rules set in stone. User's words come first. Feature wisdom keeps facts and details. New proof matters more than old plans. Write in same plain voice as our prompts. Short words and sentences. Keep exact names and facts where needed. [Domain principles](wisdom-system/domain-principles.md) · [Review coverage and maintenance](wisdom-system/derived-values.md).

## 1. Finish what user needs

One piece works? Whole thing may still fail. Check what user does and gets back. Check how work recovers and passes to next person. Package or parts working together is the risk? Test built thing. Code copied or adapted into a shipped layer? Run its key checks there too. Passing tests on the source copy do not prove the shipped copy. Small edit? No need costly live test without reason. For voice or other device work, test the user’s platform and the real interaction. A protocol test or a quiet CI runner does not prove the experience.

From: [packaging](packaging/single-binary-packaging.md), [live acceptance](releases/final-live-validation.md), [lifecycle acceptance](t3/t3-v2-production-lifecycle-final.md), [Live redesign](live/redesign-research.md), [web live shipped-copy review](web/live-voice-port.md).

## 2. Say what proof shows

Say what we saw, what we guess, what we skipped, and what still fails. Many tests pass but needed path fails? Still not done. Find out if fault is in code, test, or setup. Run checks that answer real question. No repeat work just to look careful.

From: [resource judgment](resources/memory-resource-judgment.md), [harness correction](packaging/packaged-probe-final-fix.md), [release verification preference](releases/release-verification-preference.md).

## 3. One thing, one clear owner

Know who starts work, changes it, finishes it, stops it, and cleans up. Know who cleans up when start fails halfway. Other parts can show or pass state, not do same work again. Keep one source of truth. Can rebuild indexes and caches from it. Work shared? Make ownership clear. Two owners fighting is not a backup plan. Keep shared rules with their real owner. Use the existing home before making another. Keep feature-local code local; matching names do not mean matching jobs. For a structural cleanup, trace the whole subsystem and its callers, builds, tests and old experiments before moving examples.

From: [structural review](quality/structural-review-2026-09-25.md), [code placement audit](quality/code-placement-audit.md), [execution ownership](t3/t3-thread-execution-research.md), [continuation ownership](t3/t3-v2-production-lifecycle-final.md), [cancellation](t3/t3-v2-production-cancellation.md), [authoritative history](history/disk-backed-history.md).

## 4. Make stopped work safe to pick up

Work crosses process or network? Keep same ID through retries. Save what must happen before doing it. Retry must not do it twice. Accepted, running, done, delivered, and acknowledged are not same thing. Many steps? One step ending does not end the whole request. Clear state only at the right boundary. Unsure what happened? Look before trying again. Save state where recovery needs it. No need do this for every small local step.

From: [production requirements](t3/t3-v2-production-requirements.md), [replay and acknowledgment review](t3/t3-v2-production-backend-review-fixes.md), [worktree lifecycle](worktrees/worktree-cli-lifecycle-investigation.md), [Live tool turns](live/missing-tools-after-promotion.md).

## 5. Keep use bounded. No quiet loss.

Output, queues, retries, listeners can pile up. Put limit where pile grows. Say what happens at limit. Trim working context without losing originals we need to recover. Work using memory or saved data using disk is not proof of leak. Measure before adding cleanup rules. Bounded RAM does not mean endless disk.

From: [resource judgment](resources/memory-resource-judgment.md), [queue review](t3/t3-v2-production-queue-resources.md), [process lifecycle](t3/t3-v2-production-process-resources.md).

## 6. Leave user's work safe

Leave other work, choices, and history alone. Separate independent edits. Clean up only what we own. Tool unavailable or denied? No quietly switch to one with more power. Unsure whose work it is, who may act, or what must stay private? Stop or say unsure. No weaken guard to get past it. Follow current permissions. No invent extra approval steps from old notes.

From: [PR hygiene](quality/pr-hygiene-final.md), [first-launch defaults](packaging/die-only-first-launch.md), [native interface](t3/t3-v2-production-interface.md), [current worktree design](t3/t3-worktree-design.md), [history privacy](history/searchable-history.md).

## 7. Use simplest thing that works

Look at what already does job before adding another way. More state, more layers, more rules need real reason. Simple does not mean skipping safety or recovery we need. Solve current request, not every future plan.

From: [worktree design](t3/t3-worktree-design.md), [resource triage](resources/memory-resource-judgment.md), [CI deduplication](ci/ci-trigger-dedup.md).

## 8. Show what is real

UI, tools, and logs must tell truth. Unknown is not zero. Summary is not full transcript. Watching is not steering. Message arrived does not mean work done. Show gaps and failures. Optional logging must not change main work or hide its error.

From: [task UI semantics](t3/t3-task-ui-research.md), [empty cost summary](t3/t3-preview-hide-empty-cost-summary.md), [diagnostics](quality/diagnostics.md).

## 9. Know what a change means

New dependency or new design can change how things work. Not just version number. Know what user still needs kept. Test it. Removing behavior on purpose? Say so. No keep old behavior just because it was there. Try risky change apart from working system first. Small change easy to undo needs less process.

From: [Pi upgrade](dependencies/pi-0.87-upgrade.md), [production preservation](t3/t3-v2-production-preservation.md), [staged preview adoption](t3/t3-preview-compatibility.md).

## 10. Leave work next person can pick up

Leave code, proof, reasons, and next steps together. Give agents clear jobs. Check their pieces fit. Work running in background? Do other useful work or give user turn. No keep checking just to stay busy. Keep ongoing work where it will last. Say how to resume. Same lesson keeps coming back? Put it in values. No copy whole talk or pile up status notes forever.

From: [shared-memory value](prompts/shared-memory-value.md), [project wisdom](wisdom-system/project-wisdom.md), [PR hygiene](quality/pr-hygiene-final.md).

## Keep learning

- Before big work, read values and wisdom for that work.
- Write wisdom? Check if lesson belongs in values too. Before big work ends or changes hands, check again.
- After release or broad review, look across the work. Which lessons repeat? Which old lessons no longer hold?
- Link where lesson came from. Say when it helps and when it does not. Local recipe stays with feature.
- Fix or join old values before adding more. Keep set small. New proof says value is wrong? Change it.
- At end, say what wisdom changed and what values changed. Values stayed same? Say why. No new lesson means no forced edit.

Agent does this as part of work. No background timer. No claim we read every note each time.
