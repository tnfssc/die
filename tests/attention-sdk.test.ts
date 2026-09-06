import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createAssistantMessageEventStream, getModel, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import tasks from "../src/tasks/extension";
import { TaskManager } from "../src/tasks/task-manager";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

test("real SDK print session keeps repeated attention boundaries subscription-bounded", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-attention-sdk-"));
  let session: any;
  const originalSubscribe = TaskManager.prototype.subscribe;
  const originalWait = TaskManager.prototype.wait;
  let activeSubscriptions = 0,
    maxSubscriptions = 0,
    subscriptionCalls = 0,
    waitCalls = 0;
  TaskManager.prototype.subscribe = function (listener) {
    subscriptionCalls++;
    activeSubscriptions++;
    maxSubscriptions = Math.max(maxSubscriptions, activeSubscriptions);
    const unsubscribe = originalSubscribe.call(this, listener);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      activeSubscriptions--;
      unsubscribe();
    };
  };
  TaskManager.prototype.wait = function (id) {
    waitCalls++;
    return originalWait.call(this, id);
  };
  try {
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
      noPromptTemplates: true,
      noThemes: true,
      extensionFactories: [
        {
          name: "die-tasks",
          factory: (pi) =>
            tasks(pi, {
              attention: { quietMs: 5, reviewMs: 10 },
              executablePath: join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "die"),
            }),
        },
      ],
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      resourceLoader: loader,
      model: getModel("openai", "gpt-4o"),
      modelRuntime: runtime,
      sessionManager: SessionManager.inMemory(dir),
      tools: ["execute"],
    }));
    await session.bindExtensions({ mode: "print" });
    let calls = 0;
    session.agent.streamFunction = () => {
      calls++;
      const stream = createAssistantMessageEventStream();
      const content: any[] =
        calls === 1
          ? [
              {
                type: "toolCall",
                id: "spawn_idle",
                name: "execute",
                arguments: { code: 'const job=await shell("read value",{waitSeconds:0}); console.log(job);' },
              },
            ]
          : calls === 7
            ? [
                {
                  type: "toolCall",
                  id: "stop_idle",
                  name: "execute",
                  arguments: {
                    code: "const list=await jobs.list(); for(const job of list.jobs) await jobs.stop(job.id);",
                  },
                },
              ]
            : [{ type: "text", text: "attention received" }];
      const message: AssistantMessage = {
        role: "assistant",
        content,
        api: "openai-chat-completions",
        provider: "openai",
        model: "gpt-4o",
        usage,
        stopReason: calls === 1 || calls === 7 ? "toolUse" : "stop",
        timestamp: Date.now(),
      };
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: message.stopReason as any, message });
      stream.end(message);
      return stream;
    };
    const started = Date.now();
    await session.prompt("start one background job");
    expect(Date.now() - started).toBeGreaterThanOrEqual(10);
    expect(calls).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(session.messages)).toContain("attention checkpoint");
    // Permanent scheduler and lifecycle-index subscriptions, plus one disposable agent_end wait.
    expect(subscriptionCalls).toBeGreaterThanOrEqual(6);
    expect(maxSubscriptions).toBe(3);
    expect(activeSubscriptions).toBe(2);
    expect(waitCalls).toBe(0);
  } finally {
    session?.dispose();
    TaskManager.prototype.subscribe = originalSubscribe;
    TaskManager.prototype.wait = originalWait;
    await rm(dir, { recursive: true, force: true });
  }
}, 10_000);
