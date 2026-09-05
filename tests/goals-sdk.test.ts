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

test("real SDK continues an active goal and executes its terminal update", async () => {
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
      const content: any[] = calls === 2
        ? [{
            type: "toolCall",
            id: "goal_done",
            name: "execute",
            arguments: {
              code: 'console.log(await goal.update({status:"completed", evidence:"SDK execute helper completed"}))',
            },
          }]
        : [{ type: "text", text: calls === 1 ? "First step finished." : "Done." }];
      const message: AssistantMessage = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content,
        stopReason: calls === 2 ? "toolUse" : "stop",
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
        objective: "Finish SDK flow",
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
    expect(prompts[1]).toContain("Goal mode remains active");
    expect(prompts[1]).toContain("Finish SDK flow");
    expect(prompts[0]).toContain("Persistent goal state");

    const last = manager.getEntries()
      .filter((entry: any) => entry.type === "custom" && entry.customType === "die-goal")
      .at(-1) as any;
    expect(last.data.goal).toMatchObject({
      status: "completed",
      evidence: "SDK execute helper completed",
    });
    expect(calls).toBeLessThanOrEqual(3);
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);
