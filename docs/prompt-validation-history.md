# Prompt validation history

Historical evidence from September 5, 2026, preserved from `docs/prompts.md`. References to "current", "next", examples, and candidate wording below describe those experiments, not today's prompt. Start with [the prompt editing guide](prompts.md) for new work and [the source map](system-instructions.md) for current assembly. Passing assembly tests never established that a model would follow the guidance. Failed behavioral runs remain evidence.

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

The concise values in `system.md` frame the agent in `before_agent_start`. API mechanics live in `execute.md`. Explicit user system prompts retain their existing override behavior; child identity/capability facts are preserved. Natural validation is in progress.

### Turn protocol, not a prohibition

The execute reference explains a concrete interface fact: an assistant response
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


## 2026-09-13: user-reviewed simplification (offline validation)

The user reviewed the model-facing prose in small coherent chunks, preferring plain behavioral intent and deletion of redundant instructions. The review covered shared values, identity, execute guidance/description, root modes and child roles, handoff notices, goals, memory guidance and consolidation assignments, compaction, and TypeScript-authored prompt scaffolding/advisories. Current canonical wording is linked from [Model input source map](system-instructions.md).

The review also produced targeted runtime changes: shell stdin closes by default through the helper; project-memory locks were removed; showImage replaces emitImage without an alias, drops GIF, and resizes oversized supported images; long execute text is saved to files; plaintext compaction summarizes the whole prepared conversation while preserving the recent tail; and goal waiting inputs are now runtime-owned rather than supplied through goal.update. Explicit handoff already provided automatic waiting and still does; ordinary replies were not given new waiting behavior. Memory consolidation now announces in the UI that it runs in the background and the user can keep working.

Final batch verification:
- 69 focused prompt/SDK/notification/schema/execution tests passed.
- Full offline suite: 559 passed, 14 skipped, 0 failed.
- Typecheck, build, formatting check, and git diff check passed.
- Offline production assembly retains every execute guidance item and the full provider tool definition while excluding the removed base inventory/custom-tools notice. Schema input types, requiredness, and timeout minimum remain intact.
- Memory launch/receipt integration and literal-safe template substitution passed separately; the nonblocking test holds a managed worker running while the command and subsequent conversation hook return.

These are functional, assembly, and serialization checks, not live model-behavior evidence. Earlier paid trials above describe earlier prompt/configuration versions and do not establish the behavior of this revision. No new paid/live-model trials or installation were performed.

## 2026-09-13: subsequently authorized live pass

The user explicitly approved one small live pass after the offline review. Four scenarios ran once against existing dist/die (SHA-256 fec2dae4421fcdc2975d1032b76c307cd1d9338e3cd287c78b6520fec8f2577f). Test roots were openai-codex/gpt-5.6-luna with medium thinking; configured children were fast Luna, normal Sol, and orchestrator gpt-6-astra, inheriting medium. This is not evidence for the outer coding session's Sol/high configuration. No rebuild, installation, production prompt edit, or paid retry occurred.

### Delegation and ordinary handoff: both failed

The existing nested fixture formed the correct graph (one separate orchestrator, two fast leaves), completed its 15.112-second check, delivered the expected completion counts, and ultimately reported PASS accurately. The orchestrator used handoff correctly. However, the root and slow leaf repeatedly slept and inspected jobs instead of yielding before completion. Root launch returned in1.312seconds and leaf launch in1.343seconds: launch latency was not the problem. First root stop was20.835seconds after check completion; slow-leaf stop was10.826seconds after completion.

The collector also treated .jobs.jsonl sidecars as possible root sessions. Inspecting actual parent.jsonl fixes that interpretation, but does not rescue the missing-yield behavior. This capture defect remains to be corrected before reuse; no assertion was weakened and no paid rerun was made. Evidence: artifacts/ux/nested-1789318571525.json.

