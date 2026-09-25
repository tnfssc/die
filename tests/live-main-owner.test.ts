import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, getModel } from "@earendil-works/pi-ai/compat";
import tasks from "../src/agent/extension";
import { dieSystemPrompt } from "../src/prompts";
import { describe, expect, test } from "bun:test";
import { bindInstructionContinuitySession } from "../src/agent/instruction-continuity";
import { acquireMainOwner, beforeOrdinaryPrompt, currentMainOwner } from "../src/live/main-owner";

function fixture() {
  const messages: any[] = [];
  const entries: any[] = [];
  let leaf = 0;
  let active = false;
  let deny = false;
  const hooks: string[] = [];
  const events: any[] = [];
  const manager = {
    getSessionId: () => "s1",
    getLeafId: () => String(leaf),
    appendMessage: (m: any) => {
      entries.push(m);
      leaf++;
      return String(leaf);
    },
    appendCustomMessageEntry: (_: string, text: string) => {
      entries.push(text);
      leaf++;
    },
  };
  const tools = new Map([
    [
      "execute",
      {
        name: "execute",
        description: "execute",
        parameters: {
          type: "object",
          properties: { code: { type: "string" } },
          required: ["code"],
          additionalProperties: false,
        },
        execute: async (_id: string, args: any) => {
          hooks.push("execute:" + args.code);
          return { content: [{ type: "text", text: "result" }] };
        },
      },
    ],
  ]);
  const session = {
    sessionManager: manager,
    _emit: (event: any) => events.push(event),
    _toolRegistry: tools,
    _isAgentRunActive: active,
    getActiveToolNames: () => ["execute"],
    systemPrompt: "ordinary root instructions",
    _baseSystemPromptOptions: { selectedTools: ["execute"] },
    _preparePromptAndToolLoadout: () => undefined,
    _extensionRunner: {
      emitBeforeAgentStart: async () => ({
        messages: [],
        systemPromptOptions: { selectedTools: ["execute"], forceSystemPrompt: "effective ordinary root + hooks" },
      }),
    },
    agent: {
      state: { messages, tools: [...tools.values()] },
      transformContext: async (m: any[]) => {
        hooks.push("context");
        return m;
      },
      beforeToolCall: async () => {
        hooks.push("before");
        return deny ? { block: true, reason: "permission denied" } : undefined;
      },
      afterToolCall: async () => {
        hooks.push("after");
        return undefined;
      },
    },
  };
  bindInstructionContinuitySession(session as any);
  const ctx = { sessionManager: manager, isIdle: () => !active } as any;
  return {
    session,
    ctx,
    manager,
    messages,
    entries,
    hooks,
    events,
    deny: () => {
      deny = true;
    },
    busy: () => {
      active = true;
      session._isAgentRunActive = true;
    },
  };
}

