# v0.8.0

Plain `die update` from installed stable v0.7.1 installs this release. The macOS arm64 executable now includes its native Live Lab audio helper; no separate download, Homebrew, or Xcode is needed for **/live-lab**. The existing **/live** path remains separate and unchanged.

**/live-lab is experimental, opt-in, and voice-only.** It does not control the coding agent or execute tools. It needs a local interactive terminal, microphone permission, and your Gemini credentials; provider usage may be billable. No microphone or provider connection starts just by updating or running the device-free diagnostic `die --live-lab-self-test`.

CI gates cover native ring/sanitizer tests, protocol/self-test without devices, embedded-helper extraction from the actual Mac release executable, correct compiled version, licenses, and the exact compiled v0.7.1 updater against staged release bytes. These are not claims of physical microphone/speaker acceptance, acoustic echo quality, interruption latency, signing, or notarization. Use headphones when opting into testing.

The four stable raw executable asset names and SHA256 files are unchanged. Linux/Android updates keep their existing behavior; this release does not promise a bundled Linux native Live Lab helper. Existing prerelease tags/assets are untouched.
