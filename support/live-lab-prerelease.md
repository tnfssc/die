# v0.8.0-rc.1 — experimental native voice-only Live Lab

This is an opt-in **prerelease**, not a replacement for stable v0.7.1.
Apple Silicon Mac only; no Linux, Intel Mac, Windows or Android bundle is published.
There is **no coding-agent bridge** in this lab.

## Download and run on Apple Silicon Mac

Download `die-v0.8.0-rc.1-macos-arm64-live-lab.tar.gz` and `SHA256SUMS`
from https://github.com/tnfssc/die/releases/tag/v0.8.0-rc.1 into the same folder.
In Terminal, change to that folder, then:

```sh
shasum -a 256 -c SHA256SUMS
mkdir die-live-lab-rc1
tar -xzf die-v0.8.0-rc.1-macos-arm64-live-lab.tar.gz -C die-live-lab-rc1
cd die-live-lab-rc1
./die
```

Keep `die` and `live-lab-audio` together. Do not overwrite your stable installation.
Enter `/live-lab` in die, then choose Start only when ready to use your microphone,
speakers and a **paid Google API connection**. Use existing Google API-key auth;
do not paste keys into chat or shell commands. `/live-lab status` shows diagnostics;
`/live-lab stop` closes voice, not agent work. Transcripts are UI-only, not saved to chat.
No SoX, Homebrew or Xcode is required to run this Mac bundle. Old `/live` setup
SoX checks do not apply to `/live-lab`.

This experimental bundle is **unsigned/not Developer-ID notarized**. macOS quarantine
or Gatekeeper may block it. If blocked, stop and report the exact message; do not
disable security protections or remove quarantine as a routine workaround.
Allow microphone access for your terminal host only when you intend to test.

## Provenance and limitations

The release source includes the verified isolated Linux tail harness at base commit
5a66e7999ec43b6758cc3443bf79daace66774a2 plus release documentation/workflow safeguards.
Mac executables are reused unchanged from successful GitHub Actions run
https://github.com/tnfssc/die/actions/runs/35905027767 at build commit
`e6f0597570881f186d625f8fcd6549e0894d7353`.
The Mac runtime source is unchanged between those commits. The bundled CLI still
reports **0.7.1**; this identifies its compiled package metadata, not stable behavior.
Use SOURCE.txt and the release tag to identify this prerelease.

Mac sanitizer/ring tests, helper self-test, device-free protocol smoke and isolated
compiled CLI help passed. No paid provider call or physical microphone/speaker test
was performed. CI does not establish acoustic echo cancellation, real-device latency
or complete spoken-tail quality on your route. Test short/long replies, pauses and
interruptions; report headphones versus speakers and status errors. Linux virtual
loopback evidence is not Mac physical-route evidence. Linux needs separately validated
system dependencies, so no Linux distribution asset is claimed here.
