# Native Live via plain die update (proposal, not published)

Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_98aeea31
Branch: die/make-native-live-release-work-with-die-u-98aeea31
Base: 5a66e7999ec43b6758cc3443bf79daace66774a2.

## Compatibility approach for parent review

Inspected current src/update.ts and exact v0.7.1 tag: no diff. Old updater only
accepts /releases/latest stable numeric versions and exact raw executable asset
names plus matching per-file .sha256. It atomically replaces ONE executable.
A prerelease flag in new code cannot help the installed binary. The published
v0.8.0-rc.1 tar and compiled 0.7.1 version cannot satisfy this path.
Read prerelease commits d778ad2/b6f6142; not integrated wholesale (their manual
candidate is intentionally isolated). Existing tags/assets must stay untouched.

Propose fresh stable v0.8.0 with package version compiled as 0.8.0 and unchanged
four raw stable asset names/checksums. Mac arm64 die embeds the native helper;
/live-lab extracts it privately on demand, with integrity/permission checks, and
keeps experimental opt-in labeling. No helper download, updater extension, or
manual user install. Other stable target updater contracts remain unchanged;
Linux native helper distribution is NOT newly promised. macOS helper must be
built on macOS, preserving dependency licenses. No device/provider acceptance
claims. Substantial packaging/security changes: HOLD publication until parent
reviews extraction, workflow gates and evidence; no tags/releases pushed here.

## Delegated pieces (all durable worktrees)

- embedded helper: branch die/embedded-native-helper-packaging-e2c7cb3e,
  worktree sibling task_98aeea31-a86675007a5e-task_e2c7cb3e.
- exact old updater fixture: branch die/old-updater-compatibility-fixture-586363f0,
  worktree sibling task_98aeea31-a86675007a5e-task_586363f0.
- release pipeline: branch die/stable-native-release-pipeline-af57607c,
  worktree sibling task_98aeea31-a86675007a5e-task_af57607c.

Pending implementation, integration tests, actual Mac no-device gates, and review.
No secrets, paid calls, physical microphone, auto-install, or publication.
Values unchanged: existing truthful-evidence and bounded-ownership values apply.
