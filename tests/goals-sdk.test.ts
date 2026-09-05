import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createAssistantMessageEventStream,
  getModel,
  type AssistantMessage,
} from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import tasks from "../src/tasks/extension";

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
      const content: any[] = calls === 1
        ? [{
            type: "toolCall",
            id: "goal_wait",
            name: "execute",
            arguments: {
              code: 'const job=await shell("sleep 0.1; echo sdk-job",{waitSeconds:0}); console.log(await goal.update({status:"waiting",pendingJobIds:[job.id]})); await handoff("Waiting for owned SDK job")',
            },
          }]
        : calls === 2
          ? [{
              type: "toolCall",
              id: "goal_done",
              name: "execute",
              arguments: {
                code: 'console.log(await goal.update({status:"completed", evidence:"SDK task-complete continuation verified"}))',
              },
            }]
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
        { name: "observe", factory: pi => pi.on("agent_settled", () => { settled++; }) },
        {
          name: "die-tasks",
          factory: pi => tasks(pi, {
            executablePath: resolve(import.meta.dir, "../dist/die"),
          }),
        },
        {
          name: "goal-context-filter",
          factory: pi => pi.on("context", event => ({
            messages: event.messages.map((message: any) => message.role === "custom" && message.customType === "die-goal-state"
              ? { ...message, content: message.content.replaceAll("FILTER_RAW", "FILTERED") }
              : message),
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
    expect(prompts[1]).toContain("Owned jobs settled");
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
