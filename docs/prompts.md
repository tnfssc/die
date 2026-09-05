# Prompt design

## Current hardening status (2026-09-05)

The prior medium-configuration behavioral successes below are historical evidence, not a blanket reliability claim. Review reproduced instruction loss after a tool step in a notification-triggered continuation. The scoped lifecycle adapter now retains the complete effective frame through custom-message tool continuations and synchronizes fresh compaction with Pi’s next-turn override. Public-SDK regressions cover successful tool results, custom/empty prompts, isolation and context filtering. Installation remains explicit. See `PRODUCT.md` for the current contract and validation status.

## Source files

Edit `src/prompts/system.md` for the die-owned system prompt. It is imported as
text verbatim (apart from its trailing newline) by `src/prompts.ts`. Supporting
tool description (`src/prompts/execute-description.md`), tool guidance, role templates, delegation facts, and background feedback live in
the other Markdown files under `src/prompts/`. `{{role}}`, `{{delegation}}`, and
`{{jobs}}` are runtime template substitutions, not instructions to the model.

Bun embeds these text imports in the standalone binary; deployment does not need
the Markdown files beside the executable. This is the actual source, not a copied
prompt dump. Pi still composes its base instructions and dynamic session/project
context around it. The Markdown extraction preserves the existing prompt text.

## Values before procedures

The agent needs a model of good work, not a growing checklist of forbidden moves.
Die’s working values are:

- **Responsive collaboration:** give the user control between meaningful pieces
  of work. Yielding with session-owned jobs is responsible handoff, not abandonment.
- **Purposeful attention:** spend actions on progress, diagnosis, or decisions.
  Automatic completion removes the need to occupy a turn checking for it.
- **Evidence-led communication:** distinguish launched, pending, and verified work;
  preserve uncertainty instead of turning intent into a claim of completion.
- **Proportionate effort:** choose the simplest reliable path, preserve the user’s
  work and resources, and distinguish execution budgets from conversational waits.
- **Clear ownership:** delegate bounded outcomes with room for judgment; the parent
  retains responsibility for integration and respects user-selected profiles.

These values should explain unfamiliar situations as well as known failure cases.
For example, responsiveness and runtime-owned completion together explain why a
short launch followed by ending the turn is preferable to a process-wait loop.
That conclusion does not need a separate prohibition for every possible wait API.
A short positive example makes the distinction operational: launch a check, read
independent evidence, send a progress update, then evaluate the automatic result
on the next turn. Completing that turn is not claiming the assignment is finished.

## Separate values from facts

Behavioral judgment lives in workingValues in src/prompts.ts. executeReference
contains precise API mechanics: signatures, return shapes, foreground budgets,
job ownership, cancellation, input, and capability limits. Tool descriptions
retain execution/output/image constraints. Runtime validators still enforce the
actual schema and delegation capabilities; this revision does not weaken them.

The background-handoff notice describes state, ownership, and why returning
control is useful. It no longer uses an uppercase command or a list of bans.
Role guidance describes each agent’s contribution, useful evidence, and ownership.
Output-loss guidance explains targeted recovery in terms of preserving evidence
and avoiding repeated side effects.

## Scope and maintenance

Die-controlled guidance is centralized in src/prompts.ts and used by the execute
registration, handoff results, and child role prompts. Output diagnostics remain
near the code that produces them. Pi’s base system-prompt builder, user-supplied
custom system prompts, project context, and third-party skills are not silently
rewritten. Their precedence remains unchanged.

Review found a separate packaging concern: Pi’s generated documentation links
point into the installed runtime, which currently materializes selected runtime
assets rather than the documentation tree. That deserves an asset/path fix,
not more instructions telling the model to cope with missing files.

## Evaluation

Prompt quality is measured by behavior, not by matching a prescribed tool script.
The natural nested-agent and terminal scenarios in docs/background-ux-audit.md
remain the regression probes: independent work, prompt return, purposeful use of
inspection, yielding, truthful completion, responsive follow-up, and cancellation.
The test prompts do not tell the model to obey a polling or yielding rule.

