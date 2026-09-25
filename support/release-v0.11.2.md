# Clearer code ownership and repeatable CI

- Live prompt text lives with the other prompts under `src/prompts/`. Provider-specific instructions stay separate.
- Shared output buffers, job-delivery contracts, child-process environment rules, and session identity have clear homes outside individual consumers.
- Session input, transcript history, and configured-agent authority use shared session boundaries.
- Web bootstrap and packaging code live with their owning system. Release notes are selected from the release version instead of a hardcoded filename.
- `bun run ci` runs the same Linux checks locally and in GitHub Actions, with isolated temporary files. The macOS Live test setup and unstable scheduler heap assertion are fixed.

This is an internal cleanup and CI reliability release. It does not intentionally change voice instructions, saved settings, delegation permissions, job cancellation, or packaged asset layout. Checks use offline/fake providers; no new live audio or paid API acceptance is claimed.

## Update

Run `die update`, restart die, then check `die --version` reports `0.11.2`.
