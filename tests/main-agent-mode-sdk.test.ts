import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistantMessageEventStream, getModel, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import tasks from "../src/tasks/extension";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const cleanup: Array<() => void | Promise<void>> = [];
const originalDepth = process.env.DIE_SUBAGENT_DEPTH, originalType = process.env.DIE_SUBAGENT_TYPE;
beforeEach(() => { process.env.DIE_SUBAGENT_DEPTH = "0"; delete process.env.DIE_SUBAGENT_TYPE; });
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
  if (originalDepth === undefined) delete process.env.DIE_SUBAGENT_DEPTH; else process.env.DIE_SUBAGENT_DEPTH = originalDepth;
  if (originalType === undefined) delete process.env.DIE_SUBAGENT_TYPE; else process.env.DIE_SUBAGENT_TYPE = originalType;
});

async function sdk(options: { customPrompt?: string; entries?: Array<[string, unknown]> } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "die-main-mode-sdk-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  let manager = options.entries?.length ? SessionManager.create(dir, join(dir, "sessions")) : SessionManager.inMemory(dir);
  if (options.entries?.length) {
    await writeFile(manager.getSessionFile()!, JSON.stringify(manager.getHeader()) + "\n", { flag: "wx" });
    manager = SessionManager.open(manager.getSessionFile()!);
    for (const [type, data] of options.entries) manager.appendCustomEntry(type, data);
    manager = SessionManager.open(manager.getSessionFile()!);
  }
  let frameCalls = 0;
  const loader = new DefaultResourceLoader({
    cwd: dir, agentDir: dir, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true,
    systemPrompt: options.customPrompt,
    extensionFactories: [
      { name: "frame-before", factory: pi => pi.on("before_agent_start", event => { frameCalls++; return { systemPrompt: event.systemPrompt + "\nFRAME_BEFORE" }; }) },
      { name: "die-tasks", factory: tasks },
      { name: "frame-after", factory: pi => pi.on("before_agent_start", event => ({ systemPrompt: event.systemPrompt + "\nFRAME_AFTER" })) },
    ],
  });
  await loader.reload();
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.hasConfiguredAuth = () => true;
  const created = await createAgentSession({ cwd: dir, agentDir: dir, resourceLoader: loader, modelRuntime: runtime,
    model: getModel("openai-codex", "gpt-5.6-luna"), sessionManager: manager, tools: ["execute"] });
  const session = created.session;
  cleanup.push(() => session.dispose());
  const requests: string[] = [];
  session.agent.streamFunction = ((_model: unknown, context: { systemPrompt: string }) => {
    requests.push(context.systemPrompt);
    const message: AssistantMessage = { role: "assistant", api: "openai-codex-responses", provider: "openai-codex", model: "gpt-5.6-luna",
      timestamp: Date.now(), stopReason: "stop", usage, content: [{ type: "text", text: "done" }] };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "stop", message });
    return stream;
  }) as typeof session.agent.streamFunction;
  return { session, requests, frameCalls: () => frameCalls, manager };
}

test("real SDK defaults main frame to orchestrator and switches behavior without model/thinking mutation", async () => {
  const f = await sdk();
  await f.session.prompt("first");
  expect(f.requests[0]).toContain("main agent in orchestrator instruction mode");
  expect(f.requests[0]).toContain("FRAME_BEFORE"); expect(f.requests[0]).toContain("FRAME_AFTER");
  const model = f.session.model, thinking = f.session.thinkingLevel;
  await f.session.prompt("/mode fast");
  expect(f.requests).toHaveLength(1);
  expect(f.session.model).toBe(model); expect(f.session.thinkingLevel).toBe(thinking);
  await f.session.sendCustomMessage({ customType: "test-notification", content: "automatic", display: true }, { triggerTurn: true });
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]).toContain("main agent in fast instruction mode");
  expect(f.requests[1]).not.toContain("main agent in orchestrator instruction mode");
  expect(f.requests[1]).toContain("FRAME_BEFORE"); expect(f.requests[1]).toContain("FRAME_AFTER");
  expect(f.frameCalls()).toBe(1);
});

test("real SDK preserves an explicit custom system prompt", async () => {
  const f = await sdk({ customPrompt: "EXPLICIT_CUSTOM_SYSTEM" });
  await f.session.prompt("custom");
  expect(f.requests[0]).toContain("EXPLICIT_CUSTOM_SYSTEM");
  expect(f.requests[0]).not.toContain("main agent in");
  expect(f.requests[0]).not.toContain("Working together");
});

test("real SDK restores root instruction mode from durable session history", async () => {
  const f = await sdk({ entries: [["die-instruction-mode", { mode: "normal" }]] });
  await f.session.prompt("resumed");
  expect(f.requests[0]).toContain("main agent in normal instruction mode");
});

test("real SDK child identity and delegation depth ignore inherited root mode", async () => {
  const f = await sdk({ entries: [
    ["die-instruction-mode", { mode: "fast" }],
    ["die-agent", { type: "normal", depth: 2 }],
  ] });
  await f.session.prompt("child");
  expect(f.requests[0]).toContain("You are a normal sub-agent");
  expect(f.requests[0]).toContain("Delegation is disabled at this role/depth");
  expect(f.requests[0]).not.toContain("main agent in fast instruction mode");
  await f.session.prompt("/mode fast");
  expect(f.requests).toHaveLength(1);
});
