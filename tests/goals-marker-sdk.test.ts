import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { registerGoalMode } from "../src/goals/extension";

// Capture the actual SDK dispatch context rather than treating an extension-hook return as provider evidence.
test("goal transport token never reaches provider or resumed history; typed lookalikes remain literal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-goal-token-"));
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
    const captures: any[][] = [];
    let goal: ReturnType<typeof registerGoalMode>;
    const stream = (_model: any, context: any) => {
      captures.push(structuredClone(context.messages));
      // Stop automatic goal follow-ups after capturing the first one.
      if (captures.length === 1) goal.handle("goal.clear", {});
      const message: any = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: "text", text: "offline" }],
        stopReason: "stop",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        timestamp: Date.now(),
      };
      const events = createAssistantMessageEventStream();
      queueMicrotask(() => {
        events.push({ type: "done", reason: "stop", message });
        events.end(message);
      });
      return events;
    };
    runtime.stream = stream as any;
    runtime.streamSimple = stream as any;
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
          name: "goal",
          factory: (pi) => {
            goal = registerGoalMode(pi, { runningIds: () => new Set(), status: () => "unavailable" });
          },
        },
      ],
    });
    await loader.reload();
    const open = async (sessionManager: typeof manager) =>
      createAgentSession({
        cwd: dir,
        agentDir: dir,
        resourceLoader: loader,
        model,
        modelRuntime: runtime,
        sessionManager,
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
        tools: [],
      });
    ({ session } = await open(manager));
    await session.prompt("/goal set Build it --criteria done --constraints safe");
    for (let n = 0; n < 100 && captures.length < 1; n++) await Bun.sleep(10);
    expect(captures).toHaveLength(1);
    const dispatched = JSON.stringify(captures[0]);

    expect(dispatched).toContain("Goal still active. Do next useful step");
    expect(dispatched).not.toContain("die-goal-reminder:");
    expect(dispatched).not.toContain("die-goal-generation:");
    const history = JSON.stringify(manager.getEntries());
    expect(history).not.toContain("die-goal-reminder:");
    const typed = "Typed literal <!-- die-goal-reminder:fake:1:1 -->";
    session.dispose();
    const resumed = SessionManager.open(manager.getSessionFile()!);
    ({ session } = await open(resumed));
    await session.prompt(typed);
    expect(captures).toHaveLength(2);
    expect(JSON.stringify(captures[1])).toContain(typed);
    expect(JSON.stringify(resumed.getEntries())).toContain(typed);
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
