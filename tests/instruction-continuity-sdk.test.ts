import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistantMessageEventStream, getModel, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import tasks from "../src/tasks/extension";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

for (const { customPrompt, emptyFrame } of [
  { customPrompt: undefined, emptyFrame: false },
  { customPrompt: "EXPLICIT_CUSTOM_SYSTEM_PROMPT", emptyFrame: false },
  { customPrompt: undefined, emptyFrame: true },
] as const) {
  test(`SDK keeps die's complete instruction frame across custom tool continuation (custom=${!!customPrompt}, empty=${emptyFrame})`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-frame-sdk-"));
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    try {
      let frameHookCalls = 0;
      const loader = new DefaultResourceLoader({
        cwd: dir, agentDir: dir, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true,
        systemPrompt: customPrompt,
        appendSystemPrompt: ["APPENDED_PROJECT_CONTEXT"],
        extensionFactories: [
          { name: "extra-frame", factory: pi => pi.on("before_agent_start", event => { frameHookCalls++; return { systemPrompt: event.systemPrompt + "\n\nEXTRA_EXTENSION_INSTRUCTION" }; }) },
          { name: "die-tasks", factory: tasks },
          // A framing hook loaded after die must also survive custom turns.
          { name: "post-die-frame", factory: pi => pi.on("before_agent_start", event => ({ systemPrompt: emptyFrame ? "" : event.systemPrompt + "\n\nPOST_DIE_EXTENSION_INSTRUCTION" + (event.prompt.includes("normal subsequent") ? "::UPDATED" : "") })) },
        ],
      });
      await loader.reload();
      const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
      runtime.hasConfiguredAuth = () => true;
      ({ session } = await createAgentSession({
        cwd: dir, agentDir: dir, resourceLoader: loader, modelRuntime: runtime,
        model: getModel("openai-codex", "gpt-5.6-luna"), sessionManager: SessionManager.inMemory(dir), tools: ["execute"],
      }));

      const requests: Array<{ systemPrompt: string; messages: unknown[] }> = [];
      const execute = session.agent.state.tools.find(tool => tool.name === "execute")!;
      session.agent.state.tools = session.agent.state.tools.map(tool => tool.name === "execute" ? {
        ...execute,
        execute: async () => ({ content: [{ type: "text", text: "ACTUAL_EXECUTE_RESULT" }], details: {} }),
      } : tool);
      let call = 0;
      session.agent.streamFunction = ((_model: unknown, context: { systemPrompt: string; messages: unknown[] }) => {
        requests.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) });
        call++;
        const tool = call === 2;
        const message: AssistantMessage = {
          role: "assistant", api: "openai-codex-responses", provider: "openai-codex", model: "gpt-5.6-luna",
          timestamp: Date.now(), stopReason: tool ? "toolUse" : "stop", usage,
          content: tool
            ? [{ type: "toolCall", id: "continuity-tool", name: "execute", arguments: { code: 'console.log("tool-ok")' } }]
            : [{ type: "text", text: "done" }],
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: tool ? "toolUse" : "stop", message });
        return stream;
      }) as typeof session.agent.streamFunction;

      await session.prompt("ordinary user turn");
      await session.sendCustomMessage({ customType: "task-complete", content: "idle completion", display: true }, { triggerTurn: true });
      await session.prompt("normal subsequent user turn");
      await session.sendCustomMessage({ customType: "task-complete", content: "after updated frame", display: true }, { triggerTurn: true });

      expect(requests).toHaveLength(5);
      expect(frameHookCalls).toBe(2);
      const initial = requests[0]!.systemPrompt;
      const updated = requests[3]!.systemPrompt;
      expect(requests.map(request => request.systemPrompt)).toEqual([initial, initial, initial, updated, updated]);
      if (!emptyFrame) expect(updated).toBe(initial + "::UPDATED");
      if (emptyFrame) {
        expect(initial).toBe("");
      } else {
        expect(initial).toContain("EXTRA_EXTENSION_INSTRUCTION");
        expect(initial).toContain("POST_DIE_EXTENSION_INSTRUCTION");
        expect(initial).toContain("APPENDED_PROJECT_CONTEXT");
        if (customPrompt) {
          expect(initial).toContain(customPrompt);
          expect(initial).not.toContain("You are die");
        } else {
          expect(initial).toContain("die");
          expect(initial).toContain("Responsive collaboration");
        }
      }
      const toolResult = (requests[2]!.messages as any[]).find(message => message.role === "toolResult" && message.toolCallId === "continuity-tool");
      expect(toolResult).toBeDefined();
      expect(toolResult.isError).not.toBe(true);
      expect(toolResult.content.map((part: any) => part.text).join("\n")).toBe("ACTUAL_EXECUTE_RESULT");
    } finally {
      session?.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
}


