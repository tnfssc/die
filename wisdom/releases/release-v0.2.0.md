# v0.2.0

## Changes

- Manual /shake removes eligible completed tool and thinking traces. It keeps dialogue word for word and leaves the full session transcript intact. Automatic compaction remains the default.
- Opt-in /fast on|off|status works for allowlisted OpenAI/Codex models on supported official endpoints and authentication surfaces (not custom gateways or alternate endpoints), It asks for clear premium-cost consent and a dedicated bolt indicator. Model and reasoning settings are unchanged.
- Built-in Herdr pane-state reporting, enabled by Herdr environment variables for root interactive sessions.
- Single-line collapsed execute and task-completion displays, with expandable detail and visible failure/attention indicators.
- Restored Nerd Font idle chevron with a stable working-spinner gutter.
- Fixed cancellation and startup test timing. Made lifecycle, context projection, and request authorization safer.

## Limits and compatibility

- /shake refuses active or queued work, unsafe tool protocol, and opaque native Codex checkpoints. It can invalidate prompt caches; less context does not promise lower cost.
- Die requests native fast mode but cannot confirm that the provider used it. Fast-session cost totals show unavailable rather than misleading estimates. Anthropic fast mode is not implemented. No paid check measured fast-mode speed or billing.
- Herdr uses the compatible agent identity pi with source herdr:die. The native die display identity was not checked in Herdr 0.7.5.
- Linux x64 baseline binary is the supported release artifact. Nerd Font glyphs need a matching terminal font.
- Context recovery/automatic-shake ideas are recorded in wisdom/compaction/context-recovery-roadmap.md and are not enabled features.

Source, checksum and license notices accompany the binary. v0.1.0 remains unchanged.
