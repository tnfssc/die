# v0.8.2

Narrow macOS Live Lab mic-check patch for the reported `audio_start` failure. The mixer is now explicitly connected to the voice-processing output and uses the route format, following Apple’s voice-processing sample. **This is a plausible graph/format fix, not a proven root cause or verified fix on the reported Mac.**

Startup failures now identify the output connection, source attachment/connection, tap installation, or engine-start stage. Caught NSError details are restricted to a bounded, allowlisted system/synthetic domain and numeric code; descriptions, userInfo, device names and raw logs are not forwarded. Objective-C exceptions from graph operations cannot be caught by Swift’s error handler.

Run `die update`, then start a fresh `die` session. Optional `die --live-lab-self-test` uses no devices. To retry startup, run `/live-lab mic-check` and accept its explicit consent prompt: it briefly starts native audio, discards capture, saves no recording and makes no provider or credential-service calls. Report the bounded stage/domain/code, not keys or raw logs. A ready result is not proof of signal or acoustic quality.

The Apple Silicon helper is embedded in the Mac stable binary. Publication is gated on native Mac compilation, device-free tests, deterministic release/build/web/PTY checks, and actual Mac embedded-helper/updater checks. Real microphone/speaker devices, TCC prompts, acoustic behavior, and end-to-end provider sessions remain unverified. Linux virtual signal tests pass but do not establish real-provider or physical-device end-to-end support. Live Lab remains experimental; ordinary /live and stable update asset names are unchanged.
