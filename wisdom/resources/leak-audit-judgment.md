# Follow-up judgment — complete

User rejects change-size as a reason to defer.
Judgment only, no implementation requested/applied.
Final synthesis: wisdom/resources/memory-resource-judgment.md.
Independent review completed: leak-audit-judgment-history.md, leak-audit-judgment-lifecycle.md.

Fix these first: total completed-output RAM, busy terminal backlogs, provider log limits, stale execute ACK state, POSIX launcher ownership, and a per-run capture cap.
Old caches and locks still need clear owners. Tiny navigation sets can stay until measurements show real cost.
Generic helper concurrency needs measurement, not a claimed confirmed bug.
Artifact lifetime needs clear policy rather than silent expiry.

The history reviewer calls source journal RAM a policy, not a leak. The lead agrees. Useful data grew in step with RAM. No production OOM was shown. Still, long and resumed sessions should keep only a bounded part of old history in RAM and load the rest from disk.
Preserve original text, branches, refs, exclusion/privacy, and durability.
Large engineering scope is not the reason to accept/defer anything.

The failed recording bug is real upstream, but normal Die web cannot reach it.
It requires Electron window.desktopBridge.preview. Here previewBridge is null, so start rejects.
It is not a top-five Die bug or a release blocker.
Normal RSS peaks, active-work memory, and legitimate stored data are not defects.
Old preview-timeout finding invalid at current pin.
