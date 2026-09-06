import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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

const smallUsage = {
  input: 20,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 25,
  cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
};
const staleUsage = {
  ...smallUsage,
  input: 8000,
  totalTokens: 8005,
};
function assistant(content: any[], usage = staleUsage): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-chat-completions",
    provider: "openai",
    model: "gpt-4o",
    content,
    stopReason: content.some((part) => part.type === "toolCall") ? "toolUse" : "stop",
    usage,
    timestamp: Date.now(),
  } as AssistantMessage;
}
function appendTrace(manager: SessionManager, id: string, resultText: string) {
  manager.appendMessage(
    assistant([
      { type: "thinking", thinking: "private-" + id },
      { type: "toolCall", id, name: "execute", arguments: { code: "secret-" + id } },
    ]),
  );
  manager.appendMessage({
    role: "toolResult",
    toolCallId: id,
    toolName: "execute",
    content: [{ type: "text", text: resultText }],
    isError: false,
    timestamp: Date.now(),
  } as any);
}
function response(text: string, usage = smallUsage): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();
  const message = assistant([{ type: "text", text }], usage);
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: "stop", message });
  stream.end(message);
  return stream;
}

function errorResponse(messageText: string): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();
  const message = {
    ...assistant([], { ...smallUsage, input: 0, output: 0, totalTokens: 0 }),
    stopReason: "error",
    errorMessage: messageText,
  } as AssistantMessage;
  stream.push({ type: "start", partial: message });
  stream.push({ type: "error", reason: "error", error: message });
  stream.end(message);
  return stream;
}

