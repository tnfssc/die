import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TaskManager, type TaskInspection } from "../src/tasks/task-manager";

const managers: TaskManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
});

function commandLaunch(command: string) {
  return {
    kind: "command" as const,
    command: "/bin/sh",
    args: ["-lc", command],
    displayCommand: command,
    cwd: process.cwd(),
  };
}

function managerWithCompletion() {
  let resolveCompletion!: (task: TaskInspection) => void;
  const completion = new Promise<TaskInspection>((resolve) => {
    resolveCompletion = resolve;
  });
  const manager = new TaskManager(resolveCompletion);
  managers.push(manager);
  return { manager, completion };
}

describe("asynchronous task manager", () => {
  test("spawn returns while the process continues and completion is reported", async () => {
    const { manager, completion } = managerWithCompletion();
    const started = performance.now();
    const task = manager.spawn(commandLaunch("sleep 0.2; printf completed"));

    expect(performance.now() - started).toBeLessThan(100);
    expect(task.status).toBe("running");

    const finished = await completion;
    expect(finished.status).toBe("completed");
    expect(finished.exitCode).toBe(0);
    expect(finished.output).toBe("completed");
  });

  test("supports incremental inspection with output cursors", async () => {
    const { manager, completion } = managerWithCompletion();
    const task = manager.spawn(commandLaunch("printf abcdef"));
    await completion;

    const first = manager.inspect(task.id, 0, 3);
    const second = manager.inspect(task.id, first.nextOffset, 3);
    expect(first.output).toBe("abc");
    expect(first.hasMore).toBe(true);
    expect(second.output).toBe("def");
    expect(second.hasMore).toBe(false);
  });

  test("keeps UTF-8 characters intact across inspection pages", async () => {
    const { manager, completion } = managerWithCompletion();
    const task = manager.spawn({
      kind: "command",
      command: process.execPath,
      args: ["-e", "process.stdout.write('A😀B')"],
      displayCommand: "unicode output",
      cwd: process.cwd(),
    });
    await completion;

    const first = manager.inspect(task.id, 0, 2);
    const second = manager.inspect(task.id, first.nextOffset, 2);
    const third = manager.inspect(task.id, second.nextOffset, 2);
    expect(first.output).toBe("A");
    expect(second.output).toBe("😀");
    expect(third.output).toBe("B");
    expect(third.hasMore).toBe(false);
  });

  test("can await completion without emitting an automatic notification", async () => {
    let notificationCount = 0;
    const manager = new TaskManager(() => notificationCount++);
    managers.push(manager);
    const task = manager.spawn({ ...commandLaunch("printf nested-result"), notifyOnComplete: false });

    const completed = await manager.wait(task.id);
    expect(completed.status).toBe("completed");
    expect(completed.output).toBe("nested-result");
    expect(notificationCount).toBe(0);
  });

  test("writes standard input and can close it", async () => {
    const { manager, completion } = managerWithCompletion();
    const task = manager.spawn(commandLaunch("IFS= read -r value; printf 'received:%s' \"$value\""));

    await manager.write(task.id, "hello\n", true);
    const finished = await completion;
    expect(finished.output).toBe("received:hello");
  });

  test("can start with closed input for non-interactive agents", async () => {
    const { manager, completion } = managerWithCompletion();
    manager.spawn({ ...commandLaunch("cat >/dev/null; printf eof"), closeStdin: true });

    expect((await completion).output).toBe("eof");
  });

  test("bounds retained output from noisy processes", async () => {
    const { manager, completion } = managerWithCompletion();
    const task = manager.spawn(commandLaunch("yes x | head -c 5000000"));

    await completion;
    const summary = manager.list().find((item) => item.id === task.id)!;
    expect(summary.outputEnd).toBe(5_000_000);
    expect(summary.outputEnd - summary.baseOffset).toBe(1_000_000);
    const tail = manager.inspect(task.id, summary.baseOffset, 50_000);
    expect(Buffer.byteLength(tail.output)).toBe(50_000);
    expect(tail.hasMore).toBe(true);
  });

  test("runs 50 concurrent tasks without losing results", async () => {
    const results = new Map<string, string>();
    let resolveAll!: () => void;
    const allCompleted = new Promise<void>((resolve) => (resolveAll = resolve));
    const manager = new TaskManager((task) => {
      results.set(task.id, task.output);
      if (results.size === 50) resolveAll();
    });
    managers.push(manager);

    const started = performance.now();
    const tasks = Array.from({ length: 50 }, (_, index) =>
      manager.spawn(commandLaunch(`sleep 0.${String(index % 10).padStart(2, "0")}; printf task-${index}`)),
    );
    expect(performance.now() - started).toBeLessThan(1_000);
    await allCompleted;

    expect(results.size).toBe(50);
    for (const [index, task] of tasks.entries()) expect(results.get(task.id)).toBe(`task-${index}`);
  }, 10_000);

  test("terminates running process groups", async () => {
    const { manager, completion } = managerWithCompletion();
    const task = manager.spawn(commandLaunch("sleep 30"));

    manager.kill(task.id);
    const finished = await completion;
    expect(finished.status).toBe("killed");
    expect(finished.signal).toBe("SIGTERM");
  });

  test("shutdown can be awaited before the host exits and is idempotent", async () => {
    const source = `
      import { TaskManager } from ${JSON.stringify(fileURLToPath(new URL("../src/tasks/task-manager.ts", import.meta.url)))};
      const manager = new TaskManager(() => { throw new Error("Unexpected shutdown notification"); }, 50);
      const task = manager.spawn({
        kind: "command", command: process.execPath,
        args: ["-e", 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000);'],
        displayCommand: "stubborn child", cwd: process.cwd(),
      });
      console.log(task.pid);
      while (!manager.inspect(task.id).output.includes("ready")) await Bun.sleep(10);
      const shutdown = manager.shutdown();
      if (shutdown !== manager.shutdown()) throw new Error("Shutdown must be idempotent");
      await shutdown;
      console.log(manager.inspect(task.id).status);
      process.exit(0);
    `;
    const host = Bun.spawn([process.execPath, "-e", source], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(host.stdout).text(), new Response(host.stderr).text(), host.exited]);
    const pid = Number(stdout.split("\n")[0]);
    try {
      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("killed");
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      if (pid > 0) { try { process.kill(-pid, "SIGKILL"); } catch {} }
      host.kill();
    }
  });

  test.skipIf(process.platform !== "linux")("shutdown kills descendants after the shell exits and output pipes close", async () => {
    const directory = await mkdtemp(join(tmpdir(), "die-shutdown-"));
    const ready = join(directory, "child.pid");
    const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
    const childCode = `const fs = require("node:fs"); process.on("SIGTERM", () => {}); fs.closeSync(1); fs.closeSync(2); fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const manager = new TaskManager(() => {});
    managers.push(manager);
    const task = manager.spawn({ ...commandLaunch(`${quote(process.execPath)} -e ${quote(childCode)} & wait`), closeStdin: true });
    let childPid = 0;
    try {
      const deadline = Date.now() + 2_000;
      while (!(await Bun.file(ready).exists()) && Date.now() < deadline) await Bun.sleep(10);
      childPid = Number(await readFile(ready, "utf8"));
      await manager.shutdown();
      let alive = true;
      for (let attempt = 0; attempt < 100 && alive; attempt++) {
        try { alive = !/\) Z /.test(await readFile(`/proc/${childPid}/stat`, "utf8")); }
        catch { alive = false; }
        if (alive) await Bun.sleep(10);
      }
      expect(alive).toBe(false);
    } finally {
      if (task.pid) { try { process.kill(-task.pid, "SIGKILL"); } catch {} }
      await manager.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("shutdown escalates when a process ignores SIGTERM", async () => {
    const manager = new TaskManager(() => {}, 25);
    managers.push(manager);
    const task = manager.spawn(commandLaunch("trap '' TERM; sleep 30"));
    await Bun.sleep(25);

    manager.shutdown();
    const deadline = Date.now() + 1_000;
    while (manager.list()[0].status === "running" && Date.now() < deadline) await Bun.sleep(10);

    const finished = manager.list().find((item) => item.id === task.id)!;
    expect(finished.status).toBe("killed");
    expect(finished.signal).toBe("SIGKILL");
  });
});
