# Live voice prompt: capable without pretending

The Live model is a voice companion to die, not the configured agent itself. Die's actual identity and working values favor practical help, looking before guessing, plain speech, simple solutions, and honest status. A prompt that begins and ends with restrictions can make the voice refuse ordinary noncoding requests (for example weather) merely because the configured agent is called a coding agent.

Give Live an affirmative job: help with the request, answer simple things directly, and pass research or current-information requests to the configured agent via the available tools. Tool availability and results, not the prompt, determine whether the configured agent can browse or retrieve current weather. Missing location is a question, not a guess. Never report a queued request as completed. Host context may be a summary, not a transcript; passing work requires actual captured user speech, and if that isn't available, ask for a repeat instead of implying delivery.

Keep the narrow authority boundaries (only user-requested work, data not instructions, no key requests, explicit cancellation with UI confirmation, stable retry IDs). Don't turn those into the spoken persona or a claim that this is only for coding. The Live prompt can guide behavior; it cannot fix transcript capture or grant tools. This lesson complements [grounded spoken handoff](grounded-spoken-handoff.md) and [values](../values.md), especially “show what is real” and “leave user's work safe.”

Parent refined the first draft into short plain sections matching system.md:
Working together, Passing work, Respect the user. Explicitly supports weather
and other noncoding help; correction should lead to repair, not invented rules.
11 prompt/session tests and typecheck passed in parent. This is prompt/config
proof, not real-model behavior proof. Transcript integration still running.
No installation yet. Existing values apply; no values change.

Provider control and correction merged from da25dfe. Connected metadata alone
fixed weather delegation in control; save required concrete host-context handoff
guidance. Final prompt save called agent_send once but acknowledged only not
completed, rather than clearly no work started in fake-host result. See
voice-prompt-connected-validation.md; no actual export/weather result claimed.
Parent final-prompt weather check task_91094d23 writes selected trace to
/tmp/die-live-final-weather.jsonl. 29 focused tests/typecheck passed after merge.
Snapshot privacy task_f33596b4 still pending; do not install prior build.

Final weather check completed: exact final instruction hash 28531e32...,
real manual synthetic speech -> agent_send once with exact captured request.
No actual job/weather result. Model said it was waiting for details despite
fake host saying no job; status narration remains imperfect. Do not call that
result truthful completion. See voice-prompt-final-weather.jsonl.
