> **STALE CHECKOUT AUDIT:** This report inspected `.cache/die-t3code` at 6f00d388, not the current release pin.
Do not treat findings as current-release evidence until revalidated in `leak-audit-current-web.md` using `.cache/die-t3code-v0042` (719a76ca).

# Web client memory/resource leak audit

## Scope and method

Read-only review of `.cache/die-t3code/apps/web/src` (the web tree represented by `web/t3.patch`), with the browser RPC WebSocket implementation in `packages/client-runtime/src/rpc/session.ts` followed far enough to verify ownership.
I inspected React effects/subscriptions, timers/animation frames, observers, object URLs, module-level caches, device WebSockets, browser recording resources. Ghostty terminal setup/teardown.
No product source was changed.

Severity reflects realistic long-lived SPA sessions, not just the existence of process-lifetime state.

## Findings

### 1. Medium — syntax-highlighter cache accepts unbounded, user/model-controlled language keys

**Evidence**

- `apps/web/src/lib/syntaxHighlighting.ts:18-38` declares a module-lifetime `Map<string, Promise<DiffsHighlighter>>`, inserts every requested `language`, and never evicts it.
- Unsupported names do not remove their original entry: the rejection handler at lines 28-36 falls back to `text`. While the original promise remains stored under the arbitrary name at line 37.
- `apps/web/src/components/ChatMarkdown.tsx:1084` calls it with the Markdown code-fence language.
  That value can come from user or assistant content.
  `apps/web/src/components/search/HighlightedSearchLine.tsx:134` is another caller.

**Reachable scenario**

A long chat/session renders fenced blocks labelled `lang-1`, `lang-2`, etc.
Every distinct label permanently adds a string and promise to the map, including unsupported labels that all resolve to the same text fallback.
Generated assistant content makes this reachable without adding files to a workspace.
Depending on the highlighter library, attempted grammar loads may retain additional internal state.
That latter amplification is **not verified** here.

**Impact**

Unbounded heap growth over the tab lifetime.
Each local entry is small, so normal use is unlikely to be noticeable, but bulk generated Markdown can drive it deliberately or accidentally.

### 2. Medium-low — PR handoff cache permanently retains complete prompt bodies per draft

**Evidence**

- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx:245-250` creates module-level `lastHandoffPromptByDraft`.
- Lines 1049 and 1053 read and set it, respectively.
  There is no delete, size limit, environment cleanup, or draft-deletion cleanup in this module.
- The value is the complete `task.prompt`, not a hash or small marker.

**Reachable scenario**

During one long desktop/web tab lifetime, repeatedly hand off pull-request tasks into new drafts, especially with large generated prompts.
Closing/deleting those drafts or leaving the PR panel does not release the retained strings.

**Impact**

Growth is proportional to the number and size of handed-off prompts.
This needs large repeated use to matter, hence below a general medium/high severity.

### 3. Low — several explicitly session-lifetime caches/sets grow with navigation or content and are never pruned

These are confirmed retention paths, but individually small in expected use:

- `apps/web/src/hooks/useLiveRefresh.ts:78-85, 133-146`: `lastRefreshedAtByView` is documented as “never pruned.” PR detail supplies a unique environment/PR key at `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx:800-805`.
  Visiting many distinct PRs leaves one map entry each.
- `apps/web/src/projectIconModel.ts:134, 159-190`: `projectIconCache` retains one tiny object per distinct project name forever.
- `apps/web/src/components/chat/MessagesTimeline.tsx:3570-3587, 3617-3626`: `loadedToolActivityIconSrcs` retains successful native-app icon cache keys and URL strings. Entries are removed only on a later image error.
  Many environments/apps or changing signed asset URLs can accumulate entries.
- `apps/web/src/components/chat/ThreadErrorBanner.tsx:19-33`: every dismissed `threadKey + NUL + error message` is retained for the session.
  Distinct/large error messages can make this larger than the other tiny-key caches.
- `apps/web/src/components/ProviderUpdatePrimaryNotification.tsx:26` and `ProviderUpdateLaunchNotification.tsx:50` similarly retain seen notification keys for the tab lifetime. Expected number of keys is low.

**Reachable scenario**

Keep the SPA open for days while moving through many PRs/projects/threads and dismissing changing errors.
Memory only returns on reload.

**Impact**

Slow, workload-number of keys growth, with no single large browser resource proven retained.
Consider these bounded-cache hygiene issues rather than urgent leaks.

## Browser WebSocket lifecycle

### RPC WebSocket: no leak found in the inspected ownership chain

- `apps/web/src/lib/runtime.ts:55-68` installs Effect's global WebSocket constructor into a page-lifetime `ManagedRuntime`.
- `packages/client-runtime/src/rpc/session.ts:192-213` constructs the socket as a scoped Effect layer (`Socket.layerWebSocket` and `Layer.build`).
  Connection supervision owns the scope. Tests in the same package explicitly exercise closure on interruption/open timeout (for example `rpc/session.test.ts:1194-1222`).
- `apps/web/src/connection/platform.ts` rebuilds the registration map by replacement on each topology poll not just appending registrations.

The web runtimes themselves have no explicit disposal/HMR hook (`apps/web/src/lib/runtime.ts:34-68`, `apps/web/src/connection/runtime.ts:33-57`).
In production they intentionally live for the page and the browser releases sockets on document teardown.
**Speculation only:** Vite HMR that re-evaluates these modules could leave an old managed runtime alive if its module graph is replaced without scope disposal.
I did not demonstrate that path and do not count it as a product leak.

### Device stream WebSockets: teardown is present

- `apps/web/src/components/device/DeviceStreamView.tsx:60-114` starts a client only while visible and calls `client.stop()` on effect cleanup.
- `apps/web/src/components/device/deviceStream.ts:409-418` deduplicates retry timers. Lines 482-499 own/clear the iOS prime request timeout and abort controller. Lines 503-540 and 543-593 guard connect/retry with `stopped`.
- `deviceStream.ts:611-624` clears all retries, aborts both fetch controllers, closes and nulls the WebSocket, and closes the video decoder.

No accumulating socket/listener path was found.
A close event with authorization code can still call `handleUnauthorized` after shutdown (lines 528-537), but it does not schedule a retry or keep the socket.
This is a possible stale callback/behavior issue, **not evidence of a resource leak**.

## Terminal teardown

No terminal leak found.

- `apps/web/src/components/ThreadTerminalDrawer.tsx:480-515` handles unmount during asynchronous WASM surface creation by marking setup cancelled and disposing the newly created surface when it eventually resolves.
- Lines 856-885 register selection actions, a `MutationObserver`, and a fit timer. They put all matching cleanup actions in `setupCleanups`.
- Lines 887-923 run cleanup in reverse order and dispose the terminal both on normal teardown and setup failure.
  The resize animation frame is cancelled at lines 963-978. The window resize listener is removed at lines 1356-1377.
- `apps/web/src/terminal/ghostty/surface.ts:1027-1053` clears terminal timers/render work, removes DOM listeners, disposes the WASM core, and removes terminal DOM nodes.
- `apps/web/src/state/terminalSessions.ts:99-120` uses `WeakMap`/`WeakRef` for derived session grouping rather than strongly retaining historical metadata snapshots.

## Other reviewed lifecycle areas with cleanup present

- Live refresh removes focus/visibility/interaction listeners and clears its interval on unmount: `apps/web/src/hooks/useLiveRefresh.ts:158-181`.
- Background activity listeners are installed with `Effect.acquireRelease` and symmetrically removed: `apps/web/src/lib/backgroundActivityReporter.ts:214-238`. Retained scopes are reference-counted and deleted at lines 125-141.
- RPC latency timers/maps are capped and cleared on acknowledgement/eviction: `apps/web/src/rpc/requestLatencyState.ts:77-151`.
- Attachment upload jobs and per-environment counters are deleted in completion/cancellation paths: `apps/web/src/lib/attachmentUploadQueue.ts:338-368, 449-454`.
- Device AX polling aborts the in-flight request and clears its timeout: `apps/web/src/components/device/DeviceStreamView.tsx:197-220`.
- Object URL creation sites reviewed generally have paired revocation.
  In particular expanded-preview video URLs are revoked by the owning ChatView effect at `apps/web/src/components/ChatView.tsx:1641-1647`, and terminal/media thumbnail helpers return cleanup functions.

## Priority

1. Bound or canonicalize the syntax-highlighter key cache.
2. Delete/bound PR handoff prompt entries when drafts are consumed/deleted, or retain a digest instead of the full prompt.
3. Add modest LRU/session caps to the low-severity navigation/content caches if very long-lived tabs are a supported workload.
