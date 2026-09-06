# v0.2.0

## Changes

- Manual /shake prunes eligible completed tool/thinking traces while retaining dialogue verbatim and preserving the full session transcript. Automatic compaction remains the default.
- Opt-in /fast on|off|status for allowlisted OpenAI/Codex models on supported official endpoints and authentication surfaces (not custom gateways or alternate endpoints), with explicit premium-cost consent and a dedicated bolt indicator. Model and reasoning settings are unchanged.
- Built-in Herdr pane-state reporting, enabled by Herdr environment variables for root interactive sessions.
- Single-line collapsed execute and task-completion displays, with expandable detail and visible failure/attention indicators.
- Restored Nerd Font idle chevron with a stable working-spinner gutter.
- Corrected cancellation/startup test synchronization and hardened lifecycle, context projection and request authorization.

## Limits and compatibility

- /shake refuses active/queued work, unsafe tool protocol and opaque native Codex checkpoints. It can invalidate prompt caches; reduced context is not a promise of lower cost.
- Native fast mode is requested, not provider-confirmed. Fast-session cost totals show unavailable rather than misleading estimates. Anthropic fast mode is not implemented. No paid fast-mode latency or billing validation was performed.
- Herdr uses compatible agent identity pi with source herdr:die; native die display identity is not verified in Herdr 0.7.5.
- Linux x64 baseline binary is the supported release artifact. Nerd Font glyphs require a suitable terminal font.
- Context recovery/automatic-shake ideas are recorded in docs/context-recovery-roadmap.md and are not enabled features.

Source, checksum and license notices accompany the binary. v0.1.0 remains unchanged.