test("fresh compaction prepares the frame and redacted context for a later custom multi-tool turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-fresh-frame-sdk-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const model = getModel("anthropic", "claude-sonnet-4-5")!;
    const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
    runtime.hasConfiguredAuth = () => true;
    runtime.getAuth = (async () => ({ auth: { apiKey: "offline-key" } })) as any;
    let manager = SessionManager.create(dir, join(dir, "sessions"));
    manager.appendMessage({ role: "user", content: "PRIVATE_FRESH_VALUE " + "old-context ".repeat(5000), timestamp: 1 });
    manager.appendMessage({ role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [{ type: "text", text: "old answer" }], stopReason: "stop", usage, timestamp: 2 });
    manager.appendMessage({ role: "user", content: "recent request " + "recent-context ".repeat(500), timestamp: 3 });
    manager.appendMessage({ role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [{ type: "text", text: "recent answer" }], stopReason: "stop", usage, timestamp: 4 });
    manager = SessionManager.open(manager.getSessionFile()!);
    let contextCalls = 0;
    let frameCalls = 0;
    const loader = new DefaultResourceLoader({
      cwd: dir, agentDir: dir, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true,
      extensionFactories: [
        { name: "die-tasks", factory: tasks },
        { name: "after-die", factory: pi => {
          pi.on("before_agent_start", event => { frameCalls++; return { systemPrompt: event.systemPrompt + "\nFRESH_PREPARED_FRAME" }; });
          pi.on("context", event => {
            contextCalls++;
            return { messages: event.messages.map(message => message.role === "user" && typeof message.content === "string"
              ? { ...message, content: message.content.replaceAll("PRIVATE_FRESH_VALUE", "[FRESH_REDACTED]") }
              : message) };
          });
        } },
      ],
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: dir, agentDir: dir, resourceLoader: loader, modelRuntime: runtime, model, sessionManager: manager,
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 128, reserveTokens: 8192 } }),
      tools: ["execute"],
    }));

    const seen: Array<{ systemPrompt: string; messages: any[] }> = [];
    let phase: "compact" | "custom-first" | "custom-continuation" = "compact";
    const execute = session.agent.state.tools.find(tool => tool.name === "execute")!;
    session.agent.state.tools = session.agent.state.tools.map(tool => tool.name === "execute" ? {
      ...execute,
      execute: async (id: string) => ({ content: [{ type: "text", text: "result-for-" + id }], details: {} }),
    } : tool);
    const testStreamFunction = ((_model: unknown, context: { systemPrompt: string; messages: any[] }) => {
      seen.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) });
      const content: any[] = phase === "compact"
        ? [{ type: "text", text: "## Goal\nKeep fresh state." }]
        : phase === "custom-first"
          ? [
              { type: "toolCall", id: "fresh-tool-a", name: "execute", arguments: { code: "a" } },
              { type: "toolCall", id: "fresh-tool-b", name: "execute", arguments: { code: "b" } },
            ]
          : [{ type: "text", text: "custom complete" }];
      const stopReason = phase === "custom-first" ? "toolUse" : "stop";
      if (phase === "custom-first") phase = "custom-continuation";
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason, usage, content } as AssistantMessage;
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: stopReason, message });
      stream.end(message);
      return stream;
    }) as typeof session.agent.streamFunction;
    session.agent.streamFunction = testStreamFunction;

    await session.compact();
    expect(frameCalls).toBe(1);
    expect(contextCalls).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.systemPrompt).toContain("FRESH_PREPARED_FRAME");
    expect(JSON.stringify(seen[0]!.messages)).toContain("[FRESH_REDACTED]");
    expect(JSON.stringify(seen[0]!.messages)).not.toContain("PRIVATE_FRESH_VALUE");

    const refreshed = await session.agent.prepareNextTurnWithContext!({ context: { systemPrompt: "stale-base", messages: session.agent.state.messages, tools: session.agent.state.tools } } as any, new AbortController().signal);
    expect(refreshed?.context?.systemPrompt).toBe(seen[0]!.systemPrompt);

    phase = "custom-first";
    // Compaction rebuilds agent runtime state, so retain the offline transport
    // while exercising the subsequent real custom-turn loop.
    session.agent.streamFunction = testStreamFunction;
    const rebuiltExecute = session.agent.state.tools.find(tool => tool.name === "execute")!;
    session.agent.state.tools = session.agent.state.tools.map(tool => tool.name === "execute" ? {
      ...rebuiltExecute,
      execute: async (id: string) => ({ content: [{ type: "text", text: "result-for-" + id }], details: {} }),
    } : tool);
    await session.sendCustomMessage({ customType: "task-complete", content: [{ type: "text", text: "fresh custom continuation" }], display: true }, { triggerTurn: true });
    expect(seen).toHaveLength(3);
    expect(seen.slice(1).map(request => request.systemPrompt)).toEqual([seen[0]!.systemPrompt, seen[0]!.systemPrompt]);
    const continuation = seen[2]!.messages.filter(message => message.role === "toolResult");
    expect(continuation.map(message => message.content[0]?.text).sort()).toEqual(["result-for-fresh-tool-a", "result-for-fresh-tool-b"]);
    expect(contextCalls).toBe(3);
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 20_000);
