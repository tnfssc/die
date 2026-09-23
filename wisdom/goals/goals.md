# Goal mode

Goal mode is opt-in. It keeps one objective and acceptance criteria in active
session branch. Each model turn gets saved state. It can ask for another turn after
agent settles. It does not prove objective is right or make provider deterministic.
Model-written evidence is not independent proof.

## Start and control a goal

In the interactive TUI, set a goal with explicit criteria and constraints:

```text
/goal set Create the report --criteria report.md exists; links were checked --constraints do not publish; keep source files unchanged
```

Semicolons split criteria and constraints. Slash form needs both segments.
Criteria are required. Use `none` when no constraints. Goal mode starts when goal
is set through `/goal set` or helper below. Ordinary sessions get no automatic goal
continuations.

| Command | Behavior |
| --- | --- |
| `/goal` or `/goal status` | Display the current branch's goal and status. |
| `/goal pause [reason]` | Persist a paused state and stop automatic continuation. |
| `/goal resume` | Persist an active state and request a continuation. |
| `/goal clear` | Append a durable clear marker on the current branch. |

Goal records are custom entries in normal session JSONL. They survive process
restart. They follow Pi's branch semantics. Moving to another branch restores latest
valid goal entry there. Malformed or unsupported newer goal entry fails closed. It
does not revive old state.

## Helpers available to the agent

Goal helpers work only inside `execute`, next to `shell`, `subagent`, and `jobs`.
Model guidance lives in `src/prompts/goal.md`. It comes with goal state only when goal
exists, including non-active states. `/goal set` lets user start it without API
instructions in every normal chat. Start, update, and clear do not change system prompt
or tool definitions. Only goal context message changes. This keeps system prefix. It
does not promise provider cache hit.

Helpers:

```ts
const current = await goal.get();
await goal.set({
  objective: "Create the report",
  criteria: ["report.md exists", "links were checked"],
  constraints: ["do not publish"],
});
await goal.update({ status: "active", progress: "Drafted report.md" });
await goal.update({ status: "blocked", blocker: "Missing source data" });
await goal.update({ status: "paused", reason: "Needs user review" });
await goal.update({ status: "completed", evidence: "Read report.md and checked 12 links" });
await goal.clear();
```

`goal.get()` returns current goal or `null`. Runtime-owned `waiting` status and
`pendingJobIds` stay visible as read-only state. `goal.set()` replaces it with new
active goal. `goal.update()` needs one model-owned status: `active`, `blocked`,
`paused`, or `completed`. Completion needs `evidence`. Blocking needs `blocker`.
Pausing accepts `reason`. Active update may add one `progress` milestone. Runtime
owns waiting bookkeeping, so manual `waiting` status and `pendingJobIds` inputs fail.
`goal.clear()` removes active goal by appending clear entry.

Successful explicit `handoff()` with active goal and running jobs saves all owned
running IDs. Goal changes to `waiting`. This is only automatic path to waiting.
Ordinary replies do not trigger it. Runtime does not guess dependencies on persistent
services or other jobs. Any tracked job settles? Goal returns to `active` and can
continue. Jobs belong to process. JSONL does not rebuild them. Resume session with
waiting goal but missing IDs? It pauses. Check what remains. Use `/goal resume` only
when safe.

## Evidence and automatic-continuation limits

Goal state is bounded so it cannot become an unbounded evidence store:

- objective, criterion, constraint, completion evidence, blocker, and pause-reason
  fields are at most 4,000 characters each;
- criteria and constraints contain at most 20 entries each;
- up to eight distinct progress milestones are retained, each at most 500 characters;
- the aggregate textual goal payload is at most 12,000 characters.

These limit storage, not promise quality. Completion evidence is short model-written
claim. Check key acceptance criteria with tests, files, or outside review. Repeated
automatic turns pause when no new explicit, checked progress milestone. Waiting-state
changes and revision bumps do not count as milestone evidence. Interrupted turns and
queued user input pause automatic continuation too.

## Running jobs, attention, and resume

Use `/ps` in TUI to see jobs running in this session. It shows limited recent output
and direct stop action. It does not call quiet process hung. Need exact programmatic
check? Use `jobs.list()` and cursor-based `jobs.inspect()`.

The job-attention defaults are:

- a quiet checkpoint after **5 minutes** without observed activity;
- a review checkpoint every **10 minutes** while a job remains running;
- `jobs.snooze(id, { minutes })` for a positive delay of at most **55 minutes**;
- `jobs.setWatch(id, { enabled: false })` to disable attention for an expected persistent
  service, and `jobs.setWatch(id, { enabled: true })` to re-enable it with a fresh grace
  period.

Attention messages have limited observations and recent output. Jobs keep running
until done or stopped. These intervals are current built-in defaults. They do not show
provider liveness.

`/resume` restores saved conversation and goal entries. It does not revive shell or
sub-agent processes from older die process. Child sessions keep saved role/depth limits.
TUI picker labels them.

## Mode and cache indicators

`/mode fast|normal|orchestrator` changes main agent session instruction frame. It
does **not** switch chosen model, change thinking level, or give child new delegation
powers. Fast and normal both add no extra guidance. Orchestrator adds coordination
guidance. Mode choice stays saved on active session branch.

Footer `cache est` countdown and `/cache-ttl` are only information. Default TTL
estimate is one hour. Accepted values run from one minute to seven days. They live in
`~/.die/cache-settings.json`. Recorded provider request and positive countdown do not
prove cache creation, compatibility, retention, hit, or lower bill.

## Validation scope

Deterministic store, SDK, and TUI fixtures check lifecycle and persistence contracts.
They make no model-quality claim. Real-model goal smoke fixture needs
`DIE_RUN_LLM_TESTS=1`. It makes paid requests only when directly enabled. It records
limited run artifact. Pass means one configured model completed one harmless temporary-
file case. It does not show any goal will finish right.