for (const changedSide of ["result", "call"] as const) {
  test("actual SDK preserves a transformed tool group when the " + changedSide + " side changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-shake-sdk-"));
    let session: any;
    try {
      const manager = SessionManager.inMemory(dir);
      manager.appendMessage({ role: "user", content: "UPSTREAM_EXCLUDED ".repeat(2000), timestamp: 0 });
      manager.appendMessage({ role: "user", content: "task", timestamp: 1 });
      appendTrace(manager, "stable", "stable-result");
      appendTrace(manager, "target", "RAW_SECRET_RESULT");
      const runtime = await ModelRuntime.create({
        authPath: join(dir, "auth.json"),
        modelsPath: null,
        refreshOnCreate: false,
      });
      runtime.hasConfiguredAuth = () => true;
      const notices: string[] = [];
      const loader = new DefaultResourceLoader({
        cwd: dir,
        agentDir: dir,
        noExtensions: true,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        extensionFactories: [
          {
            name: "redact",
            factory: (pi) =>
              pi.on("context", (event, ctx) => {
                ctx.ui.notify = (message: string) => notices.push(message);
                return {
                  messages: event.messages
                    .filter(
                      (message: any) =>
                        !(message.role === "user" && String(message.content).startsWith("UPSTREAM_EXCLUDED")),
                    )
                    .map((message: any) => {
                      if (changedSide === "result" && message.role === "toolResult" && message.toolCallId === "target")
                        return { ...message, content: [{ type: "text", text: "[REDACTED_RESULT]" }] };
                      if (changedSide === "call" && message.role === "assistant")
                        return {
                          ...message,
                          content: message.content.map((part: any) =>
                            part.type === "toolCall" && part.id === "target"
                              ? { ...part, arguments: { code: "[REDACTED_CALL]" } }
                              : part,
                          ),
                        };
                      return message;
                    }),
                };
              }),
          },
          { name: "die-tasks", factory: tasks },
        ],
      });
      await loader.reload();
      ({ session } = await createAgentSession({
        cwd: dir,
        agentDir: dir,
        resourceLoader: loader,
        model: getModel("openai", "gpt-4o"),
        modelRuntime: runtime,
        sessionManager: manager,
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
        tools: ["execute"],
      }));
      await session.bindExtensions({ mode: "print" });
      const contexts: any[] = [];
      session.agent.streamFunction = (_model: any, context: any) => {
        contexts.push(structuredClone(context.messages));
        return response("ordinary response");
      };
      await session.prompt("/shake");
      expect(
        manager.getEntries().some((entry: any) => entry.type === "custom" && entry.customType === "die-manual-shake"),
      ).toBe(true);
      const reportedBefore = Number(
        notices.find((notice) => notice.startsWith("Shake complete"))?.match(/~(\d+) →/)?.[1],
      );
      expect(reportedBefore).toBeLessThan(500);
      await session.prompt("ordinary request");
      expect(contexts).toHaveLength(1);
      const wire = JSON.stringify(contexts[0]);
      expect(wire).not.toContain("secret-stable");
      expect(wire).not.toContain("stable-result");
      expect(wire).toContain("toolCall");
      expect(wire).toContain("target");
      if (changedSide === "result") {
        expect(wire).toContain("[REDACTED_RESULT]");
        expect(wire).not.toContain("RAW_SECRET_RESULT");
      } else {
        expect(wire).toContain("[REDACTED_CALL]");
        expect(wire).not.toContain("secret-target");
        expect(wire).toContain("RAW_SECRET_RESULT");
      }
    } finally {
      session?.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("actual SDK preserves first post-shake overflow compaction and retries once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-shake-overflow-"));
  let session: any;
  try {
    const manager = SessionManager.inMemory(dir);
    manager.appendMessage({ role: "user", content: "task", timestamp: 1 });
    appendTrace(manager, "large", "trace ".repeat(3000));
    for (let index = 0; index < 5; index++) {
      manager.appendMessage({
        role: "user",
        content: "retained history " + "content ".repeat(600),
        timestamp: 2 + index * 2,
      } as any);
      manager.appendMessage(assistant([{ type: "text", text: "retained reply " + index }], staleUsage));
    }
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
    const model = { ...getModel("openai", "gpt-4o")!, contextWindow: 12000, maxTokens: 4000 };
    ({ session } = await createAgentSession({
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
    }));
    await session.bindExtensions({ mode: "print" });
    await session.prompt("/shake");

    const contexts: any[] = [];
    session.agent.streamFunction = (_model: any, context: any) => {
      contexts.push(structuredClone(context.messages));
      if (contexts.length === 1) return errorResponse("context_length_exceeded");
      if (contexts.length === 2) return response("automatic summary");
      return response("retry succeeded");
    };
    await session.prompt("overflow once");

    expect(contexts).toHaveLength(3);
    expect(manager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(1);
    expect(
      (
        manager
          .getEntries()
          .filter((entry: any) => entry.type === "message" && entry.message.role === "assistant")
          .at(-1) as any
      )?.message.content[0]?.text,
    ).toBe("retry succeeded");
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 10_000);

test("actual SDK uses post-shake context for pre-request automatic compaction threshold", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-shake-threshold-"));
  let session: any;
  try {
    const manager = SessionManager.inMemory(dir);
    manager.appendMessage({ role: "user", content: "small task", timestamp: 1 });
    appendTrace(manager, "large", "trace ".repeat(3000));
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
    const model = { ...getModel("openai", "gpt-4o")!, contextWindow: 12000, maxTokens: 4000 };
    ({ session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      resourceLoader: loader,
      model,
      modelRuntime: runtime,
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: true, reserveTokens: 5000, keepRecentTokens: 200 },
      }),
      tools: ["execute"],
    }));
    await session.bindExtensions({ mode: "print" });
    expect(session.model.contextWindow).toBe(12000);
    expect(session.autoCompactionEnabled).toBe(true);
    const contexts: any[] = [];
    session.agent.streamFunction = (_model: any, context: any) => {
      contexts.push(structuredClone(context.messages));
      const serialized = JSON.stringify(context.messages);
      return response(serialized.includes("summary") ? "summary" : "ok", smallUsage);
    };
    const costBeforeShake = manager
      .getEntries()
      .reduce(
        (total: number, entry: any) =>
          total + (entry.type === "message" && entry.message.role === "assistant" ? entry.message.usage.cost.total : 0),
        0,
      );
    await session.prompt("/shake");
    expect(
      manager.getEntries().some((entry: any) => entry.type === "custom" && entry.customType === "die-manual-shake"),
    ).toBe(true);
    const costAfterShake = manager
      .getEntries()
      .reduce(
        (total: number, entry: any) =>
          total + (entry.type === "message" && entry.message.role === "assistant" ? entry.message.usage.cost.total : 0),
        0,
      );
    expect(costAfterShake).toBe(costBeforeShake);
    await session.prompt("ordinary after shake");
    expect(contexts).toHaveLength(1);
    expect(manager.getEntries().some((entry) => entry.type === "compaction")).toBe(false);

    for (let index = 0; index < 5; index++) {
      const user = {
        role: "user",
        content: "genuine history " + "content ".repeat(600),
        timestamp: Date.now() + index,
      } as any;
      const reply = assistant([{ type: "text", text: "history " + index }], index === 4 ? staleUsage : smallUsage);
      manager.appendMessage(user);
      manager.appendMessage(reply);
      session.agent.state.messages.push(user, reply);
    }
    await session.prompt("trigger genuine full context");
    expect(contexts.length).toBeGreaterThanOrEqual(3);
    expect(manager.getEntries().some((entry) => entry.type === "compaction")).toBe(true);
    const totals = manager
      .getEntries()
      .flatMap((entry: any) =>
        entry.type === "message" && entry.message.role === "assistant" ? [entry.message.usage.cost.total] : [],
      );
    expect(totals).toContain(0.03);
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 10_000);
