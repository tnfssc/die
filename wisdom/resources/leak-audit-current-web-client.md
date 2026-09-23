# Current web/client leak audit — HEAD 719a76ca

## Scope and method

Audited the current working tree rooted at `.cache/die-t3code-v0042`, whose Git HEAD is
`719a76ca1dbf5490f1aa33ffb9966301e02be9a9`.
I treated the older
`wisdom/resources/leak-audit-web-client.md` as unvalidated input and re-read the current sources.
This audit owns `apps/web` and `packages/client-runtime`.
It does not assess provider or server
runtime ownership.
No product source was changed.

The sweep covered module-lifetime maps/sets and caches, Effect scopes/fibers/PubSubs, RPC WebSockets,
React effect listeners and timers, browser/device sockets, browser recording streams, terminal
observers/timers, upload jobs, object URLs, and session/navigation caches.
Severity is for retained
growth in a long-lived SPA, not just process-lifetime state.

## Findings

### 1. Medium-low — desktop recording capture-timeout leaves the native handoff registered

**Dynamically reproduced.** This is the strongest newly verified lifecycle defect.

- `apps/web/src/browser/browserRecording.ts:293-334` stores each prepared capture in the
  module-level `pendingTabMediaCaptures` map.
Cancellation deletes it at line 331. A normal
  native trigger deletes it at lines 337-343.
- If native `startScreencast` resolves but never invokes the global capture trigger,
  `captureTabMediaStreamWithTimeout` rejects after its timer and only disables late stream
  acceptance / clears the timer at lines 351-380.
It cannot delete the pending map entry.
- The subsequent failed-start cleanup stops native capture, recorder, and stream and clears the
  active recording at lines 416-437, but it also does not delete the pending capture registration.
- `startBrowserRecording` reaches exactly that cleanup path at lines 565-603.

The durable generated test in `scripts/leak-audit/current-web-client-tests.mjs` makes the native
request intentionally omit its callback, advances the real source's timeout, observes the failed
start, then invokes `DESKTOP_PREVIEW_RECORDING_CAPTURE_TRIGGER`.
It returns `true`, proving that
the failed operation is still in the private map.
The probe consumes the stale entry afterward.

Each distinct timed-out tab can retain a callback/promise graph for the page lifetime.
a later stale trigger can also initiate display capture after startup was reported failed.
This is
a failure-path leak not normal recording growth, so severity is below medium.
Calling the
prepared capture's `cancel` operation on timeout/failed-start (or deleting by identity there) would
close the gap.

### 2. Medium-low — syntax highlighter cache grows for arbitrary Markdown language labels

**Source-confirmed.
Behavior covered by a passing source test, but heap growth was not measured.**
The syntax cache does exist in this checkout, contrary to the possibility noted in the assignment.

- `apps/web/src/lib/syntaxHighlighting.ts:18-38` owns a module-lifetime
  `Map<string, Promise<DiffsHighlighter>>`, keyed by the caller's language string.
- Unsupported labels fall back to `text` at lines 28-35, but their original entry remains.
  The
  only delete is for failure of `text` itself at line 30.
- Markdown code-fence labels reach it from `apps/web/src/components/ChatMarkdown.tsx:1084`.
  search highlighting also calls it at
  `apps/web/src/components/search/HighlightedSearchLine.tsx:134`.
- `apps/web/src/lib/syntaxHighlighting.test.ts:12-27` verifies that the recovered promise remains
  cached for an unsupported label.
The source-only probe separately verifies the unbounded keying
  and sole deletion site.

Many unique user/model-generated fence labels produce monotonic map growth.
The local entry is small,
and any additional library-internal retention is unverified, so this is not rated high.

### 3. Medium-low — PR handoff cache retains complete prompt text per draft

**Source-only.
No private-map heap probe.**

- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx:261` declares module-lifetime
  `lastHandoffPromptByDraft`.
- It reads and stores the full `task.prompt` at lines 1090-1094.
  The current file has no
  `delete`, `clear`, size cap, or cleanup tied to draft deletion/environment removal.

A long-running tab that hands large prompts to many distinct drafts retains all prompt strings.
This needs repeated PR workflow use to become material.
A digest, bounded LRU, or deletion with the
draft lifecycle would remove the growth path.

### 4. Low — small session caches grow with distinct content/navigation keys

**Source-only retention paths.** These are real but lower impact than the three findings above.

- `apps/web/src/hooks/useLiveRefresh.ts:78-85,136-152` explicitly keeps one timestamp for every
  view key ever read and says entries are never pruned.
Listener/timer teardown itself is correct at
  lines 158-180.
- `apps/web/src/components/chat/ThreadErrorBanner.tsx:7-33` stores
  `threadKey + NUL + complete error message` for every dismissed distinct error.
- `apps/web/src/components/ChatView.logic.ts:1025-1059` retains dismissed branch-mismatch keys and
  one checkout boolean per distinct environment/cwd pair.
- `apps/web/src/components/ChatMarkdown.tsx:1241-1271` retains every hostname whose favicon image
  failed.
Markdown link hosts are content-controlled.
- `apps/web/src/components/chat/MessagesTimeline.tsx:3704-3759` retains successful native tool
  icon cache keys and URL strings.
Only a later image error removes an entry.

These hold small strings/numbers/booleans under normal use.
They merit modest caps only if tabs are
expected to traverse very large numbers of projects, PRs, worktrees, hosts, or native app URLs.

## Important non-findings and corrected stale claims

### Client-runtime RPC/session ownership

No accumulating WebSocket, PubSub, or per-subscriber queue was found.

- Each connection is built in a caller scope at `packages/client-runtime/src/rpc/session.ts:162-213`.
  The config source fiber is `forkScoped` at line 286.
- Config fan-out is a sliding PubSub capped at 64 entries at line 218.
  Subscribers are acquired via
  `PubSub.subscribe` at lines 304-327, so their subscriptions are scope-owned.
- Current tests explicitly cover socket closure on scope release
  (`packages/client-runtime/src/rpc/session.test.ts:351-369`), a slow subscriber that misses the
  bounded window (lines 656-770), config-source death (lines 771-798), and direct/relay sockets that
  never open (lines 1194 onward).
All passed.
- Environment registry reconciliation deletes removed registrations/scopes/cache data at
  `packages/client-runtime/src/connection/registry.ts:602-660`.
Targeted registry/resolver tests
  passed.

The page runtimes remain page-lifetime singletons.
There is no demonstrated production leak from
that ownership.
HMR replacement without disposal was not reproduced and is not counted as a finding.

### Current cache bounds

The stale note's `apps/web/src/projectIconModel.ts` claim does not apply: that file is absent in
this checkout.
Current favicon storage is implemented by
`packages/client-runtime/src/projectFaviconCache.ts`.
It limits source reads, trims by both entry
count and byte count at lines 149-160, removes stale entries, and has passing cache tests.

The potentially large remembered thread timeline is also capped at 16 and evicts old entries at
`apps/web/src/components/ChatView.logic.ts:344-362`.

RPC acknowledgement state is capped at 256, times out/deletes pending entries, and evicts oldest
entries at `apps/web/src/rpc/requestLatencyState.ts:14,94-145`.

### Device, browser media, and terminal teardown outside finding 1

- Device stream mount cleanup calls `client.stop()` at
  `apps/web/src/components/device/DeviceStreamView.tsx:60-101`.
Stop clears retry timers, aborts
  fetches, closes/nulls the socket, and closes the decoder at
  `apps/web/src/components/device/deviceStream.ts:612-624`.
AX polling aborts and clears its timer
  at `DeviceStreamView.tsx:197-218`.
- Normal browser recording finalization stops the media recorder and tracks and clears the active
  map at `apps/web/src/browser/browserRecording.ts:735-793`.
Paint and startup wait timers/frames
  are cleared at lines 391-413 and 460-479.
The missing native-trigger case is the isolated gap
  reported above.
- Terminal asynchronous setup disposes a late-created surface on cancellation at
  `apps/web/src/components/ThreadTerminalDrawer.tsx:488-515`.
Setup cleanup/observer/timer disposal
  is at lines 856-923, resize RAF cleanup at lines 963-978, and window listener removal at
  lines 1356-1377.
The Ghostty surface removes DOM listeners and clears render/timer work in its
  disposal path at `apps/web/src/terminal/ghostty/surface.ts:1688-1730,1788-1800`.
- Upload queue jobs/counters are removed in completion and cancellation paths at
  `apps/web/src/lib/attachmentUploadQueue.ts:338-368,449-454`.
Background activity's retained
  scopes and DOM listeners are symmetrically released at
  `apps/web/src/lib/backgroundActivityReporter.ts:125-141,214-238`.
- Object URL creation sites were swept.
  Attachment previews revoke on removal/cleanup (for example
  `apps/web/src/components/chat/ChatComposer.tsx:5363-5378`).
Download-only URLs use delayed
  revocation.
No additional retained URL path was established.

## Validation: tested versus source-only

### Executed tests/probes

Command:

`node scripts/leak-audit/current-web-client-tests.mjs`

Result on this exact tree:

- source structural probe: pass. Confirmed HEAD and current source markers.
- web: **9 files, 172 tests passed**, including the generated missing-native-trigger retention probe,
  browser recording source tests, device stream, live refresh, attachment upload queue, background
  activity, syntax highlighting, request latency, terminal sessions. Ghostty surface.
- client runtime: **5 files, 76 tests passed**, covering RPC session, connection registry/resolver,
  project favicon cache, and relay discovery.

The runner creates one temporary test beside `browserRecording.test.ts` so the web project's real
aliases/mocks/config are used, reports each exact owned child PID, and removes the temporary file in
a `finally` block.
It starts no server and uses no paid API.
No broad process matching or killing is
used.

### Source-only conclusions

Findings 2-4 are source retention analysis (with normal behavior tests where stated), not browser
heap snapshots.
HMR singleton speculation is excluded.
Device/terminal/listener/object-URL
non-findings combine source ownership review with targeted tests.
They are not an exhaustive browser
heap census.

Durable audit entry points:

- `scripts/leak-audit/current-web-client-source-probe.mjs` — exact-HEAD structural assertions and
  line-bearing JSON output.
- `scripts/leak-audit/current-web-client-tests.mjs` — source probe plus targeted runnable tests and
  the private pending-capture reproduction.

## Priority

1. Clear/cancel `pendingTabMediaCaptures` when capture acquisition times out or failed-start cleanup
   runs.
2. Canonicalize/bound syntax language keys, especially unsupported labels.
3. Bound or lifecycle-delete full PR handoff prompts.
4. Add small caps to the low-impact session caches only if very long-lived/high-number of keys tabs are
   a supported workload.
