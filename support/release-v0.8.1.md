# v0.8.1

Diagnostic patch for the generic macOS Live Lab “Audio helper error”; **the reported root cause is not yet known or verified fixed**. The report came from Ghostty with no microphone prompt and previously working SoX capture. That does not establish a permission, device, or terminal cause.

Run `die update`, start a fresh `die` session, then run `/live-lab mic-check` and accept its explicit consent prompt if you want to test device startup. The check starts native input/output briefly, discards captured buffers, saves no recording, and makes no provider or credential-service calls. Report its bounded diagnostic code/stage, not keys or raw logs. A ready result is not proof of microphone signal or sound quality. Optional `die --live-lab-self-test` uses no devices.

Known startup stages now surface safe allowlisted codes instead of losing them behind a generic message. Native startup validates output format before construction and removes the input tap only if installed. Neither change is a proven fix for this report.

Publication is gated on Mac compilation/device-free native tests, relevant deterministic tests, all stable raw assets, and actual Mac release executable embedded-helper/updater checks. Real devices, microphone prompts, acoustic quality, provider sessions, signing and notarization are not validated. /live-lab remains experimental; paid voice sessions remain separately consented. Existing /live and ordinary stable updater asset names are unchanged.
