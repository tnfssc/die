import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { executeIsolated } from "../src/typescript/execution";
import { TaskManager } from "../src/tasks/task-manager";
import { JobService } from "../src/tasks/job-service";
import { registerExecuteTool } from "../src/typescript/extension";
const binary = resolve(import.meta.dir, "../dist/die");
test("execute helpers multiplex responses, reject errors, and do not print implicitly", async () => {
  const seen: string[] = [];
  const result = await executeIsolated(
    'const values = await Promise.all([shell("one"), jobs.list()]); console.log(JSON.stringify(values)); try { await jobs.stop("bad"); } catch(e) { console.log(e.message); }',
    process.cwd(),
    undefined,
    3000,
    {
      executablePath: binary,
      jobHandler: async (method, params) => {
        seen.push(method);
        if (method === "jobs.stop") throw new Error("unknown job");
        return { method, params };
      },
    },
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(seen).toEqual(["shell", "jobs.list", "jobs.stop"]);
  expect(result.stdout).toContain('"command":"one"');
  expect(result.stdout).toContain("unknown job");
});
test("job helpers without a session bridge fail clearly", async () => {
  const result = await executeIsolated('await shell("echo nope")', process.cwd(), undefined, 3000, {
    executablePath: binary,
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("bridge is unavailable");
});
test("foreground work returns inline; background work survives execute and accepts input", async () => {
  const notifications: any[] = [];
  const manager = new TaskManager((task) => notifications.push(task));
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    () => {},
  );
  const execute = (code: string, timeout = 3000) =>
    executeIsolated(code, process.cwd(), undefined, timeout, {
      executablePath: binary,
      jobHandler: (method, params, signal) => service.handle(method, params, { cwd: process.cwd() } as any, signal),
    });
  try {
    const fast = await execute('console.log(JSON.stringify(await shell("printf inline")))');
    expect(fast.exitCode).toBe(0);
    expect(JSON.parse(fast.stdout)).toMatchObject({ background: false, status: "completed", output: "inline" });
    expect(notifications).toHaveLength(0);
    const launch = await execute(
      'console.log(JSON.stringify(await shell("read value; printf received:$value", {waitSeconds:0})))',
    );
    expect(launch.exitCode).toBe(0);
    const job = JSON.parse(launch.stdout);
    expect(job.background).toBe(true);
    expect(manager.list().find((t) => t.id === job.id)?.status).toBe("running");
    const send = await execute(
      "console.log(await jobs.input(" +
        JSON.stringify(job.id) +
        ", " +
        JSON.stringify("hello\n") +
        ", {closeInput:true}))",
    );
    expect(send.exitCode).toBe(0);
    await manager.wait(job.id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].output).toBe("received:hello");
    const inspect = await execute("console.log(JSON.stringify(await jobs.inspect(" + JSON.stringify(job.id) + ")))");
    expect(JSON.parse(inspect.stdout).output).toBe("received:hello");
  } finally {
    await manager.shutdown();
  }
});
test("canceling execute after a delayed job spawn transfers notification ownership without killing its job", async () => {
  const notifications: any[] = [];
  const manager = new TaskManager((t) => notifications.push(t));
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    () => {},
  );
  const controller = new AbortController();
  let unsubscribe = () => {};
  const spawned = new Promise<string>((resolve) => {
    unsubscribe = manager.subscribe((event) => {
      if (event.type !== "spawned") return;
      resolve(event.task.id);
      controller.abort();
    });
  });
  try {
    const execution = executeIsolated(
      'await shell("read value; printf survived", {waitSeconds:60})',
      process.cwd(),
      controller.signal,
      3000,
      {
        executablePath: binary,
        jobHandler: async (method, params, signal) => {
          // Reproduce startup slower than the former 200 ms execute timeout.
          await Bun.sleep(300);
          return service.handle(method, params, { cwd: process.cwd() } as any, signal);
        },
      },
    );
    const taskId = await spawned;
    const result = await execution;
    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(manager.inspect(taskId).status).toBe("running");
    await manager.write(taskId, "go\n", true);
    await manager.wait(taskId);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].output).toBe("survived");
  } finally {
    unsubscribe();
    await manager.shutdown();
  }
});
test("bridge budgets reject oversized messages without corrupting subsequent calls", async () => {
  const result = await executeIsolated(
    'try { await shell("x".repeat(1100000)); } catch(e) { console.log("request bounded"); } try { await shell("huge-result"); } catch(e) { console.log("response bounded"); } console.log(await jobs.list());',
    process.cwd(),
    undefined,
    3000,
    {
      executablePath: binary,
      jobHandler: async (method) => (method === "shell" ? "x".repeat(1100000) : "still works"),
    },
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("request bounded");
  expect(result.stdout).toContain("response bounded");
  expect(result.stdout).toContain("still works");
});

test("default foreground budget is one second; zero wait returns promptly; timeout is independent", async () => {
  const notifications: any[] = [];
  const manager = new TaskManager((t) => notifications.push(t));
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    () => {},
  );
  const execute = (code: string) =>
    executeIsolated(code, process.cwd(), undefined, 5000, {
      executablePath: binary,
      jobHandler: (m, p, signal) => service.handle(m, p, { cwd: process.cwd() } as any, signal),
    });
  try {
    let started = Date.now();
    const normal = await execute('console.log(JSON.stringify(await shell("read value")))');
    const elapsed = Date.now() - started;
    expect(normal.exitCode).toBe(0);
    expect(JSON.parse(normal.stdout).background).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(3000);
    started = Date.now();
    const immediate = await execute('console.log(JSON.stringify(await shell("read value", {waitSeconds:0})))');
    expect(immediate.exitCode).toBe(0);
    expect(JSON.parse(immediate.stdout).background).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
    const timeout = await execute('console.log(JSON.stringify(await shell("read value", {timeoutSeconds:0.2})))');
    expect(timeout.exitCode).toBe(0);
    expect(JSON.parse(timeout.stdout)).toMatchObject({ background: false, status: "killed", timedOut: true });
    const failure = await execute('console.log(JSON.stringify(await shell("exit 7")))');
    expect(failure.exitCode).toBe(0);
    expect(JSON.parse(failure.stdout)).toMatchObject({ background: false, status: "failed", exitCode: 7 });
    expect(notifications).toHaveLength(0);
  } finally {
    await manager.shutdown();
  }
});

