import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream, getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { MAX_NO_PROGRESS_CONTINUATIONS } from "../src/goals/controller";
import tasks from "../src/tasks/extension";
import { installLiveDispatchBudget } from "./live-dispatch-budget";

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

test("real SDK reconciles helper waiting through task-complete and completes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-goal-sdk-"));
  let session: any;
  try {
    const model = getModel("anthropic", "claude-sonnet-4-5")!;
    const runtime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    runtime.hasConfiguredAuth = () => true;
    runtime.getAuth = (async () => ({ auth: { apiKey: "offline" } })) as any;

    let calls = 0;
    let settled = 0;
    const prompts: string[] = [];
    const scripted = (_model: any, context: any) => {
      calls++;
      prompts.push(JSON.stringify(context));
      const stream = createAssistantMessageEventStream();
      const content: any[] =
        calls === 1
          ? [
              {
                type: "toolCall",
                id: "goal_wait",
                name: "execute",
                arguments: {
                  code: 'await shell("sleep 0.1; echo sdk-job",{waitSeconds:0}); await handoff("Waiting for owned SDK job")',
                },
              },
            ]
          : calls === 2
            ? [
                {
                  type: "toolCall",
                  id: "goal_done",
                  name: "execute",
                  arguments: {
                    code: 'console.log(await goal.update({status:"completed", evidence:"SDK task-complete continuation verified"}))',
                  },
                },
              ]
            : [{ type: "text", text: "Done." }];
      const message: AssistantMessage = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content,
        stopReason: calls <= 2 ? "toolUse" : "stop",
        usage,
        timestamp: Date.now(),
      };
      queueMicrotask(() => {
        stream.push({ type: "done", reason: message.stopReason as any, message });
        stream.end(message);
      });
      return stream;
    };
    runtime.stream = scripted as any;
    runtime.streamSimple = scripted as any;

    const manager = SessionManager.create(dir, join(dir, "sessions"));
    manager.appendCustomEntry("die-goal", {
      version: 1,
      operation: "set",
      at: "2026-01-01T00:00:00Z",
      goal: {
        id: "g",
        revision: 1,
        objective: "Finish SDK FILTER_RAW flow",
        criteria: ["record evidence"],
        constraints: ["offline"],
        status: "active",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    });
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      extensionFactories: [
        {
          name: "observe",
          factory: (pi) =>
            pi.on("agent_settled", () => {
              settled++;
            }),
        },
        {
          name: "die-tasks",
          factory: (pi) =>
            tasks(pi, {
              executablePath: resolve(import.meta.dir, "../dist/die"),
            }),
        },
        {
          name: "goal-context-filter",
          factory: (pi) =>
            pi.on("context", (event) => ({
              messages: event.messages.map((message: any) =>
                message.role === "custom" && message.customType === "die-goal-state"
                  ? { ...message, content: message.content.replaceAll("FILTER_RAW", "FILTERED") }
                  : message,
              ),
            })),
        },
      ],
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      resourceLoader: loader,
      model,
      modelRuntime: runtime,
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
      tools: ["execute"],
    }));

    await session.prompt("Begin");
    for (let attempt = 0; attempt < 100 && calls < 3; attempt++) await Bun.sleep(10);
    expect({ calls, settled }).toMatchObject({ calls: 3 });
    expect(prompts[0]).toContain("Status: active");
    expect(prompts[0]).toContain("Finish SDK FILTERED flow");
    expect(prompts[0]).not.toContain("FILTER_RAW");
    expect(prompts[1]).toContain("sdk-job");
    expect(prompts[1]).toContain("Status: active");
    expect(prompts[1]).not.toContain("Owned jobs settled");
    expect(JSON.parse(prompts[1]!).systemPrompt).toBe(JSON.parse(prompts[0]!).systemPrompt);

    const entries = manager.getEntries();
    const goalStatuses = entries
      .filter((entry: any) => entry.type === "custom" && entry.customType === "die-goal")
      .map((entry: any) => entry.data.goal?.status)
      .filter(Boolean);
    expect(goalStatuses.slice(-3)).toEqual(["waiting", "active", "completed"]);
    expect(entries.some((entry: any) => entry.customType === "task-complete")).toBe(true);
    const last = entries
      .filter((entry: any) => entry.type === "custom" && entry.customType === "die-goal")
      .at(-1) as any;
    expect(last.data.goal).toMatchObject({
      status: "completed",
      evidence: "SDK task-complete continuation verified",
    });
    expect(calls).toBeLessThanOrEqual(3);
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);

