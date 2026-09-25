# Live as the main orchestrator: investigation

## Goal

User wants Live to replace the default main orchestrator opened by die. Same
prompt assembly, execute TypeScript tool/runtime/helpers, session, history,
permissions and jobs. Not a companion that sends work to a second main agent.
Favor ordinary async worker delegation. User authorized investigation and
experiments, including direct provider probes if needed.

No production behavior change, install or release is part of this phase.
No active mic or real user job is needed for these probes. Provider probes use
synthetic input and existing credential loaders. Never save keys. Keep direct
calls few, short and timed. Simulated execution is not proof of runtime reuse.

## Baseline captured

On 2026-09-25, main checkout at ac18d2d8e4c2bc1b15bbccbb5149af9950e35ed7:

    SHELL=/bin/sh bun scripts/prompt-preview.ts --mode orchestrator --message "Synthetic Live main-orchestrator feasibility check."

Output: [main-orchestrator-prompt-baseline.json](main-orchestrator-prompt-baseline.json).
This used the real production prompt assembly at the provider stream boundary,
with an isolated temporary project and no network. 8,279 system-prompt
characters, one execute tool, two transcript messages. External project files,
private conversation, saved jobs and global config were excluded. Temporary
paths in the snapshot are provenance, not durable working directories.

Prompt source is not just main-orchestrator.md. src/prompts.ts builds the base;
Pi adds context; src/agent/extension.ts before_agent_start adds collaboration
and root mode guidance while respecting custom base prompts. Reusing a copied
markdown file alone would not meet the goal. The preview helper provides a
safe normal-agent baseline for provider acceptance tests.

## Probe worktrees (all four jobs completed)

All probe worktrees start from that same commit. They last beyond this session.

- task_ae213ef7: shared execute runtime/session feasibility.
  Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ae213ef7
  Branch: die/live-orchestrator-shared-runtime-feasibi-ae213ef7
  Expected note: wisdom/live/main-orchestrator-runtime-investigation.md
- task_b9dae9b4: Gemini Live prompt/tool/direct-provider tests.
  Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_b9dae9b4
  Branch: die/live-orchestrator-gemini-execute-probe-b9dae9b4
  Expected note: wisdom/live/main-orchestrator-gemini-investigation.md
- task_a1b2bd47: OpenAI Realtime and GPT-Live wire tests.
  Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_a1b2bd47
  Branch: die/live-orchestrator-openai-protocol-probes-a1b2bd47
  Expected note: wisdom/live/main-orchestrator-openai-investigation.md

Parent owns comparing evidence, checking probes do what their reports claim,
and a single recommendation. Do not mistake protocol acceptance for working
tool use, or tool use with fixtures for shared main-session ownership.

## Questions to settle

1. Can each provider accept the normal prompt and execute schema, produce a
   call, consume its result, and continue while work runs asynchronously?
2. Can the existing execute runner be called under the correct root session
   without triggering a separate text-model main turn or scheduler?
3. How do normal context hooks, history entries, tool images/large outputs,
   job delivery, voice interruption, stop-work and live.stop fit that owner?
4. Can GPT-Live do actual client execution, or is its client-delegation
   protocol incompatible with the same direct execute surface?
5. Which parts are proven offline, proven against a provider, or still open?

## Review and values

The prompt review is in [prompt-line-review.md](prompt-line-review.md).
Line edits are paused while the simpler architecture is tested. Old voice-to-
main handoff wrappers may disappear rather than need wording changes.
Values unchanged: one owner, smallest working design, whole-path review and
honest evidence already cover this work. Update this note when probes finish.

## Runtime first result and follow-up

Shared runtime probe committed as ee37654 in task_ae213ef7 worktree. Parent
reviewed the test and note. It calls the real registered execute tool and TS
child/IPC path, but uses a fake worker response and a preexisting main-checkout
binary. Result: 1 pass / 8 assertions. This is reachability evidence only, not
source/binary parity or real async ownership proof. Do not present it as such.

Follow-up task_20f2563c starts from ee37654 to build a matching CLI and exercise
a harmless real async shell job through actual TaskManager/JobService and
execute, with later jobs.inspect. No production changes.
Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_20f2563c
Branch: die/live-runtime-probe-real-async-job-and-ma-20f2563c

Parent source check: Pi ExtensionContext exposes getSystemPrompt(), and
ExtensionAPI exposes active/all tool info. This helps capture current setup,
but alone does not replay before_agent_start/context hooks or establish a
voice turn. Existing completion delivery in src/agent/extension.ts sends
Pi sendMessage with steer + triggerTurn:true. A voice-main implementation must
route this through the same active owner rather than let it start a second
text main agent. Current host observations are not that continuation path.

## Results after parent review

### Proven offline

- The real root orchestrator prompt assembly can be captured without exposing
  private project context. Both final provider probes use that same assembly
  and its real execute schema: code, timeoutSeconds, outputByteLimit.
- The registered execute tool runs TypeScript through the existing child
  runner/IPC path. No second evaluator was built.
- A real isolated TaskManager/JobService bridge launches a harmless shell job
  asynchronously, returns its ID, and a later execute call reads completed
  output through jobs.inspect. Paging, output truncation and thrown errors
  were checked. This is a real shell job, not a real model worker.
