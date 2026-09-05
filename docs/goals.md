# Goal mode

Goal mode is an opt-in way to keep one objective and its acceptance criteria in the
active session branch. It supplies persistent state to each model turn and can request
another turn after the agent settles. It does not prove that the objective is correct,
make provider behavior deterministic, or turn model-written evidence into independent
verification.

## Start and control a goal

In the interactive TUI, set a goal with explicit criteria and constraints:

```text
/goal set Create the report --criteria report.md exists; links were checked --constraints do not publish; keep source files unchanged
```

Semicolons separate criteria and constraints. The slash form requires both segments;
criteria are required, and use `none` when there are no constraints. Goal mode begins only after `/goal set`; ordinary sessions do not get automatic
goal continuations.

| Command | Behavior |
| --- | --- |
| `/goal` or `/goal status` | Display the current branch's goal and status. |
| `/goal pause [reason]` | Persist a paused state and stop automatic continuation. |
| `/goal resume` | Persist an active state and request a continuation. |
| `/goal clear` | Append a durable clear marker on the current branch. |

Goal records are custom entries in the normal session JSONL. They survive process
restart and follow Pi's branch semantics: navigating to another branch restores the
latest valid goal entry on that branch. A malformed or unsupported newer goal entry
fails closed rather than reviving older state.

## Helpers available to the agent

Goal helpers are available only inside `execute`, alongside `shell`, `subagent`,
and `jobs`:

```ts
const current = await goal.get();
await goal.set({
  objective: "Create the report",
  criteria: ["report.md exists", "links were checked"],
  constraints: ["do not publish"],
});
await goal.update({ status: "active", progress: "Drafted report.md" });
await goal.update({ status: "waiting", pendingJobIds: [job.id] });
await goal.update({ status: "blocked", blocker: "Missing source data" });
await goal.update({ status: "paused", reason: "Needs user review" });
await goal.update({ status: "completed", evidence: "Read report.md and checked 12 links" });
await goal.clear();
```

`goal.get()` returns the current goal or `null`. `goal.set()` replaces it with a
new active goal. `goal.update()` requires a status and status-specific fields:
completion requires `evidence`, blocking requires `blocker`, waiting requires
`pendingJobIds`, and pausing accepts `reason`. An active update may add one
`progress` milestone. `goal.clear()` removes the active goal by appending a clear
entry.

Waiting accepts only currently running job IDs owned by the same agent process. An
explicit `handoff()` while an active goal has running jobs automatically records all
those jobs and changes the goal to `waiting`. When an owned job settles, the goal
returns to `active` and continuation can resume. Jobs themselves are process-owned,
not reconstructed from JSONL: resuming a session whose goal was waiting pauses it when
those IDs are unavailable. Inspect what remains and use `/goal resume` only when it is
safe to continue.

## Evidence and automatic-continuation limits

Goal state is bounded so it cannot become an unbounded evidence store:

- objective, criterion, constraint, completion evidence, blocker, and pause-reason
  fields are at most 4,000 characters each;
- criteria and constraints contain at most 20 entries each;
- up to eight distinct progress milestones are retained, each at most 500 characters;
- the aggregate textual goal payload is at most 12,000 characters.

These are storage limits, not quality guarantees. Completion evidence is a concise
model-authored claim. Verify important acceptance criteria with tests, file inspection,
or external review. Repeated automatic turns that make no meaningful state progress
are paused, as are interrupted turns and queued user intervention.

## Running jobs, attention, and resume

Use `/ps` in the TUI to view jobs currently running in this session. It shows a
bounded recent-output preview and offers an explicit stop action; it does not claim that
a quiet process is hung. For exact programmatic inspection, use `jobs.list()` and the
cursor-based `jobs.inspect()` helper.

The job-attention defaults are:

- a quiet checkpoint after **5 minutes** without observed activity;
- a review checkpoint every **10 minutes** while a job remains running;
- `jobs.snooze(id, minutes)` for a positive delay of at most **55 minutes**;
- `jobs.setWatch(id, false)` to disable attention for an expected persistent service,
  and `jobs.setWatch(id, true)` to re-enable it with a fresh grace period.

Attention messages contain bounded observations and recent output; jobs continue
running until they finish or are explicitly stopped. These intervals are current
built-in defaults, not a provider liveness signal.

`/resume` restores durable conversation and goal entries. It does not revive shell
processes or sub-agent processes from an earlier die process. Child sessions retain
their saved role/depth restrictions and are visibly labeled in the TUI picker.

## Mode and cache indicators

`/mode fast|normal|orchestrator` changes the main agent's session-scoped instruction
frame. It does **not** switch the selected model, alter the thinking level, or grant a
child different delegation capabilities. The mode selection is durable on the active
session branch.

The footer's `cache est` countdown and `/cache-ttl` are informational. The default
TTL estimate is one hour; accepted values range from one minute to seven days and are
stored in `~/.die/cache-settings.json`. A recorded provider request and a positive
countdown do not establish cache creation, compatibility, retention, a cache hit, or a
lower bill.

## Validation scope

Deterministic store, SDK, and TUI fixtures verify the lifecycle and persistence
contracts without claiming model quality. The real-model goal smoke fixture is gated by
`DIE_RUN_LLM_TESTS=1`, makes paid requests only when explicitly enabled, and records a
bounded run artifact. A passing smoke run demonstrates that one configured model
completed one harmless temporary-file scenario; it is not evidence that arbitrary
goals will complete correctly.
