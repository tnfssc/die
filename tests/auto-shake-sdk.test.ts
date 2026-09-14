import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream, getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import tasks from "../src/tasks/extension";

const usage = (input: number) => ({
  input,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: input + 5,
  cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
});

function assistant(model: any, content: any[], input = 20): AssistantMessage {
  return {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content,
    stopReason: content.some((part) => part.type === "toolCall") ? "toolUse" : "stop",
    usage: usage(input),
    timestamp: Date.now(),
  } as AssistantMessage;
}

function appendTrace(manager: SessionManager, model: any, id: string, result: string, input = 20): any[] {
  const call = assistant(
    model,
    [
      { type: "thinking", thinking: "private-" + id },
      { type: "toolCall", id, name: "execute", arguments: { code: "secret-" + id } },
    ],
    input,
  );
  const toolResult = {
    role: "toolResult",
    toolCallId: id,
    toolName: "execute",
    content: [{ type: "text", text: result }],
    isError: false,
    timestamp: Date.now(),
  } as any;
  manager.appendMessage(call);
  manager.appendMessage(toolResult);
  return [call, toolResult];
}

function response(model: any, text: string, input = 20): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();
  const message = assistant(model, [{ type: "text", text }], input);
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: "stop", message });
  stream.end(message);
  return stream;
}

function overflow(model: any): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();
  const message = {
    ...assistant(model, [], 0),
    usage: { ...usage(0), output: 0, totalTokens: 0 },
    stopReason: "error",
    errorMessage: "context_length_exceeded",
  } as AssistantMessage;
  stream.push({ type: "start", partial: message });
  stream.push({ type: "error", reason: "error", error: message });
  stream.end(message);
  return stream;
}

async function fixture(model: any, manager: SessionManager, dir: string) {
  const runtime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.hasConfiguredAuth = () => true;
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    extensionFactories: [{ name: "die-tasks", factory: tasks }],
  });
  await loader.reload();
  const created = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    resourceLoader: loader,
    model,
    modelRuntime: runtime,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true, reserveTokens: 5000, keepRecentTokens: 200 },
      retry: { enabled: false },
    }),
    tools: ["execute"],
  });
  await created.session.bindExtensions({ mode: "print" });
  return created.session;
}

function shakeEntries(manager: SessionManager): any[] {
  return manager
    .getEntries()
    .filter((entry: any) => entry.type === "custom" && entry.customType === "die-manual-shake");
}

