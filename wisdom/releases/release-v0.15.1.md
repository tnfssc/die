# v0.15.1 release in progress

User requested release of the GPT-Live input cleanup.
Implementation 493755b; full local source gate at 4c39bea passed:
1175 tests, 17 opt-in skips, zero failures; fresh CLI/web build and smoke.
Actual model-message and terminal evidence:
../live/clean-gpt-model-input-evidence.md.
Public scope/limits: ../../support/release-v0.15.1.md.

Freeze version 0.15.1, run full local gate, push develop; require hosted CI
and release dry run on exact SHA before tag v0.15.1. After tag workflow
passes, verify latest/non-draft and expected assets. No redundant binary
downloads, no local install. No paid provider/device acceptance claim.

Wisdom updated for input contract and release. Values unchanged: existing
user/agent surface and honest-evidence guidance applies.
