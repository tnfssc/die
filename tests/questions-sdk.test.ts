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
import { registerQuestionRuntime } from "../src/questions/runtime";
import { registerQuestions } from "../src/questions/extension";

test("real Pi command delivers saved reply in one new turn without a visible metadata bubble", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-questions-sdk-"));
  let session: any;
  try {
    const model = getModel("anthropic", "claude-sonnet-4-5")!;
    const modelRuntime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    modelRuntime.hasConfiguredAuth = () => true;
    modelRuntime.getAuth = (async () => ({ auth: { apiKey: "offline" } })) as any;
    const contexts: any[] = [];
    const stream = (_model: any, context: any) => {
      contexts.push(JSON.stringify(context.messages));
      const message: any = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: "text", text: contexts.length === 1 ? "Independent work complete" : "Saved answer used" }],
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
    modelRuntime.stream = stream as any;
    modelRuntime.streamSimple = stream as any;
    const manager = SessionManager.create(dir, join(dir, "sessions"));
    let questions!: ReturnType<typeof registerQuestionRuntime>, ctx: any;
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      systemPrompt: "Offline question test.",
      extensionFactories: [
        {
          name: "questions",
          factory: (pi) => {
            questions = registerQuestionRuntime(pi, { supported: () => true });
            registerQuestions(pi, (context) => questions.commands(context));
            pi.on("before_agent_start", (_event, context) => {
              ctx = context;
            });
          },
        },
      ],
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      resourceLoader: loader,
      model,
      modelRuntime,
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
      tools: [],
    }));
    await session.prompt("Do independent work");
    const q = await questions.service.ask(ctx, { text: "Pick target?", choices: ["A", "B"] });
    await session.prompt("/questions answer " + q.id + " A");
    for (let i = 0; i < 100 && contexts.length < 2; i++) await Bun.sleep(10);
    expect(contexts).toHaveLength(2);
    expect(contexts[1]).toContain(q.id);
    expect(contexts[1]).toContain("reply_");
    const saved = manager
      .getEntries()
      .filter((entry: any) => entry.type === "custom_message" && entry.customType === "question-answer") as any[];
    expect(saved).toHaveLength(1);
    expect(saved[0].display).toBe(false);
    await session.prompt("/questions answer " + q.id + " A");
    await Bun.sleep(20);
    expect(contexts).toHaveLength(2);
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
