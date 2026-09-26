# SSH workspace placement: bounded local prototypes

2026-09-26. Prototype/research only; no production integration, no merge.

## Resume here

- Worktree: /Users/sharath/.die/worktrees/die-f528e86af6b5-task_3515c928
- Branch: die/prototype-persistent-remote-workspace-3515c928
- Code/commands: [experiments/remote-workspaces](../../experiments/remote-workspaces/README.md).
- Prior research copied from the parent into [ssh-research.md](ssh-research.md). Read values before work and checked them again before handoff.
- Discovery worker: /Users/sharath/.die/worktrees/die-f528e86af6b5-task_3515c928-f528e86af6b5-task_3ded1446,
  branch die/discover-remote-session-reuse-3ded1446 (research only, no edits).
- Actual-agent offline probe worker: /Users/sharath/.die/worktrees/die-f528e86af6b5-task_3515c928-f528e86af6b5-task_946f2a5e,
  branch die/offline-actual-agent-disconnect-probe-946f2a5e.

## Discovery before implementation

The existing executor spawns a fresh runner with cwd and a private job IPC bridge
(src/typescript/execution.ts, runner.ts, job-bridge.ts). TaskManager owns processes,
completion and bounded output (src/tasks/task-manager.ts). This is the correct unit to
place remotely; forwarding only shell leaves ordinary fs/Bun/imports local.

The installed Pi 0.87.1 server already supplies framed Unix transport, version handshake,
session attach/detach and per-presentation capabilities. Used Server/createUnixListener
and its testing client/catalog for this probe rather than a second framing protocol.
This is not a shipped die remote-workspace transport. SessionHost in src/session is an
in-process scoped authority/observer, not a network client. Its full task/notification
semantics are intentionally not reconstructed by the tiny probe shell adapter.

Other reusable paths: die --mode rpc (integrations/t3/gates/rpc-smoke.ts), pinned T3
PiRpc process transport and ProviderSessionManager leases (integrations/t3/upstream/die.patch).
The normal web launcher binds loopback and has browser-specific local Host/Origin checks;
it is not authorization to expose a remote daemon. Its upstream source is a pinned
checkout/build dependency, not another complete server implementation under src/t3.
The RPC gate provides a safe deterministic fake SSE model. Usual real-model tests are
opt-in (DIE_RUN_LLM_TESTS); no real provider requests or credential inspection were needed.

## Facilities / early blockers

