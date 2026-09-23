# Native voice-only Live Lab prerelease v0.8.0-rc.1

User explicitly authorized publishing a prerelease for testing, not replacing stable.
Work branch: die/release-native-live-lab-testing-candidat-a9be4ec5
Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_a9be4ec5
Base HEAD: 5a66e7999ec43b6758cc3443bf79daace66774a2 (includes isolated Linux tail harness).
Independent audit: task_888e70a1; worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_a9be4ec5-a86675007a5e-task_888e70a1,
branch die/audit-prerelease-checks-and-mac-artifact-888e70a1.

## Publication plan and provenance

Remote tags/releases checked: v0.8 namespace empty, latest stable v0.7.1.
Publish v0.8.0-rc.1 with prerelease=true and make_latest=false. Never run the ordinary
stable packaging for this candidate: it omits the native helper. Added a prerelease
job guard to release.yml and its regression assertion so pushing this tag skips that
workflow job. This is an explicit/manual candidate publication, not full stable CI.

User permits artifact reuse when runtime matches. Mac bundle from successful run
35905027767, build commit e6f0597570881f186d625f8fcd6549e0894d7353, artifact
live-lab-macos-arm64-experimental, ID10770169872 (138898592-byte Actions artifact).
Actions archive digest sha256:13cd815648de87de8b28cbbb78bb553df4fc33724c303d7277b52d77df2f210b.
Downloaded once for repackaging/provenance, not post-release rehashing.
Full diff from build to base HEAD contains only Linux helper/harness and wisdom.
CLI/Mac helper/dependencies/build/web sources unchanged. Repack changes README and
SOURCE only; retain all license notices, executable modes and executable bytes.
CLI still reports compiled package version0.7.1, disclosed prominently in instructions.
Mac executable SHA256: 278e54f05579edb745901f3b119e9608959bc2b0daa7e2335d07ab89d259d22b.
Helper SHA256: 71092e078150d443bc0d2761813decfa76bb15ad2002e738b32c78f32f99717b.
Both file(1) checks show Mach-O arm64; tar has sibling die + live-lab-audio at0755.

## Checks and limits

Mac run passed sanitizer/ring tests, helper compile/self-test, device-free protocol,
full CLI build and env-isolated CLI --help/helper self-test. No physical devices or
paid Google calls. General CI35905027869 failed only format on Linux acceptance
script before further Linux checks; Mac Local Live job passed. Release prep formats
that script and documents its intentionally overriding teardown failure lint exception;
no runtime behavior change. Local locked install, format, lint, typecheck and targeted
47 tests/442 assertions (live-lab + release workflows) pass; sanitized C audio core
check is recorded in artifacts/live-lab-prerelease. Logs remain in that ignored directory.
The full stable-release web/PTY matrix was not rerun; do not imply stable acceptance.

Linux previously verified privately: parent tail0.839, old-before0.936, old-after0.009,
new-epoch0.968, capture continued. Distribution libraries/clean-host matrix unvalidated:
no Linux asset published. No Intel Mac/Windows/Android assets claimed.
Remaining gates: actual Mac acoustic echo, interruption/tail/latency and permissions
with real devices and opted-in paid provider; signing/notarization; coding-agent bridge
(not present); Linux distro dependencies and physical route. No local auto-install,
credential-file reads, security bypass instructions or device/provider runs.

User instructions: support/live-lab-prerelease.md. Values unchanged: current evidence,
truthful status, bounded ownership and preservation principles apply.
Publication outcome and exact release source commit to be appended after API verification.
