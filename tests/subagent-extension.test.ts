import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskLifecycleFile } from "../src/tasks/task-lifecycle";
import { afterEach, expect, spyOn, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/tasks/extension";
import * as execution from "../src/typescript/execution";

const originalDepth = process.env.DIE_SUBAGENT_DEPTH,
  originalType = process.env.DIE_SUBAGENT_TYPE;
afterEach(() => {
  if (originalDepth === undefined) delete process.env.DIE_SUBAGENT_DEPTH;
  else process.env.DIE_SUBAGENT_DEPTH = originalDepth;
  if (originalType === undefined) delete process.env.DIE_SUBAGENT_TYPE;
  else process.env.DIE_SUBAGENT_TYPE = originalType;
});

type FixtureContext = ExtensionContext & {
  notices: Array<{ message: string; kind?: string }>;
  statuses: Map<string, string>;
};

function contextFixture(
  options: {
    sessionId?: string;
    entries?: any[];
    sessionManager?: Partial<ExtensionContext["sessionManager"]>;
    mode?: ExtensionContext["mode"];
    signal?: AbortSignal;
  } = {},
): FixtureContext {
  const entries = options.entries ?? [];
  const notices: FixtureContext["notices"] = [];
  const statuses = new Map<string, string>();
  const runtime = {
    streamSimple() {},
    async prepareRequest() {},
    isUsingOAuth() {
      return false;
    },
  };
  const sessionManager = {
    getSessionId: () => options.sessionId ?? "fixture-session",
    getEntries: () => entries,
    getLeafId: () => null,
    ...options.sessionManager,
  } as ExtensionContext["sessionManager"];
  const ui = {
    notify(message: string, kind?: string) {
      notices.push({ message, kind });
    },
    setStatus(key: string, value: string | undefined) {
      if (value === undefined) statuses.delete(key);
      else statuses.set(key, value);
    },
  } as ExtensionContext["ui"];
  return {
    ui,
    mode: options.mode ?? "print",
    hasUI: false,
    cwd: process.cwd(),
    sessionManager,
    modelRegistry: { runtime, isUsingOAuth: () => false } as unknown as ExtensionContext["modelRegistry"],
    model: undefined,
    scopedModels: [],
    isIdle: () => true,
    isProjectTrusted: () => true,
    signal: options.signal,
    abort() {},
    hasPendingMessages: () => false,
    shutdown() {},
    getContextUsage: () => undefined,
    compact() {},
    getSystemPrompt: () => "base",
    notices,
    statuses,
  };
}
function load(depth = 0, type?: string, options: any = {}) {
  process.env.DIE_SUBAGENT_DEPTH = String(depth);
  if (type) process.env.DIE_SUBAGENT_TYPE = type;
  else delete process.env.DIE_SUBAGENT_TYPE;
  const tools = new Map<string, any>(),
    handlers = new Map<string, Function[]>(),
    messages: any[] = [];
  let active: string[] = [];
  extension(
    {
      registerTool: (t: any) => tools.set(t.name, t),
      registerCommand() {},
      registerFlag() {},
      getFlag() {
        return false;
      },
      registerMessageRenderer() {},
      on: (e: string, h: Function) => handlers.set(e, [...(handlers.get(e) ?? []), h]),
      setActiveTools: (names: string[]) => (active = names),
      sendMessage: (m: any) => messages.push(m),
    } as any,
    options,
  );
  const fire = async (event: string, ...args: any[]) => {
    let result: any;
    for (const h of handlers.get(event) ?? []) result = await h(...args);
    return result;
  };
  return { tools, fire, messages, active: () => active };
}
test("root and all agent profiles expose only execute", async () => {
  for (const [depth, type] of [
    [0, undefined],
    [1, "fast"],
    [1, "normal"],
    [1, "orchestrator"],
    [2, "normal"],
  ] as const) {
    const e = load(depth, type);
    const ctx = contextFixture();
    await e.fire("session_start", {}, ctx);
    expect([...e.tools.keys()]).toEqual(["execute"]);
    expect(e.active()).toEqual(["execute"]);
    expect(e.tools.get("execute").promptGuidelines.join("\n")).toContain("jobs.inspect");
    await e.fire("session_shutdown", {}, ctx);
  }
});

test("unconfigured native fast startup adds no UI output", async () => {
  const e = load();
  const ctx = contextFixture();
  await e.fire("session_start", {}, ctx);
  expect(ctx.notices).toEqual([]);
  expect(ctx.statuses.has("die-native-fast")).toBe(false);
  expect(ctx.statuses.get("die-mode")).toBe("mode: orchestrator");
  await e.fire("session_shutdown", {}, ctx);
});

test("resumed leaf identity is retained in instructions", async () => {
  const e = load();
  const ctx = contextFixture({
    entries: [{ type: "custom", customType: "die-agent", data: { type: "fast", depth: 1 } }],
  });
  await e.fire("session_start", {}, ctx);
  const result = await e.fire("before_agent_start", { systemPrompt: "base" }, ctx);
  expect(result.systemPrompt).toContain("You are a fast sub-agent");
  expect(result.systemPrompt).toContain("Delegation is disabled");
  await e.fire("session_shutdown", {}, ctx);
});
for (const mode of ["print", "json"] as const)
  test(mode + " idle boundary still resumes background jobs", async () => {
    const e = load();
    let rpc: any;
    const mock = spyOn(execution, "executeIsolated").mockImplementation(async (_c, _w, _s, _t, options) => {
      rpc = options!.jobHandler;
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        stdoutLost: false,
        stderrLost: false,
        timedOut: false,
        cancelled: false,
        images: [],
      };
    });
    try {
      await e.tools.get("execute").execute("bind", { code: "" }, undefined, undefined, { cwd: process.cwd() });
      mock.mockRestore();
      const signal = new AbortController().signal;
      const ctx = contextFixture({ mode, signal });
      const task = await rpc("shell", { command: "read value; printf ready", waitSeconds: 0 }, signal);
      let ended = false;
      const boundary = e.fire("agent_end", { messages: [] }, ctx).then(() => (ended = true));
      await Bun.sleep(10);
      expect(ended).toBe(false);
      await rpc("jobs.input", { id: task.id, data: "go\n", closeInput: true }, signal);
      await boundary;
      expect(e.messages).toHaveLength(1);
      expect(e.messages[0].content).toContain("ready");
    } finally {
      mock.mockRestore();
      await e.fire("session_shutdown", {}, contextFixture({ mode }));
    }
  });