for (const [name, baseModel] of [
  ["normal", getModel("openai", "gpt-4o")!],
  ["Codex", getModel("openai-codex", "gpt-5.6-luna")!],
] as const) {
  test(name + " automatic threshold shake wins over compaction and continues the prompt", async () => {
    const dir = await mkdtemp("/var/tmp/die-auto-shake-sdk-");
    let session: any;
    try {
      const model = { ...baseModel, contextWindow: 12000, maxTokens: 4000 };
      const manager = SessionManager.inMemory(dir);
      manager.appendMessage({ role: "user", content: "retain this task", timestamp: 1 });
      appendTrace(manager, model, "threshold", "REMOVABLE_THRESHOLD_TRACE ".repeat(3000));
      session = await fixture(model, manager, dir);
      const contexts: any[][] = [];
      session.agent.streamFunction = (_model: any, context: any) => {
        contexts.push(structuredClone(context.messages));
        return response(model, "continued", contexts.length === 1 ? 9000 : 20);
      };

      await session.prompt("ORIGINAL_THRESHOLD_PROMPT");

      expect(contexts).toHaveLength(1);
      expect(JSON.stringify(contexts[0]).includes("ORIGINAL_THRESHOLD_PROMPT")).toBe(true);
      expect(JSON.stringify(contexts[0]).includes("REMOVABLE_THRESHOLD_TRACE")).toBe(true);
      expect(shakeEntries(manager)).toHaveLength(1);
      expect(manager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(0);

      await session.prompt("FOLLOW_UP_AFTER_AUTOMATIC_SHAKE");
      expect(contexts).toHaveLength(2);
      expect(JSON.stringify(contexts[1]).includes("REMOVABLE_THRESHOLD_TRACE")).toBe(false);
      expect(JSON.stringify(contexts[1]).includes("FOLLOW_UP_AFTER_AUTOMATIC_SHAKE")).toBe(true);
      expect(shakeEntries(manager)).toHaveLength(1);
      expect(manager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(0);
    } finally {
      session?.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  }, 10_000);
}

test("overflow-triggered automatic shake retries the provider once instead of ending the turn", async () => {
  const dir = await mkdtemp("/var/tmp/die-auto-shake-overflow-");
  let session: any;
  try {
    const model = { ...getModel("openai", "gpt-4o")!, contextWindow: 12000, maxTokens: 4000 };
    const manager = SessionManager.inMemory(dir);
    manager.appendMessage({ role: "user", content: "retain overflow task", timestamp: 1 });
    appendTrace(manager, model, "overflow", "REMOVABLE_OVERFLOW_TRACE ".repeat(3000));
    session = await fixture(model, manager, dir);
    const contexts: any[][] = [];
    session.agent.streamFunction = (_model: any, context: any) => {
      contexts.push(structuredClone(context.messages));
      return contexts.length === 1 ? overflow(model) : response(model, "overflow retry succeeded");
    };

    await session.prompt("ORIGINAL_OVERFLOW_PROMPT");

    expect(contexts).toHaveLength(2);
    expect(JSON.stringify(contexts[0]).includes("REMOVABLE_OVERFLOW_TRACE")).toBe(true);
    expect(JSON.stringify(contexts[1]).includes("REMOVABLE_OVERFLOW_TRACE")).toBe(false);
    expect(JSON.stringify(contexts[1]).includes("ORIGINAL_OVERFLOW_PROMPT")).toBe(true);
    expect(shakeEntries(manager)).toHaveLength(1);
    expect(manager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(0);
    const final = manager
      .getEntries()
      .filter((entry: any) => entry.type === "message")
      .at(-1) as any;
    expect(final?.message.content[0]?.text).toBe("overflow retry succeeded");
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 10_000);

test("a preview below 75 percent leaves history untouched when the existing compaction path cancels", async () => {
  const dir = await mkdtemp("/var/tmp/die-auto-shake-reject-");
  let session: any;
  try {
    const model = { ...getModel("openai", "gpt-4o")!, contextWindow: 12000, maxTokens: 4000 };
    const manager = SessionManager.inMemory(dir);
    manager.appendMessage({ role: "user", content: "NONREMOVABLE_HISTORY ".repeat(3000), timestamp: 1 });
    appendTrace(manager, model, "small", "TINY_REMOVABLE_TRACE");
    for (let index = 0; index < 5; index++) {
      manager.appendMessage({
        role: "user",
        content: "retained history " + "content ".repeat(600),
        timestamp: 3 + index * 2,
      } as any);
      manager.appendMessage(
        assistant(model, [{ type: "text", text: "retained reply " + index }], index === 4 ? 9000 : 20),
      );
    }
    session = await fixture(model, manager, dir);
    const contexts: any[][] = [];
    session.agent.streamFunction = (_model: any, context: any) => {
      contexts.push(structuredClone(context.messages));
      return contexts.length === 1 ? response(model, "ordinary answer") : response(model, "automatic summary");
    };

    await session.prompt("REJECTED_PREVIEW_PROMPT");
    await expect(session.compact()).rejects.toThrow("Compaction cancelled");

    expect(contexts).toHaveLength(1);
    expect(JSON.stringify(contexts[0]).includes("TINY_REMOVABLE_TRACE")).toBe(true);
    expect(shakeEntries(manager)).toHaveLength(0);
    expect(manager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(0);
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 10_000);
