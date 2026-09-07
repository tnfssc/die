import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JobDiagnosticInput, JobService } from "../src/tasks/job-service";
import { type TaskLaunch, TaskManager } from "../src/tasks/task-manager";

const signal = new AbortController().signal;
test("job helper validation rejects invalid inputs before spawning", async () => {
  const manager = new TaskManager(() => {}),
    service = new JobService(
      manager,
      () => ({ depth: 0 }),
      () => {},
    );
  try {
    for (const [method, params] of [
      ["shell", { command: "" }],
      ["shell", { command: "echo bad", waitSeconds: -1 }],
      ["shell", { command: "echo bad", waitSeconds: Infinity }],
      ["jobs.inspect", { id: "x", limit: 5001 }],
      ["jobs.list", { count: 101 }],
      ["subagent", { prompt: "x", model: "p/override" }],
      ["subagent", { type: "bad", prompt: "x" }],
      ["jobs.input", { id: "x" }],
    ])
      await expect(service.handle(method as string, params, { cwd: process.cwd() } as any, signal)).rejects.toThrow();
    expect(manager.list()).toHaveLength(0);
  } finally {
    await manager.shutdown();
  }
});
test("records metadata-only dispatch lifecycle against the supplied session recorder", async () => {
  const manager = new TaskManager(() => {}),
    records: JobDiagnosticInput[] = [];
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    () => {},
    undefined,
    undefined,
    (input) => records.push(input),
  );
  try {
    const result = (await service.handle(
      "shell",
      { command: "printf private-value", waitSeconds: 1 },
      { cwd: process.cwd() } as any,
      signal,
    )) as { id: string };
    expect(records).toHaveLength(2);
    expect(records[0]!.dispatch).toBe("initiated");
    expect(records[1]).toMatchObject({ dispatch: "response", outcome: "success", taskId: result.id });
    expect(records[1]!.operationId).toBe(records[0]!.operationId);
    expect(JSON.stringify(records)).not.toContain("private-value");

    await expect(service.handle("unknown", {}, { cwd: process.cwd() } as any, signal)).rejects.toThrow(
      "Unknown job method",
    );
    expect(records.at(-1)).toMatchObject({ dispatch: "response", outcome: "failed" });
  } finally {
    await manager.shutdown();
  }
});

test("profile settings, child identity, and three-tier limits survive helper migration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-jobs-profile-")),
    path = join(dir, "profiles.json");
  await writeFile(path, JSON.stringify({ fast: { model: "p/quick", thinking: "off" } }));
  const manager = new TaskManager(() => {}),
    launches: TaskLaunch[] = [];
  const spawn = spyOn(manager, "spawn").mockImplementation((launch) => {
    launches.push(launch);
    return {
      id: "fake",
      kind: "agent",
      command: "test",
      cwd: dir,
      status: "running",
      startedAt: new Date().toISOString(),
      baseOffset: 0,
      outputEnd: 0,
      timedOut: false,
    };
  });
  const foreground = spyOn(manager, "foreground").mockResolvedValue({
    id: "fake",
    kind: "agent",
    command: "test",
    cwd: dir,
    status: "running",
    startedAt: new Date().toISOString(),
    baseOffset: 0,
    outputEnd: 0,
    timedOut: false,
    output: "",
    requestedOffset: 0,
    nextOffset: 0,
    outputLost: false,
    hasMore: false,
    background: true,
  });
  let policy: { depth: number; type?: string } = { depth: 0 };
  const service = new JobService(
    manager,
    () => policy,
    () => {},
    path,
  );
  const ctx = {
    cwd: dir,
    model: { provider: "p", id: "parent" },
    thinkingLevel: "medium",
    sessionManager: { getSessionDir: () => dir, getSessionFile: () => undefined },
  } as any;
  try {
    await service.handle("subagent", { type: "fast", prompt: "scout" }, ctx, signal);
    expect(launches[0]!.args).toContain("p/quick");
    expect(launches[0]!.args).toContain("off");
    expect(launches[0]!.env?.DIE_SUBAGENT_TYPE).toBe("fast");
    expect(foreground.mock.calls[0]![1]).toBe(1000);
    for (const type of ["fast", "normal"]) {
      policy = { depth: 1, type };
      await expect(service.handle("subagent", { prompt: "x" }, ctx, signal)).rejects.toThrow("Only orchestrator");
    }
    policy = { depth: 1, type: "orchestrator" };
    await expect(service.handle("subagent", { type: "orchestrator", prompt: "x" }, ctx, signal)).rejects.toThrow(
      "fast/normal",
    );
    await service.handle("subagent", { type: "fast", prompt: "x" }, ctx, signal);
    expect(launches[1]!.env?.DIE_SUBAGENT_DEPTH).toBe("2");
    policy = { depth: 2, type: "orchestrator" };
    await expect(service.handle("subagent", { prompt: "x" }, ctx, signal)).rejects.toThrow("two levels");
  } finally {
    spawn.mockRestore();
    foreground.mockRestore();
    await manager.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("partial subagent spawn failure stops and notifies already-launched workers", async () => {
  const notifications: any[] = [],
    manager = new TaskManager((task) => notifications.push(task)),
    originalSpawn = manager.spawn.bind(manager),
    launchFailure = new Error("second spawn failed");
  const spawn = spyOn(manager, "spawn")
    .mockImplementationOnce((launch) =>
      originalSpawn({
        ...launch,
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
      }),
    )
    .mockImplementationOnce(() => {
      throw launchFailure;
    });
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    () => {
      throw new Error("refresh failed");
    },
  );
  try {
    const error = await service
      .handle("subagent", { type: "fast", prompts: ["started", "fails"] }, { cwd: process.cwd() } as any, signal)
      .catch((error) => error);
    expect(error).toBe(launchFailure);

    const [task] = manager.list();
    expect(task).toBeDefined();
    expect(task!.termination?.cause).toBe("execute-cancellation");
    await manager.wait(task!.id);
    expect(manager.inspect(task!.id).status).toBe("killed");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ id: task!.id, status: "killed" });
  } finally {
    spawn.mockRestore();
    await manager.shutdown();
  }
});

test("optional and failing refresh callbacks cannot strand successful launches", async () => {
  for (const changed of [
    undefined,
    () => {
      throw new Error("refresh failed");
    },
  ]) {
    const manager = new TaskManager(() => {});
    const foreground = spyOn(manager, "foreground");
    const service = new JobService(manager, () => ({ depth: 0 }), changed);
    try {
      const result = (await service.handle(
        "shell",
        { command: "printf ok", waitSeconds: 1 },
        { cwd: process.cwd() } as any,
        signal,
      )) as { status: string; output: string };
      expect(foreground).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("completed");
      expect(result.output).toBe("ok");
    } finally {
      foreground.mockRestore();
      await manager.shutdown();
    }
  }
});

test("healthy inspection polling does not produce per-poll diagnostics", async () => {
  const manager = new TaskManager(() => {}),
    records: JobDiagnosticInput[] = [];
  const service = new JobService(
    manager,
    () => ({ depth: 0 }),
    () => {},
    undefined,
    undefined,
    (input) => records.push(input),
  );
  try {
    for (let i = 0; i < 100; i++) await service.handle("jobs.list", {}, {} as any, signal);
    expect(records).toHaveLength(0);
    for (let i = 0; i < 3; i++)
      await expect(service.handle("jobs.inspect", { id: "task_missing" }, {} as any, signal)).rejects.toThrow();
    expect(records).toHaveLength(1);
  } finally {
    await manager.shutdown();
  }
});