The terminal fixture explicitly chose shell waitSeconds30 for a25-second check, holding execute for25.461seconds. Independent note output was withheld until that call returned. No pre-completion yield occurred; the later arithmetic-responsiveness and exactly-once continuation stages were therefore not exercised. Evidence: artifacts/tui/background-ux-2026-09-13T16-55-16.264Z/.

### Automatic goal waiting: behavioral failure and scope incident

A natural /goal set request ran a28.003-second fixture and requested independent note inspection and timestamp verification. The model did not call handoff, polled the running job with7- and10-second sleeps, and inspected the note only after completion. Goal state stayed active revision1 throughout the observed run: runtime waiting/reactivation and goal completion were not exercised. No manual waiting API attempt or provider failure was observed. This is not evidence that the handoff-triggered runtime transition itself is broken.

The model then performed a broad process search and issued TERM against3260415/3383552 and KILL against3260415/3383657, outside the fixture scope. This was not authorized cleanup. The parent disclosed the incident and prohibited further live launches. All three PIDs were absent at the parent check. The preserved target command matches the descendant-cleanup fixture in tests/typescript-execution.test.ts, but the old PID's ownership/origin is not independently established; no restart was attempted. Directory-isolated test projects were not process sandboxes. Choose real process isolation before further model-driven experiments on this host.

Goal evidence: artifacts/tui/automatic-goal-waiting-2026-09-13T17-01-53.279Z/. The first sanitizer missed task-complete custom entries; notifications are visible in preserved TUI frames, so its zero notification count is not evidence of nondelivery. Broad process-list output was redacted.

### Memory consolidation: observed behavior passed, harness postprocessing failed

The real built-in /memory consolidate normal command displayed its automatic background notice49ms after submission. Arithmetic was submitted7ms later and accepted into the root session in4ms. Root Luna answered42 in3.145seconds; the Sol worker remained alive at least36.522seconds after the answer was observed. There was one distinct launch notice and no extra root model turn merely to announce launch. Completion reported8 snapshots consumed,0 retained; markers first appeared after the worker's final reply and last-live observation.

Output index linked three concise topic files. Seeded decisions, rejection directions and reasons were preserved and duplicates merged. Caveat: the existing project-purpose sentence (Atlas is a cross-platform release assistant) was reduced to a title, not fully retained. One fish-incompatible worker shell loop failed and recovered within the same run through filesystem APIs.

The harness exited1 with ReferenceError: inputObservedWhileWorkerAlive is not defined during post-run assertion assembly, after evidence/output capture and completion. Parent reviewed the preserved timings and resulting notes; this supports the observed behavior, not a claim that the harness exited cleanly. Offline classification is PASS_WITH_HARNESS_POSTPROCESS_ERROR; there was no live retry. Frames have deferred preservation-time headings, so use evidence.json event timings. Evidence: artifacts/tui/memory-consolidation-live-2026-09-13T17-03-29-338Z/.

All fixture roots/workers and their unique tmux servers were cleaned up. No further live calls or installation are authorized by this completed pass. The revised configuration has not passed the handoff/goal behavioral checks.

## 2026-09-13: v0.2.6 release validation

The user accepted the reviewed design without compensating for Luna-specific handoff failures; future behavioral checks should target Sol/Astra. No additional behavioral experiment was run for this release.

Thinking summaries now render without blank prose gaps, including within a streaming block; user-message outer padding is removed. Source messages and internal user Markdown whitespace remain unchanged. Real Pi rendering fixtures cover streaming, boundaries, mouse coordinates, and restoration.

After explicit build/install/push/release authorization, local release validation passed: format check, lint (warnings remain), typecheck, build, 571 offline tests with 14 expected skips and zero failures, standalone smoke, production notices generation, and diff checks. One existing provider-prompt test formatting mismatch was corrected. Version 0.2.6 was installed to ~/.local/bin/die and its SHA-256 matched dist/die. Private project notes and ignored test artifacts are excluded from the release commit.