test("print agent_end wakes on attention while a job is still running", async () => {
  const e = load(0, undefined, { attention: { quietMs: 15, reviewMs: 1000 } });
  let rpc: any;
  const mock = spyOn(execution, "executeIsolated").mockImplementation(async (_c, _w, _s, _t, options) => {
    rpc = options!.jobHandler;
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      stdoutLost: false,
      stderrLost: false,
      timedOut: false,
      cancelled: false,
      images: [],
    };
  });
  try {
    await e.tools.get("execute").execute("bind", { code: "" }, undefined, undefined, { cwd: process.cwd() });
    mock.mockRestore();
    const signal = new AbortController().signal,
      ctx = contextFixture({ mode: "print", signal }),
      task = await rpc("shell", { command: "read value", waitSeconds: 0 }, signal);
    await e.fire("agent_end", { messages: [] }, ctx);
    await Bun.sleep(120);
    expect(e.messages).toHaveLength(1);
    expect(e.messages[0].customType).toBe("task-attention");
    expect(e.messages[0].content).toContain("Jobs continue running");
    expect(e.messages[0].content).toContain(task.id);
    await rpc("jobs.stop", { id: task.id }, signal);
  } finally {
    mock.mockRestore();
    await e.fire("session_shutdown", {}, contextFixture());
  }
});