A values-oriented prompt is still guidance rather than a behavioral guarantee.
Failures are evidence to improve the underlying explanation or interface, not a
reason to automatically append another ban. API facts and runtime safeguards can
remain exact without making all collaboration a rigid procedure.

### Iteration evidence

The first values-only rewrite passed deterministic tests and the real Escape
probe, but failed both natural background workflows: the model reintroduced long
foreground waits and polling. We kept that failure as evidence rather than treating
a friendlier tone as success. The next revision explains task ownership versus
turn lifetime more explicitly and adds a positive handoff example. It does not
restore the uppercase command or the former list of prohibitions.

The concrete revision passed nested coordination and achieved all terminal
lifecycle goals. That terminal run included one immediate status snapshot within
the launch/file-read call (165 ms total), which an old blanket regex classified
as polling. Evaluation now distinguishes that from repeated waiting-only calls.
The launch-latency bound, pre-completion yielding, timely arithmetic response,
and exactly-once automatic continuation remain required. This is a documented
change in behavioral criteria, not evidence that the original assertion passed.

A subsequent repeat still showed genuine blocking (a timer inside the launch
call) and a leaf waiting loop. The next revision therefore makes the event model
explicit and demonstrates separate execute, assistant, completion, and resumed
assistant turns. This draft remains under live evaluation; deterministic tests
alone do not establish behavioral reliability.

### Historical status: draft, not install-ready

The final repeat failed both natural workflows: the terminal model selected a
30-second foreground wait for a 25-second command, and the nested workflow did
not create the requested orchestrator. Deterministic tests (143), typecheck/build,
and smoke passed, but those do not override the behavioral failures. The existing
installed binary is unchanged. The direction remains values-based; the current
draft is not being represented as a validated replacement.

## Next iteration: shorter decision-point guidance

This candidate reduces registered guidance from 5,664 to 3,907 characters (31%).
It retains values and factual API reference while removing repeated explanations.
It explicitly frames efficiency as serving the user’s requested workflow, and
execute as work up to the next decision point. Role and handoff text are shorter
and remain explanatory rather than prohibitory.

A new SDK-level integration test verifies every registered guidance item appears
in Pi’s assembled system prompt with execute active. This verifies assembly, not
a captured provider request. An attempted temporary CLI-extension probe timed out
and did not provide delivery evidence; its temporary files were removed.

Evaluation budget: two unchanged natural nested/TUI trial pairs, using the same
GPT-5.6 Luna minimal-thinking parent and configured descendant profiles. The
two pairs failed all four scenarios: nested runs skipped the requested orchestrator,
and terminal runs failed to hand off responsively. Deterministic tests (144),
typecheck/build, smoke and diff checks passed. The candidate is not install-ready;
no extra retries or weakened criteria were used. This trial does not support a
claim that shortening the values prompt solved the behavioral problem. A next
experiment should investigate interface affordances rather than more prose.

## Agent framing and provider delivery

A deterministic Codex serialization test now verifies exact preservation of the
supplied instructions, automatic tool choice, and no network request during the
probe. This rules out stripping at that serialization boundary; it is not a live
wire capture.

Values and the worked example now frame the agent in before_agent_start, rather
than being buried among tool-use reference bullets. The tool carries only API
mechanics. Explicit user system prompts retain their existing override behavior;
child identity/capability facts are preserved. Natural validation is in progress.

### Turn protocol, not a prohibition

The agent frame now explains a concrete interface fact: an assistant response
without tool calls returns control; a progress sentence accompanied by another
tool call does not. A final text response can close one turn without declaring
the assignment finished. The terminal workflow passed with this clarification.

The nested fixture now explicitly requests a separate orchestrator subagent,
distinct from the root. Previously “have an orchestrator coordinate” also admitted
the interpretation that the root should coordinate two workers itself. This
clarifies user intent without specifying helper code, wait budgets, or yielding.
The requested graph and all timing/continuation checks remain in place.

## Cooperative handoff and configuration-sensitive validation

