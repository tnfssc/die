// Local placement probe, NOT an SSH service or production API.
import { resolve, join } from "node:path";
import { Server, type ServerHost } from "@earendil-works/pi-server";
import { createUnixListener } from "@earendil-works/pi-server/unix";
import { TestServerHost, createTestServerServices } from "@earendil-works/pi-server/testing";
import { executeIsolated } from "../../src/typescript/execution";
import { TaskManager } from "../../src/tasks/task-manager";
import { identityCode, finishCode } from "./scenario";

const [socket, directory] = process.argv.slice(2);
if (!socket || !directory) throw Error("usage: bun runtime.ts SOCKET TARGET_DIRECTORY");
const cwd = resolve(directory);
process.chdir(cwd);
const manager = new TaskManager(() => {}, 100);
const runs = new Map<string, { code: string; status: string; result?: unknown; error?: string }>();
const events: string[] = [];
let agentStatus = "idle";
let agentStarts = 0;
let agentIdentity: unknown;
let attachments = 0;
let releases = 0;
let shuttingDown = false;
const executionAbort = new AbortController();

async function execute(code: string) {
  const result = await executeIsolated(code, cwd, executionAbort.signal, 10_000, {
    executablePath: join(import.meta.dir, "runner.ts"),
    sessionFile: join(cwd, "probe-session.jsonl"),
    jobHandler: async (method, input, signal) => {
      const p = input as { command: string; waitSeconds?: number; id: string; offset?: number };
      if (method === "shell") {
        const task = manager.spawn({
          kind: "command",
          command: "/bin/sh",
          args: ["-c", p.command],
          displayCommand: p.command,
          cwd,
          closeStdin: true,
          timeoutMs: 10_000,
        });
        return manager.foreground(task.id, (p.waitSeconds ?? 3) * 1000, signal);
      }
      if (method === "jobs.inspect") return manager.inspect(p.id, p.offset);
      if (method === "jobs.list") return manager.list();
      throw Error("Probe supports shell, jobs.inspect, jobs.list only: " + method);
    },
  });
  if (result.exitCode !== 0) throw Error(result.stderr || JSON.stringify(result));
  return result;
}

// IDs deduplicate acceptance only for this live runtime. No restart/exactly-once claim.
function submit(id: string, code: string) {
  const prior = runs.get(id);
  if (prior) {
    if (prior.code !== code) throw Error("ID reused with different code");
    return { id, duplicate: true };
  }
  if (runs.size >= 32) throw Error("bounded probe: maximum 32 runs");
  const run = { code, status: "running" } as NonNullable<ReturnType<typeof runs.get>>;
  runs.set(id, run);
  void execute(code).then(
    (result) => {
      run.result = result;
      run.status = "completed";
    },
    (error) => {
      run.error = String(error);
      run.status = "failed";
    },
  );
  return { id, duplicate: false };
}

// Deterministic controller, not an LLM. A second execute is selected from actual
// shell output AFTER completion; this is not merely a surviving shell process.
async function agent() {
  agentStarts++;
  agentStatus = "running";
  try {
    events.push("controller:turn-1");
    const first = await execute(identityCode);
    events.push("controller:job-launched");
    agentIdentity = JSON.parse(first.stdout.trim().split("\n").at(-1)!);
    const job = (agentIdentity as { job: { id: string } }).job;
    const completed = await manager.wait(job.id);
    if (completed.exitCode !== 0 || !completed.output.includes("target-ready")) throw Error("bad job feedback");
    events.push("controller:observed-job-output");
    await execute(finishCode("A"));
    events.push("controller:turn-2-executed");
    agentStatus = "completed";
  } catch (error) {
    agentStatus = "failed";
    events.push(String(error));
  }
}

const catalog = new TestServerHost();
await catalog.seed("workspace");
const host: ServerHost = {
  serverServices: createTestServerServices(),
  resolveSession: (id, context) => catalog.resolveSession(id, context),
  async openSession() {
    return {
      attachClient() {
        attachments++;
        return {
          async invokeService(call) {
            if (shuttingDown) throw Error("shutting down");
            if (call.serviceId !== "probe") throw Error("unknown probe service");
            const [id, code] = call.args;
            switch (call.member) {
              case "start-agent":
                if (agentStatus !== "idle") return { duplicate: true, agentStatus };
                void agent();
                return { duplicate: false, agentStatus };
              case "execute":
                if (typeof id !== "string" || typeof code !== "string") throw Error("expected id, code");
                return submit(id, code);
              case "status":
                return JSON.parse(
                  JSON.stringify({
                    pid: process.pid,
                    cwd,
                    agentStatus,
                    agentStarts,
                    agentIdentity,
                    attachments,
                    releases,
                    events,
                    runs: Object.fromEntries(runs),
                    jobs: manager.list(),
                  }),
                );
              case "inspect":
                if (typeof id !== "string") throw Error("expected job id");
                return JSON.parse(JSON.stringify(manager.inspect(id, typeof code === "number" ? code : 0)));
              default:
                throw Error("unsupported probe operation");
            }
          },
          release() {
            attachments--;
            releases++;
          },
        };
      },
      // pi-server owns the handle, NOT the controller lifetime. Shutdown is below.
      async close() {},
    };
  },
};
const server = new Server(host, {
  serverId: "3414a9f1-78cf-4986-a48e-8adca1f06b4e",
  listeners: [createUnixListener({ path: socket })],
});
await server.start();
console.log(JSON.stringify({ ready: true, socket, cwd, pid: process.pid, evidence: "LOCAL SIMULATION" }));
async function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  executionAbort.abort("shutdown");
  await manager.shutdown();
  await server.close();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
