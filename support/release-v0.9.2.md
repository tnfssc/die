Native Live is now the single voice experience on Apple Silicon Mac. Run `/live` to start or stop; action autocomplete and focused credential setup are included. `/live-lab` is replaced by `/live`. Stopping voice does not cancel agent work.

Playback keeps a bounded native cushion to avoid scheduler starvation, preserves reply tails and interruption behavior, and uses the Mac-tested full-duplex audio path. The compact footer waveform follows microphone and scheduled output PCM, not measured speaker output.

Agent handoffs use captured speech and branch-scoped transcript context, with explicit gaps and bounded private snapshots for longer conversations. The voice prompt supports general-purpose requests without claiming queued work is complete.

The Mac executable includes its native audio helper and remains compatible with the existing single-binary updater. Linux/Android CLI assets remain available; native Live audio is currently supported on macOS arm64, not Linux.

Update with `die update`, then restart die. Prior user Mac playback feedback and installation checks informed this release; automated release checks are device-free. This is not a claim of exhaustive acoustic, route, double-talk, or real-agent/provider validation. The parallel OpenAI Live provider feature is not included.