test("canceling concurrent bridge waits hands off every launched job exactly once", async () => {
  const notifications: any[] = [];
  const manager = new TaskManager((t) => notifications.push(t));
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    () => {},
  );
  const abort = new AbortController();
  let launched = 0;
  try {
    const result = await executeIsolated(
      'await Promise.all(Array.from({length:3}, () => shell("read value; printf done", {waitSeconds:60})))',
      process.cwd(),
      abort.signal,
      5000,
      {
        executablePath: binary,
        jobHandler: (m, p, signal) => {
          const result = service.handle(m, p, { cwd: process.cwd() } as any, signal);
          if (m === "shell" && ++launched === 3) abort.abort();
          return result;
        },
      },
    );
    expect(result.cancelled).toBe(true);
    const tasks = manager.list();
    expect(tasks).toHaveLength(3);
    for (const task of tasks) await manager.write(task.id, "go\n", true);
    await Promise.all(tasks.map((task) => manager.wait(task.id)));
    expect(notifications).toHaveLength(3);
    expect(new Set(notifications.map((task) => task.id)).size).toBe(3);
  } finally {
    await manager.shutdown();
  }
});

test("disconnect before an inline response is acknowledged restores completion notification ownership", async () => {
  const notifications: any[] = [];
  const manager = new TaskManager((task) => notifications.push(task));
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    () => {},
  );
  const abort = new AbortController();
  try {
    const result = await executeIsolated(
      'await shell("printf raced", {waitSeconds:60})',
      process.cwd(),
      abort.signal,
      5000,
      {
        executablePath: binary,
        jobHandler: async (method, params, signal) => {
          const value = await service.handle(method, params, { cwd: process.cwd() } as any, signal);
          // Tear down execute after foreground selected the completed inline
          // result, but before the bridge can deliver and acknowledge it.
          abort.abort();
          return value;
        },
      },
    );
    expect(result.cancelled).toBe(true);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ status: "completed", output: "raced" });
  } finally {
    await manager.shutdown();
  }
});

test("registered execute preserves ACK ownership through its wrapper for batch subagents", async () => {
  const notifications: any[] = [];
  const manager = new TaskManager((task) => notifications.push(task));
  let executeTool: any;
  const pi = {
    on() {},
    registerTool(tool: any) {
      executeTool = tool;
    },
  } as any;
  const handler = async (_ctx: any, method: string, params: any, signal: AbortSignal) => {
    if (method !== "subagent") throw new Error("unexpected method");
    const tasks = params.prompts.map((prompt: string) =>
      manager.spawn({
        kind: "agent" as const,
        command: process.execPath,
        args: ["-e", `console.log(${JSON.stringify(prompt)})`],
        displayCommand: prompt,
        cwd: process.cwd(),
        closeStdin: true,
        notifyOnComplete: false,
      }),
    );
    return Promise.all(tasks.map((task: any) => manager.foreground(task.id, 3000, signal)));
  };
  registerExecuteTool(pi, handler, binary);
  try {
    const result = await executeTool.execute(
      "call",
      {
        code: 'console.log(JSON.stringify(await subagent({prompts:["first","second"]})))',
      },
      new AbortController().signal,
      () => {},
      { cwd: process.cwd() },
    );
    const values = JSON.parse(result.details.stdout);
    expect(values).toHaveLength(2);
    expect(values.map((value: any) => value.output.trim())).toEqual(["first", "second"]);
    expect(values.every((value: any) => value.background === false)).toBe(true);
    expect(notifications).toHaveLength(0);
  } finally {
    await manager.shutdown();
  }
});

test("ACK is provisional until clean worker exit", async () => {
  const notifications: any[] = [];
  const manager = new TaskManager((task) => notifications.push(task));
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    () => {},
  );
  try {
    const result = await executeIsolated(
      'await shell("printf delivered"); process.exit(7)',
      process.cwd(),
      undefined,
      3000,
      {
        executablePath: binary,
        jobHandler: (method, params, signal) => service.handle(method, params, { cwd: process.cwd() } as any, signal),
      },
    );
    expect(result.exitCode).toBe(7);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].output).toBe("delivered");
  } finally {
    await manager.shutdown();
  }
});

