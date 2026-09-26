import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, getModel } from "@earendil-works/pi-ai/compat";
import { installCurrentConversationAdapter } from "../src/agent/instruction-continuity";
import { acquireMainOwner } from "../src/live/main-owner";
import { dieSystemPrompt } from "../src/prompts";
import { registerExecuteTool } from "../src/typescript/extension";

test("paired owner delegates a real Pi prompt, tool execution and completion to the selected backend", async () => {
  installCurrentConversationAdapter();
  const dir = await mkdtemp(join(tmpdir(), "paired-runtime-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const hooks: string[] = [];
    const feedback: string[] = [];
    const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, systemPrompt: dieSystemPrompt(), extensionFactories: [{ name: "paired-observe", factory: pi => {
      registerExecuteTool(pi, undefined, undefined, () => 0);
      pi.on("before_agent_start", event => { hooks.push("start:" + event.prompt); return { systemPrompt: event.systemPrompt + "\nPAIRED_HOOK" }; });
      pi.on("tool_call", event => { hooks.push("call:" + event.toolName); });
      pi.on("tool_result", event => { hooks.push("result:" + event.toolName); });
    } }] });
    await loader.reload();
    const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
    runtime.hasConfiguredAuth = () => true;
    ({ session } = await createAgentSession({ cwd: dir, agentDir: dir, resourceLoader: loader, modelRuntime: runtime, model: getModel("openai-codex", "gpt-5.6-luna"), sessionManager: SessionManager.inMemory(dir), tools: ["execute"] }));
    await session.bindExtensions({});
    const owner = await acquireMainOwner({} as any, { sessionManager: session.sessionManager, isIdle: () => !session!.isStreaming } as any, { onContext: text => feedback.push(text) });
    owner.delegatedVoice = true;
    let streams = 0;
    session.agent.streamFunction = ((model: any, context: any) => {
      const stream = createAssistantMessageEventStream();
      const call = streams++ === 0;
      expect(model.id).toBe("gpt-5.6-luna");
      expect(JSON.stringify(context.messages)).toContain("PAIRED_HOOK");
      const message: any = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: call ? "toolUse" : "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, content: call ? [{ type: "toolCall", id: "paired-call", name: "execute", arguments: { code: 'console.log("PAIRED_REAL_EXECUTE")' } }] : [{ type: "text", text: "Paired work completed." }] };
      stream.push({ type: "done", reason: "stop", message });
      return stream;
    }) as any;
    const run = owner.delegate!("voice-1", "User asks to execute code");
    expect(owner.delegate!("voice-1", "User asks to execute code")).toBe(run);
    owner.interrupt(); // playback interruption must not abort or replay admitted coding work
    owner.close();
    await run;
    await owner.released;
    expect(streams).toBe(2);
    expect(hooks).toContain("start:User asks to execute code");
    expect(hooks).toContain("call:execute");
    expect(hooks).toContain("result:execute");
    expect(JSON.stringify(session.sessionManager.buildSessionContext())).toContain("PAIRED_REAL_EXECUTE");
    expect(feedback.join(" ")).toContain("Paired work completed.");
  } finally { await session?.dispose(); await rm(dir, { recursive: true, force: true }); }
});
