# Remote workspace placement probes

Bounded experiments, not a feature, service installer, or SSH implementation.
**Local evidence only.** No SSH hosts/config, credentials, global services, or public listeners.

## Run the A/B placement comparison

From the repository root, with its locked dependencies and Bun on PATH:

```sh
bun run prepare:assets
bun experiments/remote-workspaces/demo.ts
```

The demo uses a short `/tmp` socket path for Unix socket compatibility on macOS. It
creates disposable private fixture directories, starts two independent local runtime
processes over owner-only Unix sockets, asserts results, then terminates its processes
and removes the fixtures. On macOS and Linux (uses /bin/sh and Unix sockets).
No compiled die binary or model/provider access needed.

Expected summary:

```text
EVIDENCE: LOCAL separate processes + private Unix socket; NOT SSH, NOT an LLM
A: explicitly detached while shell running; no viewer attached
A reconnect: {"agent":"completed","starts":1,...,"duplicate":true}
B: link closed while shell running; local scripted controller suspended
B reconnect: {"job":"completed","remoteAgentStarts":0,"nextTurnWhileDetached":false,...}
B: abandoned response reconciled by ID; second execute side effect exactly once
PASS: target fs + shell; A controller continues; B only job continues; status/output reconnect; no duplicate effects
```

## What it exercises

- Real die executeIsolated and source runner, including top-level imports,
  ordinary async/sync node:fs.stat, reads, Bun.file, dynamic target module imports.
- Real die TaskManager and execute's IPC job bridge for shell().
  Minimal test-only shell adapter (not the full JobService). Shell cwd is the target.
- Real Pi 0.87.1 Server, Unix transport, handshake, session attach/detach;
  upstream testing client and session catalog. No homegrown framing or TCP service.
- A places a deterministic two-turn controller with the runtime. It launches a shell,
  waits for feedback, inspects output, then issues another execute while detached.
- B places that controller in the demo client. Its remote shell completes after link
  close, but there is no second turn until the local controller reconnects and resumes.
  This tests suspension, not a magical consequence of disconnection: a live local agent
  could keep thinking from available context, but cannot make new target calls offline.
- Reconnect inspects the existing task ID, reads output with offsets, and repeats stable
  execute IDs while in flight and after completion. An abandoned response is retried by
  the same ID. Different code under an existing ID is rejected. Side effects occur once.

## Actual agent loop, offline fake model

```sh
bun run build  # if dist/die is not already built
bun experiments/remote-workspaces/rpc-agent-demo.ts
```

This second experiment uses the real die RPC agent, execute tool, and shell job helpers.
A loopback-only deterministic SSE provider emits two execute calls across three model
turns, checking that each actual tool result reaches the next turn. There is no real
provider/model request. Isolated HOME and agent configuration select only that fixture.

A separate viewer process exits while the first execute is still active. The controller
retains the agent RPC connection and logs its output. A new viewer reads completed status
and both tool results while the agent process is still alive. Exactly one prompt was sent
and acknowledged; reconnect does not send it again. This is controller-owned persistence,
not survival after the controller exits. File-backed viewers are not a production attach
API; actual session transport attach/detach is covered by the first demo. Fixtures and
loopback listener are cleaned up. Expected: JSON with result PASS, modelTurns 3, and two
toolOutputs (target marker/shell cwd, then DIE_OPTION_A_SECOND_EXECUTE_OK).

The ordinary build may prepare/fetch the pinned T3 web checkout and dependencies if absent;
it is not necessary for the source-runner A/B demo. An already-built compatible dist/die
can be reused for this actual-agent demo.

## Files / interactive exploration

- runtime.ts SOCKET TARGET_DIRECTORY: persistent test runtime. Lives until SIGTERM,
  not until its last presentation disconnects. Socket should be inside a private directory.
- client.ts SOCKET start-agent: A's controller; repeated calls do not start it twice.
- client.ts SOCKET start-B B-turn-1: one remote execute, not a remote agent.
- client.ts SOCKET status / client.ts SOCKET inspect TASK_ID: attach, inspect, detach.
- client.ts SOCKET finish-B B-turn-2: explicitly resume B's second turn.
- Prepare target with identity.txt and target-module.ts (export identity).
  Run files with bun experiments/remote-workspaces/FILE.ts ....

## Next real SSH trial (NOT run here)

Only after a host is explicitly authorized, a minimal A product-fit trial is:

```sh
ssh -t YOUR_AUTHORIZED_HOST
# On that host, with a compatible die already installed:
cd /path/to/project
tmux new-session -s die-work
die
# Detach with Ctrl-b d; reconnect over SSH, then:
tmux attach-session -t die-work
```

This requires remote model access/credentials and places history remotely. SSH keys stay
local. Do not treat this untested recipe as proof of die's PTY/hangup, Live/microphone,
subagent, or shutdown behavior. No SSH command is invoked by the demos.

## Deliberate limits

A's controller here is scripted, **not an LLM agent**. These local processes share one
OS/user/filesystem; distinct inode/cwd/markers demonstrate execution placement, not
remote machine isolation or SSH behavior. No real dropped SSH connection, host reboot,
network partition, remote install, cross-OS, provider access, or SSH key handling tested.

Runtime maps/TaskManager are in-memory. Deduplication is **only for this live process**;
a restart loses status and IDs. There is no exactly-once guarantee across a crash.
Do not blindly replay a mutation against a new runtime. Explicit shutdown stops jobs;
client detach does not. The probe is trusted local test code, not an authenticated RPC
surface for arbitrary callers; it intentionally supports only a tiny operation set.
Subagents, Live, image transfer, cancellation/reconnect races and full history sync are
not implemented. Existing production notification ACK ownership is not reproduced by
this adapter. Maximum 32 executes per runtime, 10-second execute/job deadlines.

See [wisdom](../../wisdom/remote-workspaces/ssh-prototype.md) for findings and next steps.