test("oversized reply releases foreground ownership exactly once", async () => {
  const notifications: any[] = [];
  const manager = new TaskManager((task) => notifications.push(task));
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    () => {},
  );
  try {
    const result = await executeIsolated(
      'try { await shell("printf retained") } catch (error) { console.log(error.message) }',
      process.cwd(),
      undefined,
      3000,
      {
        executablePath: binary,
        jobHandler: async (method, params, signal) => ({
          ...((await service.handle(method, params, { cwd: process.cwd() } as any, signal)) as object),
          oversized: "x".repeat(1_100_000),
        }),
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("response exceeded 1 MB");
    expect(notifications).toHaveLength(1);
    expect(notifications[0].output).toBe("retained");
  } finally {
    await manager.shutdown();
  }
});

test("registered execute handoff separates completed delivery from pending wait cancellation", async () => {
  const notifications: any[] = [];
  const manager = new TaskManager((task) => notifications.push(task));
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    () => {},
  );
  let executeTool: any;
  registerExecuteTool(
    {
      on() {},
      registerTool(tool: any) {
        executeTool = tool;
      },
    } as any,
    (ctx, method, params, signal) => service.handle(method, params, ctx, signal),
    binary,
  );
  try {
    const result = await executeTool.execute(
      "handoff",
      {
        code: 'await shell("printf inline"); await shell("read value; printf pending:$value", {waitSeconds:0}); await handoff("waiting")',
      },
      new AbortController().signal,
      () => {},
      { cwd: process.cwd() },
    );
    expect(result.terminate).toBe(true);
    const tasks = manager.list();
    expect(tasks).toHaveLength(2);
    const inline = tasks[0]!;
    const pending = tasks[1]!;
    expect(inline.status).toBe("completed");
    expect(pending.status).toBe("running");
    expect(notifications).toHaveLength(0);
    await manager.write(pending.id, "done\n", true);
    await manager.wait(pending.id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ id: pending.id, output: "pending:done" });
  } finally {
    await manager.shutdown();
  }
});

test("handler failure releases inline ownership from a partial batch", async () => {
  const notifications: any[] = [];
  const manager = new TaskManager((task) => notifications.push(task));
  let executeTool: any;
  registerExecuteTool(
    {
      on() {},
      registerTool(tool: any) {
        executeTool = tool;
      },
    } as any,
    async (_ctx, method, params: any, signal) => {
      if (method !== "subagent") throw new Error("unexpected method");
      let inlineReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        inlineReady = resolve;
      });
      return Promise.all(
        params.prompts.map(async (prompt: string) => {
          if (prompt === "error") {
            await ready;
            throw new Error("batch item failed");
          }
          const task = manager.spawn({
            kind: "agent",
            command: process.execPath,
            args: ["-e", "console.log('inline result')"],
            displayCommand: prompt,
            cwd: process.cwd(),
            closeStdin: true,
            notifyOnComplete: false,
          });
          const result = await manager.foreground(task.id, 3000, signal);
          inlineReady();
          return result;
        }),
      );
    },
    binary,
  );
  try {
    const result = await executeTool.execute(
      "batch",
      {
        code: 'try { await subagent({prompts:["inline", "error"]}) } catch (error) { console.log(error.message) }',
      },
      new AbortController().signal,
      () => {},
      { cwd: process.cwd() },
    );
    expect(result.details.stdout).toContain("batch item failed");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ status: "completed" });
    expect(notifications[0].output.trim()).toBe("inline result");
  } finally {
    await manager.shutdown();
  }
});

test("execute exposes attention helper RPCs through the single bridge", async () => {
  const seen: any[] = [];
  const result = await executeIsolated(
    'console.log(JSON.stringify([await jobs.snooze("task_1",{minutes:5}),await jobs.setWatch("task_1",{enabled:false})]))',
    process.cwd(),
    undefined,
    3000,
    {
      executablePath: binary,
      jobHandler: async (method, params) => {
        seen.push([method, params]);
        return params;
      },
    },
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(seen).toEqual([
    ["jobs.snooze", { minutes: 5, id: "task_1" }],
    ["jobs.setWatch", { enabled: false, id: "task_1" }],
  ]);
});
test("goal helpers share the single execute bridge and do not print implicitly", async () => {
  const seen: any[] = [];
  const result = await executeIsolated(
    'const before=await goal.get(); await goal.set({objective:"o",criteria:["c"],constraints:[]}); console.log((await goal.update({status:"completed",evidence:"verified"})).status)',
    process.cwd(),
    undefined,
    3000,
    {
      executablePath: binary,
      jobHandler: async (method, params) => {
        seen.push([method, params]);
        return method === "goal.update" ? { status: "completed" } : null;
      },
    },
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe("completed");
  expect(seen.map((x) => x[0])).toEqual(["goal.get", "goal.set", "goal.update"]);
});