The new `await handoff(message)` control operation makes returning control an
explicit action inside execute. It publishes bounded progress text, unwinds the
module, releases foreground waits, and supplies Pi’s native cooperative batch
termination hint. It leaves managed jobs alive. Every tool result in a batch must
yield for Pi to pause; other ongoing useful work is not silently aborted.
Ordinary text-only responses remain available. Runtime and SDK tests cover the
batch boundary, validation, cleanup errors, survival, and exactly-once completion.

The reference now spells out actual profile capabilities and the latency cost of
foreground waits. These are API facts and causal explanations, not new bans.
Values frame the agent; the tool reference carries mechanics.

The SDK integration test exercises the production extension with the Codex model
and captures the actual stream context. A separate real Codex serializer probe
verifies exact instructions preservation and automatic tool choice. Both are
network-free; neither is a live provider-wire capture. The additional CLI capture
probe timed out without producing evidence and its temporary files were removed.

Evaluation history (all failures retained):
- Agent framing alone: 0/2 natural cases.
- Explicit turn mechanics: terminal passed, nested graph failed.
- Clarified separate-orchestrator request: both natural cases failed; Escape passed.
- Initial handoff helper: both natural cases failed (wrong profile/syntax and long wait).
- Precise capability/latency reference: first minimal pair passed; confirmation
  nested root polled, terminal and Escape passed. Minimal reasoning is unreliable.

The historical probes forced minimal reasoning, unlike Pi’s medium default and
this session’s inherited medium profile setting. `DIE_UX_THINKING=medium` permits
a direct comparison without changing production preferences or any latency,
delegation, interruption, or continuation assertion. The default probe remains
minimal for historical comparability. Both unchanged medium batches passed all three
cases (6/6): nested delegation, terminal redirection/continuation, and Escape
recovery. Leaf launch returns were 938 and 941 ms for 15,006 and 15,005 ms
commands. This validates the current medium configuration, not minimal reasoning.

Background detection now uses runtime ownership metadata rather than requiring
the model to print a particular JSON shape. A successful explicit handoff also
counts as a turn boundary, as verified by SDK batch-termination tests; terminal
redirection and latency requirements remain unchanged.

### Historical medium-configuration acceptance

Implementation is complete and validated for the tested medium configuration.
Minimal remains an explicitly failing stress case, not a claimed success. No
installation or production profile change was performed. The two successful
medium trials used single-call batches throughout; tightening the boundary
classifier to Pi’s all-results-yield rule leaves their outcomes unchanged.

Reproduce the current-configuration behavioral checks with:

```sh
DIE_UX_THINKING=medium DIE_RUN_LLM_TESTS=1 bun test tests/background-ux.test.ts tests/background-ux-tui.test.ts tests/background-interrupt-tui.test.ts
```

Medium nested evidence: `artifacts/ux/nested-1788588957631.json` and
`artifacts/ux/nested-1788589077106.json`. Terminal evidence is under
`artifacts/tui/background-ux-2026-09-05T06-15-57.634Z` and
`artifacts/tui/background-ux-2026-09-05T06-17-57.108Z`.

## Product-facing default prompt

The default prompt now uses the identity in `src/prompts/identity.md` and omits
Pi’s injected internal-documentation lookup block. This adaptation applies only
to the upstream default prompt: explicit custom system prompts, appended
instructions, project context, and tool guidance are preserved. SDK stream-context
tests assert that the model receives the cleaned prompt.

## Compaction prompt sources

- `src/prompts/compaction.md`: the checkpoint instruction appended after the
  prepared current conversation; includes summary/tail scope.
- `src/prompts/compaction-jobs.md`: deterministic running-job state appended when
  the checkpoint is saved, independent of what the model remembered to mention.

These fragments are embedded Markdown sources, not replacements for the normal
system prompt. Implementation and evidence: [compaction-research.md](compaction-research.md).

- `src/prompts/native-compaction.md`: editable native-checkpoint display notice.
  Opaque state is stored separately, never interpolated as prompt text. Saved
  checkpoint replay does not depend on the current wording of this notice.

- `src/prompts/compaction-prefix-scope.md` and `compaction-whole-scope.md`: scope
  instructions for mapped retained tails or whole-current-conversation summaries.
  Current preparation applies context filters before choosing scope; old request
  captures are cache diagnostics, not permission to compact.
