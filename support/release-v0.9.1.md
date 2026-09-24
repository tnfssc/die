# Local speaker diagnostic — not a proven echo fix

Run `/live-lab speaker-check` in a local interactive session. After explicit consent, it plays a short low-level test sound through the system-selected output and listens briefly through the same native processing path used by voice lab. Stay quiet and start with a comfortable low output volume. No Gemini key, provider connection, or paid API is used.

The bounded in-memory test reports render-reference correlation and capture energy, processing configuration, and honest no-signal/clipping/inconclusive outcomes. PCM is not saved or logged. This is diagnostic evidence for investigating speaker self-interruption, not an absolute AEC score, a proven echo fix, or proof of speech double-talk/barge-in. Native echo processing, microphone forwarding, provider VAD, and the agent job bridge remain unchanged.

Update with `die update`, restart die, then run `/live-lab speaker-check`. Only the user's explicit command opens audio devices.
