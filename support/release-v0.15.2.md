# v0.15.2

- Keep long streamed Live replies playing without a cumulative turn-duration cutoff; packet and pending-playback limits still apply.
- Retain chunked GPT-Live speech within bounded storage, refuse incomplete requests instead of sending partial instructions, and keep provisional/overlap context separate from spoken user text.
- Preserve the request-to-speak flag for GPT-Live replies buffered while the provider connects.
- Remove the repetitive Live history banner, use short actionable question IDs, and avoid duplicate identical web cost totals.
- Strip validated automatic-goal transport markers before provider dispatch.

Remote-workspace experiments and documentation are research only: this release does not add SSH workspaces or a remote service.

Verification uses offline provider/audio fixtures, serialized model requests, terminal rendering, and local automated gates. Real microphones, speakers, acoustic playback, ASR quality, paid providers, and actual SSH disconnect/recovery remain unverified. Requesting provider speech is not proof that a user heard it.