- Parent reran the integrated runtime probe with the worktree-built CLI:
  2 tests passed, 22 assertions. Typecheck passed after correcting probe
  assertions to use the actual AgentToolResult shape. The first review run
  found five isError property type errors; none remain.

Runtime build used by the rerun:
/home/tnfssc/.die/worktrees/die-a86675007a5e-task_20f2563c/dist/die-probe
Source commit: 0e24186 (runtime production sources match the shared base).
Build: bun scripts/build.ts --reuse-web --outfile=dist/die-probe
It used a private copy of existing web assets, not a fresh web rebuild.

Parent rerun:

    SHELL=/bin/sh DIE_PROBE_EXECUTABLE=/home/tnfssc/.die/worktrees/die-a86675007a5e-task_20f2563c/dist/die-probe bun test ./tests/live-main-orchestrator-runtime.probe.ts
    ./node_modules/.bin/tsc --noEmit

### Provider findings

| Provider | Evidence | Verdict for main role |
| --- | --- | --- |
| Gemini Live | Existing function-call protocol and adapter; exact normal orchestrator prompt/schema captured offline | Plausible direct execute route; not connected-tested |
| OpenAI Realtime | Existing function_call/function_call_output protocol and adapter; exact normal orchestrator prompt/schema captured offline | Plausible direct execute route; not connected-tested |
| GPT-Live | Current public Live SessionConfig has no tools; client delegation sends IDs/timing, not task text or executable arguments | No documented native execute equivalent; do not disguise a second agent as parity |

OpenAI response.item.create and FunctionTool types belong to the separate
Responses delegation backend. They are not evidence GPT-Live itself can call
execute. Parent checked public source and saved selected excerpts/hash in
[main-orchestrator-openai-public-evidence.json](main-orchestrator-openai-public-evidence.json).
This is protocol evidence, not a server rejection of our test config.

### Direct-provider blocker

Both workers and parent checked the existing app credential service. Google:
missing, canImport true. OpenAI: missing, canImport false. No credential was
imported, changed, or obtained through an alternate path. No key was printed.
All four paid-mode attempts stopped before a socket connection. No paid
provider call occurred, and missing credentials is not provider rejection.
The user can configure a provider through Die's normal Live credential setup,
then rerun the probes; do not ask them to paste a secret into chat.

Commands and exact sanitized results:
[main-orchestrator-provider-attempts.json](main-orchestrator-provider-attempts.json).
Both probes have --offline and explicit --paid modes. Credential-unavailable
exits are skipped connected tests, not success. Provider calls use simulated
tool output only; they never evaluate provider-generated code or start jobs.
A marker returned only by the fixture lets a connected trial distinguish
result consumption from merely sending a tool response.

### Review corrections

The first OpenAI probe used a simplified prompt/schema; the first Gemini
probe captured root normal mode, not orchestrator mode. Parent corrected both
to use createPromptPreview({ rootMode: "orchestrator" }) and the actual execute
declaration, then reran offline and credential-gated paths. Current baseline:
8,279 system-prompt characters and one execute tool. Gemini no longer ends its
result-observation window as soon as a fixture reply is sent. Probes have
short deadlines/call caps; OpenAI does not keep tool_choice required after a
call. Connected scripts still need actual wire validation with credentials.

### Recommendation

Build one shared main-agent execution owner, with a voice provider as its
turn transport. Reuse ordinary prompt/context hooks, registered execute,
branch history and job service. Do not add a second main agent, copied prompt,
separate JS evaluator or six-tool delegation facade. Worker subagents remain
normal background jobs. Gemini Live and OpenAI Realtime are the candidates;
GPT-Live cannot be claimed equivalent on its documented client protocol.
Do not replace the default until a real connected end-to-end trial passes.

The key implementation work is not the execute declaration. It is wiring:
1. the effective per-turn prompt/context and tool lifecycle;
2. one main-turn owner across voice, text, reconnect and session changes;
3. normal history/tool results, including images and large-output artifacts;
4. job completion/attention delivery back to that owner, not a text-model
   side turn. Keep voice interruption separate from job cancellation.

### Still unproved

Actual provider schema acceptance/calls/results, overlapping speech and tool
work, audio triggering, permission UI, real model workers, root Pi history
and completion delivery, compaction/reconnect, images and large results on
provider wires. The two runtime tests do not establish these. Existing Live
16 KiB result caps need review against ordinary execute output; copying the
tool declaration alone does not preserve tool-result semantics.

## Saved work and values

Integrated probe commits: 56b2c83, 8833473, faf2824, 1eca227. Parent refinements
and all review decisions are in the current checkout with the probes/notes.
All worktree paths above remain available; no install, release or production
source change occurred. Only investigation code, evidence and wisdom changed.

Values unchanged. Existing one-owner and honest-proof guidance caught the
important gaps: fake job replies and schema acceptance cannot prove a shared
main-agent lifecycle. This investigation applies those values rather than
adding another one.

## Scope update

User approved production implementation and asked for a release when done.
See [main-orchestrator-implementation.md](main-orchestrator-implementation.md)
for active worktrees, acceptance criteria and release ownership.
