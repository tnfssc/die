import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, realpath, mkdir, writeFile, readFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { attach, call, detach } from "./client";
import { identityCode, finishCode } from "./scenario";

// Short socket paths for macOS; disposable fixture data, never a code worktree.
const root = await realpath(await mkdtemp("/tmp/die-placement-"));
const local = join(root, "local");
await mkdir(local);
await writeFile(join(local, "identity.txt"), "LOCAL-CLIENT");
const localIno = (await stat(join(local, "identity.txt"))).ino;
console.log("EVIDENCE: LOCAL separate processes + private Unix socket; NOT SSH, NOT an LLM");
console.log(JSON.stringify({ localRead: await readFile(join(local, "identity.txt"), "utf8"), localIno }));
const children: ReturnType<typeof spawn>[] = [];
async function until<T>(get: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await get();
    if (done(value)) return value;
    if (Date.now() > deadline) throw Error("Timed out: " + JSON.stringify(value));
    await Bun.sleep(30);
  }
}
async function launch(mode: string) {
  const target = join(root, mode);
  const socket = join(root, mode + ".sock");
  await mkdir(target);
  await writeFile(join(target, "identity.txt"), "TARGET-" + mode);
  await writeFile(join(target, "target-module.ts"), 'export const identity = "TARGET-MODULE";');
  const child = spawn(process.execPath, [join(import.meta.dir, "runtime.ts"), socket, target], {
    cwd: local,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let log = "";
  child.stdout!.on("data", (chunk) => (log += chunk));
  child.stderr!.on("data", (chunk) => (log += chunk));
  await until(
    async () => {
      if (child.exitCode !== null) throw Error(log);
      return log;
    },
    (text) => text.includes('"ready":true'),
  );
  return { target, socket, child };
}
function checkIdentity(identity: any, target: string, mode: string) {
  assert.equal(identity.cwd, target);
  assert.notEqual(identity.ino, localIno);
  assert.equal(identity.ino, identity.syncIno);
  assert.equal(identity.nodeRead, "TARGET-" + mode);
  assert.equal(identity.bunRead, identity.nodeRead);
  assert.equal(identity.moduleIdentity, "TARGET-MODULE");
  console.log(
    JSON.stringify({
      mode,
      cwd: identity.cwd,
      statIno: identity.ino,
      fsRead: identity.nodeRead,
      bunRead: identity.bunRead,
    }),
  );
}
try {
  const a = await launch("A");
  let client = await attach(a.socket);
  assert.equal((await call(client, "start-agent")).duplicate, false);
  assert.equal((await call(client, "start-agent")).duplicate, true);
  const attachedA = await until(
    () => call(client, "status"),
    (s) => s.events.includes("controller:job-launched") || s.agentStatus === "failed",
  );
  await detach(client);
  console.log("A: explicitly detached while shell running; no viewer attached");
  await Bun.sleep(1400);
  client = await attach(a.socket);
  const stateA = await until(
    () => call(client, "status"),
    (s) => s.agentStatus !== "running",
  );
  assert.equal(stateA.agentStatus, "completed", JSON.stringify(stateA));
  assert.equal(stateA.agentStarts, 1);
  assert.equal(stateA.pid, attachedA.pid);
  assert.equal(stateA.releases, 1);
  checkIdentity(stateA.agentIdentity, a.target, "A");
  assert.equal((await call(client, "start-agent")).duplicate, true);
  assert.equal(await readFile(join(a.target, "controller-effects.txt"), "utf8"), "A:feedback-observed\n");
  assert.equal(await readFile(join(a.target, "shell-effects.txt"), "utf8"), "once\n");
  const outputA = await call(client, "inspect", [stateA.jobs[0].id]);
  assert.ok(outputA.output.includes("shell-cwd=" + a.target));
  console.log(
    "A reconnect: " +
      JSON.stringify({
        agent: stateA.agentStatus,
        starts: stateA.agentStarts,
        events: stateA.events,
        output: outputA.output.trim(),
        duplicate: true,
      }),
  );
  await detach(client);

  const b = await launch("B");
  client = await attach(b.socket);
  assert.equal((await call(client, "execute", ["B-turn-1", identityCode])).duplicate, false);
  assert.equal((await call(client, "execute", ["B-turn-1", identityCode])).duplicate, true);
  const firstB = await until(
    () => call(client, "status"),
    (s) => s.runs["B-turn-1"]?.status !== "running",
  );
  assert.equal(firstB.runs["B-turn-1"].status, "completed", JSON.stringify(firstB));
  const identityB = JSON.parse(firstB.runs["B-turn-1"].result.stdout.trim());
  checkIdentity(identityB, b.target, "B");
  // Simulate abrupt presentation link loss (no detach operation), not SSH loss.
  await client.close();
  console.log("B: link closed while shell running; local scripted controller suspended");
  await Bun.sleep(1400);
  client = await attach(b.socket);
  const jobB = await call(client, "inspect", [identityB.job.id]);
  assert.equal(jobB.status, "completed");
  assert.ok(jobB.output.includes("target-ready"));
  assert.equal(await Bun.file(join(b.target, "controller-effects.txt")).exists(), false);
  const stateB = await call(client, "status");
  assert.equal(stateB.agentStarts, 0);
  assert.equal(stateB.pid, firstB.pid);
  assert.equal(Object.keys(stateB.runs).length, 1);
  assert.equal((await call(client, "execute", ["B-turn-1", identityCode])).duplicate, true);
  await assert.rejects(() => call(client, "execute", ["B-turn-1", "console.log('different')"]));
  const suffix = await call(client, "inspect", [identityB.job.id, jobB.nextOffset]);
  assert.equal(suffix.output, "");
  console.log(
    "B reconnect: " +
      JSON.stringify({
        job: jobB.status,
        remoteAgentStarts: stateB.agentStarts,
        nextTurnWhileDetached: false,
        output: jobB.output.trim(),
        suffix: suffix.output,
      }),
  );
  // A local agent can now resume from observed output, using a stable tool-call ID.
  // Abandon a response: acceptance may or may not have reached the server.
  void call(client, "execute", ["B-turn-2", finishCode("B")]).catch(() => {});
  await client.close();
  client = await attach(b.socket);
  await call(client, "execute", ["B-turn-2", finishCode("B")]);
  await until(
    () => call(client, "status"),
    (s) => s.runs["B-turn-2"]?.status !== "running",
  );
  assert.equal((await call(client, "execute", ["B-turn-2", finishCode("B")])).duplicate, true);
  assert.equal(await readFile(join(b.target, "controller-effects.txt"), "utf8"), "B:feedback-observed\n");
  assert.equal(await readFile(join(b.target, "shell-effects.txt"), "utf8"), "once\n");
  await detach(client);
  console.log("B: abandoned response reconciled by ID; second execute side effect exactly once");
  console.log(
    "PASS: target fs + shell; A controller continues; B only job continues; status/output reconnect; no duplicate effects",
  );
} finally {
  for (const child of children) {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      await exited;
      clearTimeout(timer);
    }
  }
  await rm(root, { recursive: true, force: true });
}