describe("direct Live main owner", () => {
  test("owns actual Pi registered execute and final root/project/hook instructions without streaming text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-live-owner-"));
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    try {
      const loader = new DefaultResourceLoader({
        cwd: dir,
        agentDir: dir,
        noExtensions: true,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        systemPrompt: dieSystemPrompt(),
        appendSystemPrompt: ["PROJECT_CONTEXT_FOR_VOICE"],
        extensionFactories: [
          { name: "die-tasks", factory: tasks },
          {
            name: "post-hook",
            factory: (pi) =>
              pi.on("before_agent_start", (event) => ({ systemPrompt: event.systemPrompt + "\nPOST_HOOK_FOR_VOICE" })),
          },
        ],
      });
      await loader.reload();
      const runtime = await ModelRuntime.create({
        authPath: join(dir, "auth.json"),
        modelsPath: null,
        refreshOnCreate: false,
      });
      runtime.hasConfiguredAuth = () => true;
      ({ session } = await createAgentSession({
        cwd: dir,
        agentDir: dir,
        resourceLoader: loader,
        modelRuntime: runtime,
        model: getModel("openai-codex", "gpt-5.6-luna"),
        sessionManager: SessionManager.inMemory(dir),
        tools: ["execute"],
      }));
      const toolEvents: any[] = [];
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "tool_execution_start" || event.type === "tool_execution_end") toolEvents.push(event);
      });
      let streamed = false;
      session.agent.streamFunction = (() => {
        streamed = true;
        throw new Error("Text model invoked");
      }) as any;
      const owner = await acquireMainOwner(
        {} as any,
        { sessionManager: session.sessionManager, isIdle: () => true } as any,
      );
      expect((owner.orchestration as any).instructions).toContain("PROJECT_CONTEXT_FOR_VOICE");
      expect((owner.orchestration as any).instructions).toContain("POST_HOOK_FOR_VOICE");
      expect(owner.orchestration.tools.map((t) => t.name)).toEqual(["execute"]);
      expect(await owner.orchestration.execute({ name: "execute", args: {} })).toHaveProperty("isError", true);
      expect(toolEvents.map((event) => event.type)).toEqual(["tool_execution_start", "tool_execution_end"]);
      expect(toolEvents[0].args).toEqual({ code: "" });
      expect(toolEvents[1].isError).toBe(true);
      unsubscribe();
      await session.prompt("typed to active live owner");
      expect(
        session.sessionManager
          .buildSessionContext()
          .messages.some((m) => m.role === "user" && JSON.stringify(m.content).includes("typed to active live owner")),
      ).toBe(true);
      await expect(
        (session as any)._runAgentPrompt({
          role: "user",
          content: [{ type: "text", text: "must not invoke text" }],
          timestamp: Date.now(),
        }),
      ).rejects.toThrow("Live owns");
      expect(streamed).toBe(false);
      owner.close();
      await owner.released;
      session.agent.streamFunction = (() => {
        const message: any = {
          role: "assistant",
          api: "openai-codex-responses",
          provider: "openai-codex",
          model: "gpt-5.6-luna",
          timestamp: Date.now(),
          stopReason: "stop",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          content: [{ type: "text", text: "text fallback works" }],
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: "stop", message });
        return stream;
      }) as any;
      await session.prompt("ordinary text after Live");
      expect(
        session.agent.state.messages.some(
          (m) => m.role === "assistant" && JSON.stringify(m.content).includes("text fallback works"),
        ),
      ).toBe(true);
    } finally {
      await session?.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("uses Pi's effective root instructions, registered tool and hooks without text model", async () => {
    const f = fixture();
    const owner = await acquireMainOwner({} as any, f.ctx);
    expect((owner.orchestration as any).instructions).toBe("effective ordinary root + hooks");
    expect((owner.orchestration as any).directMainAgent).toBe(true);
    expect(owner.orchestration.tools.map((t) => t.name)).toEqual(["execute"]);
    owner.inputTranscript("spoken user");
    owner.outputTranscript("spoken answer");
    expect(await owner.orchestration.execute({ name: "execute", args: { code: "1+1" } })).toEqual({
      content: [{ type: "text", text: "result" }],
      isError: false,
    });
    expect(f.hooks).toEqual(["context", "context", "before", "execute:1+1", "after"]);
    expect(f.messages.map((x) => x.role)).toEqual(["user", "assistant", "assistant", "toolResult"]);
    expect(f.entries.map((x) => x.role)).toEqual(f.messages.map((x) => x.role));
    expect(f.events.map((e) => e.type)).toEqual(["tool_execution_start", "tool_execution_end"]);
    expect(f.events[0].args).toEqual({ code: "" });
    expect(f.events[1].result.content).toEqual([{ type: "text", text: "result" }]);
    expect(f.events[1].isError).toBe(false);
    await expect(beforeOrdinaryPrompt(f.manager)).rejects.toThrow("Live owns");
    owner.close();
    await owner.released;
    expect(currentMainOwner(f.manager)).toBeUndefined();
    await beforeOrdinaryPrompt(f.manager);
  });
  test("blocks tool before execution; validates arguments and refuses busy text agent", async () => {
    const f = fixture();
    f.busy();
    await expect(acquireMainOwner({} as any, f.ctx)).rejects.toThrow("Cannot acquire");
    f.session._isAgentRunActive = false;
    const owner = await acquireMainOwner({} as any, { ...f.ctx, isIdle: () => true });
    f.deny();
    expect(await owner.orchestration.execute({ name: "execute", args: { code: "unsafe" } })).toEqual({
      content: [{ type: "text", text: "permission denied" }],
      isError: true,
    });
    expect(f.hooks).toEqual(["context", "before", "after"]);
    expect(f.messages.at(-1).role).toBe("toolResult");
    expect(f.events[1].isError).toBe(true);
    expect(f.events[1].result.content[0].text).toBe("permission denied");
    expect(await owner.orchestration.execute({ name: "execute", args: {} })).toHaveProperty("isError", true);
    owner.close();
    await owner.released;
  });
  test("terminal preview bounds output without changing canonical result or exposing code", async () => {
    const f = fixture();
    (f.session._toolRegistry.get("execute") as any).execute = async () => ({
      content: [{ type: "text", text: "x".repeat(10000) }],
    });
    const owner = await acquireMainOwner({} as any, f.ctx);
    const result = await owner.orchestration.execute({ name: "execute", args: { code: "private token" } });
    expect((result as any).content[0].text).toHaveLength(10000);
    expect(f.messages.at(-1).content[0].text).toHaveLength(10000);
    expect(f.events[0].args).toEqual({ code: "" });
    expect(f.events[1].result.content[0].text).toContain("[output truncated in terminal]");
    expect(f.events[1].result.content[0].text.length).toBeLessThan(4200);
    owner.close();
    await owner.released;
  });
  test("close fences ordinary text until admitted execute has recorded its result", async () => {
    const f = fixture();
    let finish!: (result: any) => void;
    (f.session._toolRegistry.get("execute") as any).execute = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const owner = await acquireMainOwner({} as any, f.ctx);
    const running = owner.orchestration.execute({ name: "execute", args: { code: "slow" } });
    await Promise.resolve();
    await Promise.resolve();
    owner.close();
    let allowed = false;
    const waiting = beforeOrdinaryPrompt(f.manager).then(() => {
      allowed = true;
    });
    await Promise.resolve();
    expect(allowed).toBe(false);
    finish({ content: [{ type: "text", text: "done" }] });
    await running;
    await waiting;
    expect(f.messages.at(-1).role).toBe("toolResult");
    expect(allowed).toBe(true);
  });
  test("records host updates and only labels incomplete transcripts provisional", async () => {
    const f = fixture();
    const contexts: string[] = [];
    const owner = await acquireMainOwner({} as any, f.ctx, { onContext: (text) => contexts.push(text) });
    owner.inputTranscript("uncertain speech", false);
    owner.outputTranscript("interrupted words", false);
    owner.interrupt();
    owner.sendContext("job completed");
    owner.close();
    await owner.released;
    expect(contexts).toEqual(["job completed"]);
    expect(f.messages.filter((m) => m.role === "user" || m.role === "assistant")).toHaveLength(0);
    expect(f.messages.filter((m) => m.customType === "live-provisional")).toHaveLength(2);
    expect(f.messages.find((m) => m.customType === "task-complete")?.content[0].text).toBe("job completed");
  });
  test("stale branch invalidates callbacks", async () => {
    const f = fixture();
    const owner = await acquireMainOwner({} as any, f.ctx);
    f.manager.appendMessage({ role: "user", content: [] });
    expect(currentMainOwner(f.manager)).toBeUndefined();
    expect(() => owner.inputTranscript("stale")).not.toThrow();
    await expect(owner.orchestration.execute({ name: "execute", args: { code: "bad" } })).rejects.toThrow();
  });
});

