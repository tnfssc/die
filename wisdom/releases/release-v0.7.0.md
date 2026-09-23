# v0.7.0

- Add opt-in Gemini Live voice conversations in the terminal with a simple status line. Live can hand work to the current session's coding agent without blocking the voice conversation.
- Add consent-first `/live setup` onboarding: reuse configured Gemini credentials or explicitly approve importing a private key into provider auth storage. An optional, separately approved connection test may incur paid Gemini API usage.
- Live currently requires Linux with local SoX audio tools and a Gemini API key. Use headphones: echo cancellation is not included. Other release targets retain the rest of die, but Live audio is not supported there.
- Live is off by default. Physical microphone/speaker and acoustic quality acceptance were not performed for this release; paid live acceptance remains opt-in and was skipped during release validation.
