# v0.7.1

- Add local Live audio support on macOS through Homebrew SoX and the default CoreAudio input/output devices. Setup now includes macOS-specific installation and microphone-permission guidance.
- Keep Linux Live audio support unchanged and add native macOS CI coverage for the shared SoX command contract and deterministic, device-free Live behavior.
- Live remains opt-in and requires Gemini credentials. Physical microphone/speaker behavior, macOS permission prompts, latency, echo, and paid provider acceptance were not tested; use headphones and run `brew install sox` before starting Live on macOS.