test("acquisition reserves before hooks and cancellation cannot leave a late owner", async () => {
  const f = fixture();
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prepare = f.session._extensionRunner.emitBeforeAgentStart;
  f.session._extensionRunner.emitBeforeAgentStart = async () => {
    await paused;
    return prepare();
  };
  const controller = new AbortController();
  const first = acquireMainOwner({} as any, f.ctx, { signal: controller.signal });
  await expect(acquireMainOwner({} as any, f.ctx)).rejects.toThrow("already active");
  await expect(beforeOrdinaryPrompt(f.manager)).rejects.toThrow("Live owns");
  controller.abort();
  await expect(first).rejects.toThrow("cancelled");
  await beforeOrdinaryPrompt(f.manager);
  release();
  await Bun.sleep(0);
  expect(currentMainOwner(f.manager)).toBeUndefined();
});
test("detected speech gates execute until final transcription and hook preparation; stop releases the gate", async () => {
  const f = fixture();
  const owner = await acquireMainOwner({} as any, f.ctx);
  owner.beginInput?.();
  const result = owner.orchestration.execute({ id: "waiting", name: "execute", args: { code: "after-final" } });
  await Bun.sleep(0);
  expect(f.hooks).toEqual(["context"]);
  owner.inputTranscript("partial", false);
  await Bun.sleep(0);
  expect(f.hooks).toEqual(["context"]);
  owner.inputTranscript("final user intent", true);
  await result;
  expect(f.hooks).toContain("execute:after-final");
  owner.beginInput?.();
  const stopped = owner.orchestration.execute({ id: "stopped", name: "execute", args: { code: "never" } });
  owner.close();
  await owner.released;
  await expect(stopped).rejects.toThrow("without a final transcript");
  expect(f.hooks).not.toContain("execute:never");
});

test("before-agent-start setActiveTools denial is not undone by Live acquisition", async () => {
  const f = fixture();
  const original = f.session._extensionRunner.emitBeforeAgentStart;
  f.session._extensionRunner.emitBeforeAgentStart = async () => {
    const prepared = await original();
    f.session._baseSystemPromptOptions.selectedTools = [];
    f.session.getActiveToolNames = () => [];
    return prepared;
  };
  await expect(acquireMainOwner({} as any, f.ctx)).rejects.toThrow("disabled execute");
  expect(currentMainOwner(f.manager)).toBeUndefined();
});