Bun 1.4.2, ssh/sshd, tmux and Docker CLI available. Docker daemon absent
(unix:///var/run/docker.sock missing). No port-22 listener observed. No authorized real
SSH host; did not inspect SSH config for targets, connect anywhere, enable sshd, change
SSH config, install global services or open public ports. Used private temporary fixture
directories, separate local processes and Unix sockets. Dependencies reused from parent's
existing node_modules via a local symlink (removed after verification); normal prepare:assets generated ignored assets.
The later actual-agent build also fetched the repository-pinned T3 checkout and prepared
its local dependency/cache tree. That is ordinary build network traffic, not a model/SSH
host test. No dependency manifests/locks or global services changed.

## Verified A/B placement experiment

Run: bun run prepare:assets; bun experiments/remote-workspaces/demo.ts

On macOS, local marker LOCAL-CLIENT had inode 381695662. A target marker TARGET-A had
inode 381695664; B TARGET-B had inode 381700091 (run-specific). Ordinary async stat,
statSync, node readFile and Bun.file returned target identity, dynamic import loaded the
target module, shell printed target cwd. No filesystem mocking/proxy/path rewriting.
Canonicalized /tmp -> /private/tmp after first assertion exposed macOS's path alias.

A's deterministic remote controller: start -> execute launches shell -> detach -> job
completes -> controller observes target-ready output -> second execute writes one marker.
Reconnect: completed, agentStarts=1; duplicate starts while in flight/after completion
return existing work. One shell effect, one controller effect.

B's local deterministic controller: submit execute -> close link -> remote shell completes.
Reconnect: completed shell, remoteAgentStarts=0, no second execute/controller effect.
The local driver then explicitly resumes from output. This models a suspended controller;
it does NOT mean a still-running local agent cannot think while disconnected.

Status/inspect work over new attachments, shell output reads by existing ID and byte offset,
next-offset returns empty suffix. Same execute ID replays in flight/after completion do
not repeat effects; changed code under same ID is rejected. Abandoning a response and
retrying the same ID also yielded one effect. Acceptance can be unknown to a disconnected
client; the live runtime's map resolves it. These are not durable exactly-once semantics.

Direct strict typecheck of experiment files plus src/assets.d.ts passed using repository
tsc (--ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module Preserve
--moduleResolution Bundler --types bun). Full production build/test suite is not an
acceptance claim for these isolated experiments.

## Actual agent loop: separate offline verification

Cherry-picked worker commit 5170c4fbd174248e9f437b818771117ae6a31de9 as f192584,
then reviewed/adapted it: atomic status writes, bounded stderr, strict types, assert viewer
leaves before the first execute ends, reconnect while the agent process is still alive,
and cleanup disposable fixtures. No changes to the production agent loop.

Commands: bun run build; bun experiments/remote-workspaces/rpc-agent-demo.ts

Observed PASS: detachedAt=20, agentEvents=62, modelTurns=3. First real execute stat/Bun.file
returned DIE_OPTION_A_TARGET_MARKER and target cwd; real shell returned
DIE_OPTION_A_SHELL_OK. Second execute returned
DIE_OPTION_A_SECOND_EXECUTE_OK:DIE_OPTION_A_TARGET_MARKER. The deterministic loopback SSE
fixture asserts each actual tool result occurs in the next model request. Exactly one
prompt acceptance and one agent_end; a new viewer retrieves both outputs without sending
a prompt. This is the real die RPC/execute/job loop, but the model is fake and transport
is local. It proves more than a surviving shell, not autonomous real-model reasoning.

The controller owns the RPC stdin/stdout and survives the separate viewer's exit. Viewers
read atomic status and bounded event files, not a production network attach API. The A/B
probe above separately verifies the actual Pi server attach/detach transport. Neither
proves SSH or owner-process crash survival. Together they support placement/ownership
choices without building a new remote product in the experiment.

Build passed; strict experiment typecheck passed after worker integration. Production
suite not rerun (no production source changed). Real provider tests were not run.

## Recommendation (conditional, not a newly invented requirement)

Both A and B satisfy ordinary-execute placement when the ENTIRE JS runner and job runtime
move to the target. A is the smallest coherent first product if remote provider access and
remote session/history are acceptable. A remote terminal in tmux is the smallest initial
UX to validate, with an SSH-attached local terminal; it avoids a second job scheduler.
For a structured local UI, reuse the existing RPC/session transports but keep the remote
agent's owner independent of the attaching client. Never promise persistence from plain
ssh -t alone: PTY hangup and die shutdown must be tested.

Choose B only if local model credentials, local UI/voice or local session ownership are
important enough to justify split authority. It needs a version-matched remote execute +
job service, stable host/session/invocation identities, output retrieval and explicit
unknown/accepted/running/done states. Local agent can keep working only while its own
process survives; a remote shell continuing is not an ongoing remote agent. Subagents
also need a placement/credential decision. Do not transparently proxy fs modules or
market shell-only SSH as a remote workspace.

User said “keep working”; disconnect survival is promising, still unconfirmed. Ask whether
that means closing the client/laptop, running long tools, or merely nonblocking interaction.
Also decide local UI/Live requirements and whether remote credentials/history are allowed.

## Limits / next bounded step

Same machine/user/kernel and filesystem namespace. Distinct directories demonstrate
placement, NOT remote-machine security/isolation. No real SSH transport/drop, restart,
remote install/version negotiation, host-key/agent forwarding, cross-OS or offline remote
network tested. Controller in the A/B comparison is explicitly scripted, not a model.
Dedup/status/TaskManager state is memory-only: runtime crash/restart invalidates IDs and
may leave work unknown. Shutdown is not detach. No service is installed by these demos.

Next: with an explicitly authorized localhost SSH fixture or test host, validate remote
install/cwd, unchanged fs/Bun/import calls and actual SSH link loss, then reconnect to the
same runtime identity without replaying the prompt. Test client death separately from
runtime death. If restart recovery is required, reuse existing invocation/launch-ledger
ideas (src/t3/tasks/launch-identity.ts) but do not claim those already solve whole
execute replay. Implement only the chosen product shape, not both as a new framework.

Values unchanged: truthful evidence, one owner, stable IDs/reconciliation and using the
simplest existing boundary already cover these lessons. Added feature-specific wisdom.

## PR preparation (2026-09-26)

- Final worktree: `/Users/sharath/.die/worktrees/die-f528e86af6b5-task_7a2ffa64`; branch: `die/pr-remote-workspace-research-and-prototy-7a2ffa64`; base: `origin/develop` at `eb56ca2`. Historical prototype worktree above retained for provenance.
- Cherry-picked only the two prototype commits; copied the relevant parent `ssh-research.md` into this feature wisdom. No production code or voice fix changed. The research remains advisory; this PR implements neither SSH transport nor a remote service.
- Reviewed disposable fixture cleanup, private local sockets, fake loopback model credentials, bounded event handling and no external listeners. Changed the actual-agent fixture to use system temp directory; kept short `/tmp` path for the Unix-socket A/B demo on macOS. Removed parent-machine research path from runnable context.
- On this macOS worktree: `bun install --frozen-lockfile`, `bun run build`, both commands in the experiment README passed. A/B probe reported local target fs/shell, detached owner continuation and explicit B suspension; actual-agent probe reported PASS with three fake model turns and two execute tools. These are local process observations, **not real SSH/provider proof**. Direct strict experiment `tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module Preserve --moduleResolution Bundler --types bun experiments/remote-workspaces/*.ts src/assets.d.ts` passed. Markdown links and `git diff --check` passed. Biome check does not process `experiments/**` by repository configuration (zero files, exit 1), not a code-lint result. No production test suite or real remote host tested.
- Published branch with commits `dbf48af`, `655566f`, `13914cf`. PR creation blocked: `gh pr create --base develop` returned `GraphQL: must be a collaborator (createPullRequest)` for authenticated account `sharath-w`; `gh pr list` showed no existing PR for the branch. PR URL: none. Create one when collaborator access is available: https://github.com/tnfssc/die/pull/new/die/pr-remote-workspace-research-and-prototy-7a2ffa64 (suggestion, not an opened PR). Values unchanged: placement, truthful evidence and handoff lessons are already covered.