async function runRealPrintCompletionCycles(recordMilestones: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "die-goal-print-sdk-"));
  let session: any;
  try {
    const model = getModel("anthropic", "claude-sonnet-4-5")!;
    const runtime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    runtime.hasConfiguredAuth = () => true;
    runtime.getAuth = (async () => ({ auth: { apiKey: "offline" } })) as any;
    const cycleLimit = MAX_NO_PROGRESS_CONTINUATIONS + 2;
    let calls = 0;
    let ended = 0;
    let settled = 0;
    const scripted = (_model: any, context: any) => {
      calls++;
      const serialized = JSON.stringify(context);
      const paused = serialized.includes("Status: paused");
      const completed = serialized.includes("Status: completed");
      const shouldCycle = !paused && !completed && (!recordMilestones || calls <= cycleLimit);
      let content: any[];
      if (shouldCycle) {
        const setup =
          calls === 1
            ? 'await goal.set({objective:"Bound real print completion cycles",criteria:["stop or complete"],constraints:["offline"]});'
            : "";
        const progress = recordMilestones
          ? 'await goal.update({status:"active",progress:"verified print milestone ' + calls + '"});'
          : "";
        content = [
          {
            type: "toolCall",
            id: "print_cycle_" + calls,
            name: "execute",
            arguments: {
              code:
                setup +
                progress +
                'const job=await shell("sleep 0.03; exit 7",{waitSeconds:0}); console.log(job); await handoff("waiting for failing print job ' +
                calls +
                '");',
            },
          },
        ];
      } else if (recordMilestones && !paused && !completed) {
        content = [
          {
            type: "toolCall",
            id: "print_complete",
            name: "execute",
            arguments: {
              code: 'console.log(await goal.update({status:"completed",evidence:"distinct print milestones survived automatic completion runs"}))',
            },
          },
        ];
      } else {
        content = [{ type: "text", text: "Paused goal respected; no more jobs." }];
      }
      const message: AssistantMessage = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content,
        stopReason: content[0]?.type === "toolCall" ? "toolUse" : "stop",
        usage,
        timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "done", reason: message.stopReason as any, message });
        stream.end(message);
      });
      return stream;
    };
    runtime.stream = scripted as any;
    runtime.streamSimple = scripted as any;
    const manager = SessionManager.create(dir, join(dir, "sessions"));
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      extensionFactories: [
        {
          name: "observe",
          factory: (pi) => {
            pi.on("agent_end", () => {
              ended++;
            });
            pi.on("agent_settled", () => {
              settled++;
            });
          },
        },
        { name: "die-tasks", factory: (pi) => tasks(pi, { executablePath: resolve(import.meta.dir, "../dist/die") }) },
      ],
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      resourceLoader: loader,
      model,
      modelRuntime: runtime,
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
      tools: ["execute"],
    }));
    await session.bindExtensions({ mode: "print" });
    await session.prompt("Start real print completion cycle");
    return { calls, ended, settled, entries: manager.getEntries() };
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}

test("real SDK print completion cycles pause within bounded agent runs", async () => {
  const result = await runRealPrintCompletionCycles(false);
  expect(result.settled).toBe(1);
  expect(result.ended).toBe(result.calls);
  expect(result.calls).toBeLessThanOrEqual(MAX_NO_PROGRESS_CONTINUATIONS + 1);
  const goals: any[] = result.entries.filter(
    (entry: any) => entry.type === "custom" && entry.customType === "die-goal",
  );
  expect(goals.at(-1)?.data.goal).toMatchObject({
    status: "paused",
    pauseReason: expect.stringContaining("no meaningful progress"),
  });
  const completions = result.entries.filter((entry: any) => entry.customType === "task-complete");
  expect(completions).toHaveLength(MAX_NO_PROGRESS_CONTINUATIONS);
  expect(JSON.stringify(completions)).toContain('"status":"failed"');
}, 15_000);

