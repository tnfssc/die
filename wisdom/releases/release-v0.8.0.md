# v0.8.0 ordinary stable release preparation

See [native-live-stable-update](native-live-stable-update.md) for worktree, commits, evidence, and remaining publication steps. This is a normal stable release, not a preview/channel rollout. The native helper is Mac arm64 only, embedded in the single updater-compatible raw executable. /live-lab stays explicitly experimental and voice-only; existing /live stays unchanged.

Pipeline: Mac helper device-free checks -> full Linux build/checks and all four raw assets -> actual cross-compiled Mac binary old-updater/self-test gate -> stable publication. No new manual-install or preview workflow. License generation includes current production dependencies and embedded web notices; native helper uses Apple frameworks, no bundled external native library. Existing tags/assets must not be replaced.

No remote run, tag, release, mic, paid provider, secrets, or auto-install was performed by this work. Physical acoustic acceptance and signing/notarization are explicitly not claimed, not silently marked passed. Parent owns final review and ordinary stable tag publication after normal checks. Values unchanged: current truthful-evidence and preservation guidance applies.