test("attention and a racing completion produce one deduplicated parent wakeup", async () => {
  const e = load(0, undefined, { attention: { quietMs: 15, reviewMs: 1000 } });
  let rpc: any;
  const mock = spyOn(execution, "executeIsolated").mockImplementation(async (_c, _w, _s, _t, options) => {
    rpc = options!.jobHandler;
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      stdoutLost: false,
      stderrLost: false,
      timedOut: false,
      cancelled: false,
      images: [],
    };
  });
  try {
    await e.tools.get("execute").execute("bind", { code: "" }, undefined, undefined, { cwd: process.cwd() });
    mock.mockRestore();
    const signal = new AbortController().signal;
    const ctx = contextFixture({ mode: "print", signal });
    const task = await rpc("shell", { command: "read value; printf done", waitSeconds: 0 }, signal);
    const boundary = e.fire("agent_end", { messages: [] }, ctx);
    await Bun.sleep(25);
    await rpc("jobs.input", { id: task.id, data: "go\n", closeInput: true }, signal);
    await boundary;
    const deadline = Date.now() + 2000;
    while (!e.messages.length && Date.now() < deadline) await Bun.sleep(10);
    expect(e.messages).toHaveLength(1);
    expect(e.messages[0].customType).toBe("task-complete");
    expect(e.messages[0].content).toContain("completed");
    // Stale attention for the now-completed task is removed from the same batch.
    expect(e.messages[0].content).not.toContain("attention checkpoint");
  } finally {
    mock.mockRestore();
    await e.fire("session_shutdown", {}, contextFixture());
  }
});

test("root values are part of the agent frame and explicit user prompts retain precedence", async () => {
  const e = load();
  const ctx = contextFixture();
  const framed = await e.fire("before_agent_start", { systemPrompt: "base", systemPromptOptions: {} }, ctx);
  expect(framed.systemPrompt).toContain("Working together");
  expect(framed.systemPrompt).toContain("Responsive collaboration");
  expect(framed.systemPrompt).toContain("main agent in orchestrator instruction mode");
  expect(framed.systemPrompt).toContain("delegation permissions remain available");
  const custom = await e.fire(
    "before_agent_start",
    { systemPrompt: "user custom", systemPromptOptions: { customPrompt: "user custom" } },
    ctx,
  );
  expect(custom).toBeUndefined();
});

test("session lifecycle resets resumed child identity when returning to root", async () => {
  const e = load();
  const root = contextFixture({ sessionId: "root" });
  const child = contextFixture({
    sessionId: "child",
    entries: [{ type: "custom", customType: "die-agent", data: { type: "normal", depth: 1 } }],
  });
  let framed = await e.fire("before_agent_start", { systemPrompt: "base", systemPromptOptions: {} }, root);
  expect(framed.systemPrompt).toContain("main agent in orchestrator instruction mode");
  await e.fire("session_shutdown", {}, root);
  await e.fire("session_start", {}, child);
  framed = await e.fire("before_agent_start", { systemPrompt: "base", systemPromptOptions: {} }, child);
  expect(framed.systemPrompt).toContain("You are a normal sub-agent");
  await e.fire("session_shutdown", {}, child);
  await e.fire("session_start", {}, root);
  framed = await e.fire("before_agent_start", { systemPrompt: "base", systemPromptOptions: {} }, root);
  expect(framed.systemPrompt).toContain("main agent in orchestrator instruction mode");
  expect(framed.systemPrompt).not.toContain("You are a normal sub-agent");
  await e.fire("session_shutdown", {}, root);
});

test("spawned child environment remains the identity floor before metadata is attached", async () => {
  const e = load(1, "fast");
  const ctx = contextFixture({ sessionId: "fresh-child" });
  await e.fire("session_start", {}, ctx);
  const framed = await e.fire("before_agent_start", { systemPrompt: "base", systemPromptOptions: {} }, ctx);
  expect(framed.systemPrompt).toContain("You are a fast sub-agent");
  expect(framed.systemPrompt).not.toContain("main agent in");
  await e.fire("session_shutdown", {}, ctx);
});