test("real SDK print completion cycles accept distinct explicit milestones", async () => {
  const result = await runRealPrintCompletionCycles(true);
  expect(result.settled).toBe(1);
  expect(result.ended).toBe(MAX_NO_PROGRESS_CONTINUATIONS + 3);
  expect(result.calls).toBe(MAX_NO_PROGRESS_CONTINUATIONS + 4);
  const goals: any[] = result.entries.filter(
    (entry: any) => entry.type === "custom" && entry.customType === "die-goal",
  );
  expect(goals.some((entry: any) => entry.data.goal?.status === "paused")).toBe(false);
  expect(goals.at(-1)?.data.goal).toMatchObject({
    status: "completed",
    evidence: "distinct print milestones survived automatic completion runs",
  });
}, 15_000);

test("live goal fixture reaches an intercepted real-runtime provider offline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-goal-provider-sdk-"));
  let session: any;
  let restoreBudget: (() => void) | undefined;
  let restoreProvider: (() => void) | undefined;
  try {
    const model = getModel("openai-codex", "gpt-5.6-luna")!;
    const runtime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    const provider = runtime.getProvider(model.provider)!;
    expect(provider).toBeDefined();

    runtime.hasConfiguredAuth = (() => true) as any;
    runtime.getAuth = (async () => ({ auth: { apiKey: "offline" } })) as any;
    const originalProviderStream = provider.streamSimple;
    let intercepted = 0;
    let interceptedOptions: any;
    provider.streamSimple = ((_model: any, _context: any, options: any) => {
      intercepted++;
      interceptedOptions = options;
      throw new Error("OFFLINE_PROVIDER_INTERCEPT");
    }) as any;
    restoreProvider = () => {
      provider.streamSimple = originalProviderStream;
    };

    const dispatches: unknown[] = [];
    const budget = installLiveDispatchBudget(runtime, model.provider, 1, (item) => dispatches.push(item));
    restoreBudget = budget.restore;
    const manager = SessionManager.create(dir, join(dir, "sessions"));
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      extensionFactories: [
        {
          name: "die-tasks",
          factory: (pi) => tasks(pi, { executablePath: resolve(import.meta.dir, "../dist/die") }),
        },
      ],
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      resourceLoader: loader,
      model,
      modelRuntime: runtime,
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory({ transport: "sse", compaction: { enabled: false } }),
      thinkingLevel: "medium",
      tools: ["execute"],
    }));

    let assistant: any;
    session.subscribe((event: any) => {
      if (event.type === "message_end" && event.message.role === "assistant") assistant = event.message;
    });
    await session.prompt(
      "/goal set Verify offline provider interception --criteria Reach provider dispatch --constraints Do not retry",
    );
    for (let attempt = 0; attempt < 100 && !assistant; attempt++) await Bun.sleep(10);
    await session.waitForIdle();
    expect({ intercepted, invocations: budget.invocations, dispatches: budget.dispatches }).toEqual({
      intercepted: 1,
      invocations: 1,
      dispatches: 1,
    });
    expect(dispatches).toHaveLength(1);
    expect(interceptedOptions).toMatchObject({ maxRetries: 0, transport: "sse" });
    expect(assistant).toMatchObject({ stopReason: "error" });
    expect(assistant.errorMessage).toContain("OFFLINE_PROVIDER_INTERCEPT");
    const latestGoal = manager
      .getEntries()
      .filter((entry: any) => entry.type === "custom" && entry.customType === "die-goal")
      .at(-1) as any;
    expect(latestGoal.data.goal).toMatchObject({
      status: "paused",
      pauseReason: expect.stringContaining("interrupted agent turn"),
    });
  } finally {
    session?.dispose();
    restoreBudget?.();
    restoreProvider?.();
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);
