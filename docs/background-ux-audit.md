# Unified execute UX audit

## Scope

The original unified-tool live tests supplied exact helper code and explicitly
ordered the model to yield. They established transport correctness, not natural
stopping behavior. This audit separates model behavior from process lifetime.

Fixtures use temporary projects, real model sessions, and real tmux terminals.
Natural prompts do not tell the model which helper, wait budget, or yield rule
to use. Parent tests use GPT-5.6 Luna; descendants retain configured profiles.
Evidence is under artifacts/ux and artifacts/tui/background-ux-* (ignored local
artifacts), with tool calls/timestamps but without reasoning content.

## Reproduced failures before remediation

1. **Polling instead of yielding.** In the natural nested run, the parent made
   eleven additional execute calls after launch, predominantly inspecting the
   orchestrator. The slow-check leaf also polled and launched a process-wait
   shell loop. The underlying command did background after about one second.
   The parent even attempted to inspect worker IDs belonging to another session.
2. **Blocking through direct process APIs.** In the initial real-TUI scenario,
   the model used Bun.spawn and awaited p.exited. Independent notes were read
   inside that same execute call, but the conversation was held for 25 seconds.
3. **Blocking through an inflated foreground wait.** After selecting shell(),
   the model chose waitSeconds:30 for the 25-second check. Internal parallelism
   again did not return control to the conversation.
4. **Premature execution deadline.** A subsequent nested run yielded correctly,
   but the parent selected a 30-second orchestrator lifetime, insufficient for
   model startup, two workers, a 15-second check, and synthesis.
5. **Callback crash paths.** Source audit identified uncaught notification
   callback exceptions from timer/process-close handlers and disposed batchers
   accepting new work. These now have deterministic regression coverage.

## Changes

- Execute results now add a bounded background-handoff notice independently of
  stdout. It names launched background jobs and says to do independent work or
  end the turn, not poll/sleep. It remains present if code fails after launch.
  Inline results do not get this notice; helper promises still do not print.
- Guidance explicitly reserves external commands for shell(), keeps normal
  foreground budgets at their default or zero, and distinguishes each call's
  wait budget from a job's full execution timeout. Longer waits require an
  explicit user request for blocking.
- Guidance clarifies result.output, session-local job IDs, omitted-await behavior,
  stdin-dependent jobs, and the full cost of nested agent execution deadlines.
- Failed agent output is labeled diagnostic progress, not a final answer.
- Notification callback failures are logged without crashing the host or blindly
  retrying; disposed batchers no longer rearm timers.

## Validation

- Natural nested workflow: root → orchestrator → two fast workers. Checks prompt
  return, root and leaf yielding, no polling/wait loops, distinct worker completion
  batches, and eventual synthesis. A successful measured leaf returned after
  934 ms while its command ran for 15,005 ms.
- Natural real-TUI workflow: one 25-second command plus independent file reading.
  After remediation the single execute call returned in roughly 153 ms, the
  assistant yielded, answered a fresh arithmetic question before command finish,
  then resumed automatically once. Keyboard input appeared within 4 ms in that
  measured run.
- Deterministic tests cover default/zero wait wall-clock bounds, independent job
  timeouts, nonzero command results, cancellation of three concurrent bridge
  waits, exactly-once handoff, notice formatting, and callback failures.
- A separate real-TUI Escape probe exercises intentionally blocking execute,
  interruption, retained managed-job ownership, and later completion delivery.
  This probe passed, as did a final combined repeat of both natural workflows.
- Final deterministic suite: 140 passed. Typecheck/build, standalone smoke, and
  diff checks passed. The opt-in model tests are separate from that count.

## Semantics and remaining limits

- A yielded print/JSON process intentionally remains alive for its jobs. This is
  not an active model call or a model polling loop; TUI input is not held there.
- A background job awaiting stdin or running forever cannot complete merely
  because the model yields. Arrange input/closeInput, a justified timeout, or stop.
- Omitting await does not detach helper requests: worker teardown drains their
  promises. Use waitSeconds:0 instead. Explicit long waits remain supported.
- Abort/provider error/session shutdown are not successful completion paths.
  Shutdown discards pending notifications and stops managed jobs. Callback
  delivery failures are logged, not silently retried into duplicate messages.
- This is behavioral guidance plus immediate runtime feedback, not a sandbox or
  a proof that every model will always choose correctly. Keep the opt-in natural
  UX tests alongside deterministic lifecycle tests; do not substitute scripted
  prompts that tell the model to yield for this evidence.