test("spawned environment roles cannot be changed by resumed metadata", async () => {
  const cases = [
    { environment: "normal", metadata: "orchestrator", delegation: "Delegation is disabled" },
    { environment: "orchestrator", metadata: "normal", delegation: "Fast/normal workers are available" },
  ] as const;
  for (const item of cases) {
    const e = load(1, item.environment);
    const entries = [{ type: "custom", customType: "die-agent", data: { type: item.metadata, depth: 1 } }];
    const ctx = contextFixture({ sessionId: "role-cap-" + item.environment, entries });
    await e.fire("session_start", {}, ctx);
    const framed = await e.fire("before_agent_start", { systemPrompt: "base", systemPromptOptions: {} }, ctx);
    expect(framed.systemPrompt).toContain("You are a " + item.environment + " sub-agent");
    expect(framed.systemPrompt).not.toContain("You are a " + item.metadata + " sub-agent");
    expect(framed.systemPrompt).toContain(item.delegation);
    await e.fire("session_shutdown", {}, ctx);
  }
});

test("mixed completion and attention reserve bounded evidence for both", async () => {
  let now = Date.now(),
    nextTimer = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock = {
    now: () => now,
    setTimeout: (callback: () => void, delay: number) => {
      const id = nextTimer++;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout: (id: unknown) => timers.delete(id as number),
  };
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      const due = [...timers].find(([, timer]) => timer.at <= now);
      if (!due) break;
      timers.delete(due[0]);
      due[1].callback();
    }
  };
  const e = load(0, undefined, { attention: { quietMs: 15, reviewMs: 1000, clock } });
  let rpc: any;
  const mock = spyOn(execution, "executeIsolated").mockImplementation(async (_c, _w, _s, _t, options) => {
    rpc = options!.jobHandler;
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      stdoutLost: false,
      stderrLost: false,
      timedOut: false,
      cancelled: false,
      images: [],
    };
  });
  try {
    await e.tools.get("execute").execute("bind", { code: "" }, undefined, undefined, { cwd: process.cwd() });
    mock.mockRestore();
    const signal = new AbortController().signal;
    const ctx = contextFixture({ mode: "print", signal });
    const idle = await rpc("shell", { command: "read value", waitSeconds: 0 }, signal);
    const finishing = await rpc(
      "shell",
      { command: "read value; head -c 20000 /dev/zero | tr '\\0' x", waitSeconds: 0 },
      signal,
    );
    const boundary = e.fire("agent_end", { messages: [] }, ctx);
    advance(15);
    await rpc("jobs.input", { id: finishing.id, data: "go\n", closeInput: true }, signal);
    while ((await rpc("jobs.inspect", { id: finishing.id }, signal)).status === "running") await Bun.sleep(1);
    await boundary;
    expect(e.messages).toHaveLength(1);
    const message = e.messages[0];
    expect(message.content.length).toBeLessThanOrEqual(5000);
    expect(message.content).toContain(finishing.id);
    expect(message.content).toContain("completed");
    expect(message.content).toContain(idle.id);
    expect(message.content).toContain("attention checkpoint");
    expect(message.details.omittedAttention).toBe(0);
    await rpc("jobs.stop", { id: idle.id }, signal);
  } finally {
    mock.mockRestore();
    await e.fire("session_shutdown", {}, contextFixture());
  }
});

for (const data of [
  undefined,
  null,
  { type: "unknown", depth: 1 },
  { type: "orchestrator", depth: 0 },
  { type: "normal", depth: 1.5 },
]) {
  test("invalid child marker never restores root or delegation: " + JSON.stringify(data), async () => {
    const e = load();
    const ctx = contextFixture({
      entries: [
        { type: "custom", customType: "die-agent", data: { type: "orchestrator", depth: 1 } },
        { type: "custom", customType: "die-agent", data },
      ],
    });
    await e.fire("session_start", {}, ctx);
    const result = await e.fire("before_agent_start", { systemPrompt: "base" }, ctx);
    expect(result.systemPrompt).toContain("You are a normal sub-agent");
    expect(result.systemPrompt).toContain("Delegation is disabled");
    expect(result.systemPrompt).not.toContain("main agent in");
    await e.fire("session_shutdown", {}, ctx);
  });
}

