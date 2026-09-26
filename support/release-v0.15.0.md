# v0.15.0

- Add persistent questions in the parent CLI session. `/questions` lists them; answer a specific question without losing it among progress updates. Pending and saved-answer state stays visible. Agents can post a question, keep doing independent work, and mark dependent work blocked.
- `/live model` lists supported voice models across providers. Choosing a model selects its provider. `/live provider` configures credentials without changing your selected voice model or starting voice.
- Keep GPT-Live provisional transcript data out of chat bubbles while preserving the readable Live transcript and coding context.
- Fix a native playback interpolation bug at audio packet boundaries. Offline waveform tests reproduce the defect and verify the fix; this is not yet proof that every reported crackle is resolved on a real device.

Questions in this version support the parent CLI session. Web question UI, automatic child-to-parent question relay, and targeted spoken replies are not supported. After restart, a saved answer may need explicit `/questions resume`; uncertain delivery is never blindly replayed.

Provider readiness means credentials are configured, not that paid model access was tested. Connected paid-provider and physical audio acceptance remain unverified on this build host.
