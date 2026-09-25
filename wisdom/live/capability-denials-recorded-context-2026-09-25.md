# Recorded-root Live capability-denial probe (2026-09-25)

Read [values](../values.md) and the prior worker's unmodified wisdom/live/capability-denials-probe-2026-09-25.md in task_ccca35fc (34/34 calls using synthetic requests/roots). No production prompt change.

## Method

Reproduce: install dependencies with bun install --frozen-lockfile --ignore-scripts; run bun scripts/prepare-assets.ts; then DIE_CAPABILITY_PROBE=1 bun scripts/probe-live-recorded.ts weather:snapshot:baseline audio:snapshot:baseline delegate:snapshot:baseline followup:replay:baseline. Redirect stdout to a **private location outside the repo**: it contains original user speech, model speech and generated JS. Do not commit. The script reads only original entries before 17:32:53 of the explicitly scoped 2026-09-25T17-24-54-391Z session file. It gets configured provider/model (openai/gpt-realtime-2.1) and key from the normal Live configuration and credential resolver. No secret output or credential edits.

The initial recorded system frame's preamble + cwd forms the root, SHA-256 31e0c58a9779cabb3ad0fe392fa5c7481c5980227ee2d88838b389014138cba5. Offline production preview supplies *only* the execute declaration. Realtime session.update matches production audio-output config; user input is text, no microphone/speaker; audio output ignored. Current main-owner project() serializes transformed non-system AgentMessages as a JSON branch-context snapshot and direct-main-agent sendContext() sends it as a user item. The probe approximates this with recorded message entries preceding the target user utterance, excluding system/custom diagnostics/provisional entries. fresh sends just that user utterance; snapshot precedes it with the JSON projection; replay additionally injects recorded provisional assistant speech as prior assistant items (exploratory accumulated-denial approximation, **not** the actual provider conversation). No fabricated expected denial was seeded. Real provider conversation also contained prior audio, response timing and interruptions; these cannot be reconstructed from JSONL.

Source entry indices: 44 first Hyderabad-weather denial request; 63 desktop-recording request; 72 delegation follow-up; 85 execute follow-up. Weather/audio input SHA-256: c0129d50073b7676246f629314006f2add7b378bd8de064fbf497a761249f704 / bf58441cf54c903ad404b0b7cbe00aca90c0941cffc38599546b5a6e585286ad. Corresponding snapshot SHA-256: 0d25f6e0ee966de7e1bd1d9c4f0d30965fce1dc040473ae7f98abcce1939ce7f / 5dab75df909f88a66347837410c25b61a3326b33f0eb33ffbebaf34d6c3167fd.

All generated execute calls intercepted without evaluating model JS. Synthetic jobs.inspect returns completed worker/template, synthetic subagent returns mock receipt (no worker started), other calls return probe interception. No user file inspected or processed, no real git pull/subagent/shell/weather lookup. Tool choice is **not** actual execution. This text-transcript probe does **not** establish audio behavior.

## Results: 27 connected sessions, zero provider errors

| Original utterance / context | Baseline chose execute | Grounding chose execute | Finding |
| --- | ---: | ---: | --- |
| Weather / fresh + snapshot | 0/2 | 0/2 | Says cannot check live Hyderabad weather, even fresh. Not proof live weather was available. |
| Desktop recording / fresh + snapshot + replay | 0/3 | 0/2 (fresh/snapshot) | Usually asks for file/path; name absent, so not necessarily false inability. |
| Delegate follow-up / fresh | 0/1 | not run | Promises agent action without a call. |
| Delegate follow-up / snapshot + replay | 3/3 | 1/2 snapshot | Context helps call subagent, but one grounded trial only promises delegation. |
| Execute follow-up / fresh | 0/1 | not run | Requests clarification. |
| Execute follow-up / snapshot | 4/4 | 3/3 | Calls jobs.inspect, subagent or shell. Post-tool claims of no access/manual commands partly arise from synthetic interception. |
| Execute follow-up / snapshot plus original provisional speech replay | 3/4 | not run | **1/4 no-tool denial** says unable to run desktop commands and advises user to do it. This is an accumulated-refusal-context result, not an independent audio reproduction. |

The small grounding suffix states execute and host helpers remain available and asks for action before completion claims. It did not consistently improve tool selection; no prompt fix demonstrated. Earlier rounds returned explicit probe interceptions, final rounds returned mock delegation receipts; post-tool wording cannot be compared across these rounds. One response calls probe interception a “safety check”, not evidence of actual runtime policy. The prior worker's explicit synthetic prompts (34/34 tools) therefore did not cover this original ambiguous multilingual task-formulation pattern. Original weather request showed no call even without denial history. Later no-tool OS denial only appeared with exploratory replay containing prior recorded denials. Causality (context versus language/audio versus task ambiguity) remains unknown; no production prompt change recommended. If investigating further, use consented controlled audio fixture and intercept runtime safely, separating ASR, provider conversation, projected history, and mock-result effects.

Values unchanged: go look, leave user's work safe, and show what is real already cover the lesson.