test("unreadable child metadata fails closed", async () => {
  const e = load();
  const ctx = contextFixture({
    sessionManager: {
      getBranch() {
        throw new Error("unreadable");
      },
    },
  });
  const result = await e.fire("before_agent_start", { systemPrompt: "base" }, ctx);
  expect(result.systemPrompt).toContain("Delegation is disabled");
  expect(result.systemPrompt).not.toContain("main agent in");
});

test("malformed trailing branch entry fails closed instead of retaining root privileges", async () => {
  const e = load();
  const entries: any[] = [{ type: "custom", customType: "die-agent", data: { type: "orchestrator", depth: 1 } }];
  const ctx = contextFixture({ entries });
  await e.fire("session_start", {}, ctx);
  entries.push(null);
  const result = await e.fire("before_agent_start", { systemPrompt: "base" }, ctx);
  expect(result.systemPrompt).toContain("You are a normal sub-agent");
  expect(result.systemPrompt).toContain("Delegation is disabled");
  await e.fire("session_shutdown", {}, ctx);
});

test("throwing identity data getter fails closed", async () => {
  const marker = { type: "custom", customType: "die-agent" } as Record<string, unknown>;
  Object.defineProperty(marker, "data", {
    get: () => {
      throw new Error("hostile");
    },
  });
  const e = load();
  const ctx = contextFixture({ entries: [marker] });
  await e.fire("session_start", {}, ctx);
  const result = await e.fire("before_agent_start", { systemPrompt: "base" }, ctx);
  expect(result.systemPrompt).toContain("You are a normal sub-agent");
  expect(result.systemPrompt).toContain("Delegation is disabled");
  await e.fire("session_shutdown", {}, ctx);
});

test("shutdown persists every shell ownership cause without duplicating inspect content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "die-extension-lifecycle-"));
  const sessionFile = join(dir, "root.jsonl");
  const ctx = contextFixture({ sessionManager: { getSessionFile: () => sessionFile } });
  const e = load();
  let rpc: any;
  const mock = spyOn(execution, "executeIsolated").mockImplementation(async (_c, _w, _s, _t, options) => {
    rpc = options!.jobHandler;
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      stdoutLost: false,
      stderrLost: false,
      timedOut: false,
      cancelled: false,
      images: [],
    };
  });
  try {
    await e.fire("session_start", {}, ctx);
    await e.tools.get("execute").execute("bind", { code: "" }, undefined, undefined, ctx);
    mock.mockRestore();
    const signal = new AbortController().signal;
    const command = "printf sentinel-useful-output; read sentinel-useful-input";
    const first = await rpc("shell", { command, waitSeconds: 0 }, signal);
    const second = await rpc("shell", { command: "read other", waitSeconds: 0 }, signal);
    const inspected = await rpc("jobs.inspect", { id: first.id }, signal);
    expect(inspected.command).toBe(command);
    await e.fire("session_shutdown", {}, ctx);
    const raw = readFileSync(taskLifecycleFile(sessionFile), "utf8");
    const records = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const id of [first.id, second.id]) {
      expect(records.find((r) => r.taskId === id && r.event === "stopping").termination.cause).toBe("session-shutdown");
      expect(records.find((r) => r.taskId === id && r.event === "completed").status).toBe("killed");
    }
    expect(raw).not.toContain("sentinel-useful");
    const resumed = load();
    await resumed.fire("session_start", {}, ctx);
    expect(readFileSync(taskLifecycleFile(sessionFile), "utf8")).toBe(raw);
    await resumed.fire("session_shutdown", {}, ctx);
  } finally {
    mock.mockRestore();
    await e.fire("session_shutdown", {}, ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});
