import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistantMessageEventStream, type AssistantMessage, type Context } from "@earendil-works/pi-ai/compat";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  ModelRuntime,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { registerExecuteTool } from "../src/typescript/extension";
import asynchronousTasksExtension from "../src/tasks/extension";
import { executeGuidance, executeReference, workingValues } from "../src/prompts";

test("Pi session assembles the registered execute guidance into its system prompt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-prompt-delivery-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    let tool!: ToolDefinition;
    registerExecuteTool({
      registerTool(value: ToolDefinition) {
        tool = value;
      },
      on() {},
    } as unknown as ExtensionAPI);
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      resourceLoader: loader,
      model: getModel("openai", "gpt-4o"),
      sessionManager: SessionManager.inMemory(dir),
      customTools: [tool],
      tools: ["execute"],
    }));
    const prompt = session.systemPrompt;
    for (const guidance of executeGuidance) expect(prompt).toContain(guidance);
    expect(prompt).toContain("- execute:");
    expect(prompt).not.toContain("- bash:");
    console.log("Registered guidance reaches Pi session:", executeGuidance.join("\n").length, "characters");
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("production tasks extension guidance reaches the actual stream context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-prompt-stream-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const modelRuntime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    // Auth preflight is local; the fake stream below never sends a request.
    modelRuntime.hasConfiguredAuth = () => true;
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      extensionFactories: [{ name: "die-tasks", factory: asynchronousTasksExtension }],
      appendSystemPromptOverride: () => ["KEEP_APPEND_GUIDANCE"],
      agentsFilesOverride: () => ({
        agentsFiles: [{ path: join(dir, "AGENTS.md"), content: "KEEP_PROJECT_GUIDANCE" }],
      }),
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      resourceLoader: loader,
      model: getModel("openai-codex", "gpt-5.6-luna"),
      modelRuntime,
      sessionManager: SessionManager.inMemory(dir),
      tools: ["execute"],
    }));

    let streamedContext: Context | undefined;
    session.agent.streamFunction = (_model, context) => {
      streamedContext = context;
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        api: "openai-codex-responses",
        provider: "openai-codex",
        model: "gpt-5.6-luna",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "stop", message });
      return stream;
    };

    await session.prompt("verify prompt delivery");

    expect(streamedContext).toBeDefined();
    const prompt = streamedContext!.systemPrompt ?? "";
    for (const value of workingValues) expect(prompt).toContain(value);
    for (const reference of executeReference) expect(prompt).toContain(reference);
    expect(prompt).toContain("await handoff(message)");
    expect(prompt).toContain("operating inside die,");
    expect(prompt).not.toContain("Pi documentation (");
    expect(prompt).not.toContain("Main documentation:");
    expect(prompt).not.toContain("Always read pi .md files");
    expect(prompt).toContain("KEEP_APPEND_GUIDANCE");
    expect(prompt).toContain("KEEP_PROJECT_GUIDANCE");
    expect(prompt).toContain("Current working directory:");
    expect(streamedContext!.tools?.map((tool) => tool.name)).toEqual(["execute"]);
    await session.prompt("verify the next turn too");
    expect(streamedContext!.systemPrompt).toBe(prompt);
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
