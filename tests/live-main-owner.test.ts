import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  ToolExecutionComponent,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, getModel } from "@earendil-works/pi-ai/compat";
import tasks from "../src/agent/extension";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { registerExecuteTool } from "../src/typescript/extension";
import { dieSystemPrompt } from "../src/prompts";
import { beforeAll, describe, expect, test } from "bun:test";
import { bindInstructionContinuitySession } from "../src/agent/instruction-continuity";
import { acquireMainOwner, beforeOrdinaryPrompt, currentMainOwner } from "../src/live/main-owner";

beforeAll(() => {
  const packageDir = process.env.PI_PACKAGE_DIR;
  delete process.env.PI_PACKAGE_DIR;
  try {
    initTheme("dark", false);
  } finally {
    if (packageDir !== undefined) process.env.PI_PACKAGE_DIR = packageDir;
  }
});

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
      expect(toolEvents[0].args).toEqual({});
      expect(toolEvents[1].isError).toBe(true);
      const run = owner.orchestration.execute({ name: "execute", args: { code: "console.log('live visible')" } });
      await Promise.resolve();
      expect(toolEvents[2].args).toEqual({ code: "console.log('live visible')" });
      let actualTool: any;
      registerExecuteTool(
        {
          on() {},
          registerTool(tool: unknown) {
            actualTool = tool;
          },
        } as any,
        undefined,
        undefined,
        () => 0,
      );
      const view = new ToolExecutionComponent(
        "execute",
        toolEvents[2].toolCallId,
        toolEvents[2].args,
        { showImages: false },
        actualTool,
        { requestRender() {} } as never,
        dir,
      );
      view.markExecutionStarted();
      expect(view.render(120).map(stripTerminalSequences).join("\n")).toContain("live visible");
      await run;
      view.updateResult({ ...toolEvents.at(-1).result, isError: toolEvents.at(-1).isError });
      view.setExpanded(true);
      expect(view.render(120).map(stripTerminalSequences).join("\n")).toContain("live visible");
      unsubscribe();
      await session.prompt("typed to active live owner");
      expect(JSON.stringify(session.sessionManager.buildSessionContext())).toContain("typed to active live owner");
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
    expect(f.events[0].args).toEqual({ code: "1+1" });
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
  test("terminal event preserves canonical long output, artifacts, images and job identity", async () => {
    const f = fixture();
    const payload = {
      content: [
        { type: "text", text: "x".repeat(10000) + "\njob_42\n/path/to/stdout.log" },
        { type: "image", data: "abc", mimeType: "image/png" },
      ],
      details: { backgroundJobs: ["job_42"], stdoutPath: "/path/to/stdout.log", images: ["image_1"] },
    };
    (f.session._toolRegistry.get("execute") as any).execute = async () => payload;
    const owner = await acquireMainOwner({} as any, f.ctx);
    const result = await owner.orchestration.execute({ name: "execute", args: { code: "await shell('long')" } });
    expect(f.events[0].args).toEqual({ code: "await shell('long')" });
    expect(f.events[1].result).toEqual(payload);
    expect((result as any).content).toEqual(payload.content);
    expect(f.messages.at(-1).content).toEqual(payload.content);
    owner.close();
    await owner.released;
  });
  test("production Live events render through pinned ToolExecutionComponent and execute renderers", async () => {
    let definition: any;
    registerExecuteTool(
      {
        on() {},
        registerTool(tool: unknown) {
          definition = tool;
        },
      } as any,
      undefined,
      undefined,
      () => 0,
    );
    const f = fixture();
    const output = {
      content: [
        { type: "text", text: "Result\n" + "large".repeat(2000) + "\njob_42\n/path/to/stdout.log" },
        { type: "image", data: "abc", mimeType: "image/png" },
      ],
      details: { exitCode: 0, backgroundJobs: ["job_42"], stdoutPath: "/path/to/stdout.log", images: ["image_1"] },
    };
    (f.session._toolRegistry.get("execute") as any).execute = async () => output;
    const owner = await acquireMainOwner({} as any, f.ctx);
    const run = owner.orchestration.execute({ name: "execute", args: { code: "await shell('long')" } });
    await Promise.resolve();
    const start = f.events[0];
    expect(start.type).toBe("tool_execution_start");
    const component = (args: any) =>
      new ToolExecutionComponent(
        "execute",
        start.toolCallId,
        args,
        { showImages: false },
        definition,
        { requestRender() {} } as never,
        "/tmp",
      );
    const visible = (tool: ToolExecutionComponent) => tool.render(120).map(stripTerminalSequences).join("\n");
    const live = component(start.args);
    live.markExecutionStarted();
    expect(visible(live)).toContain("await shell('long')");
    await run;
    const end = f.events.at(-1);
    live.updateResult({ ...end.result, isError: end.isError });
    expect(visible(live)).toContain("await shell('long')");
    expect(visible(live)).toContain("1 background");
    live.setExpanded(true);
    expect(visible(live)).toContain("job_42");
    expect(visible(live)).toContain("/path/to/stdout.log");
    expect(visible(live).match(/large/g)?.length).toBe(2000);
    expect(end.result.content[1].type).toBe("image");
    // A rebuilt component from the canonical pair must expose the same call/result.
    const history = component(f.messages.at(-2).content[0].arguments);
    history.markExecutionStarted();
    history.updateResult({ ...f.messages.at(-1), isError: false });
    history.setExpanded(true);
    expect(visible(history)).toBe(visible(live));
    const denied = fixture();
    denied.deny();
    const deniedOwner = await acquireMainOwner({} as any, denied.ctx);
    await deniedOwner.orchestration.execute({ name: "execute", args: { code: "blocked()" } });
    const error = component(denied.events[0].args);
    error.markExecutionStarted();
    error.updateResult({ ...denied.events[1].result, isError: true });
    expect(visible(error)).toContain("failed");
    error.setExpanded(true);
    expect(visible(error)).toContain("permission denied");
    deniedOwner.close();
    await deniedOwner.released;
    owner.close();
    await owner.released;
  });
  test("forwards intermediate updates through the ordinary Pi event shape", async () => {
    const f = fixture();
    (f.session._toolRegistry.get("execute") as any).execute = async (
      _id: string,
      _args: any,
      _signal: any,
      onUpdate: any,
    ) => {
      onUpdate({ content: [{ type: "text", text: "partial" }] });
      return { content: [{ type: "text", text: "done" }] };
    };
    const owner = await acquireMainOwner({} as any, f.ctx);
    await owner.orchestration.execute({ name: "execute", args: { code: "slow" } });
    expect(f.events.map((event) => event.type)).toEqual([
      "tool_execution_start",
      "tool_execution_update",
      "tool_execution_end",
    ]);
    expect(f.events[1].partialResult.content[0].text).toBe("partial");
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

test("GPT-Live delegation reuses one configured session turn, retries never rerun and voice stop does not cancel work", async () => {
  const f = fixture();
  const calls: string[] = [];
  let finish!: () => void;
  const running = new Promise<void>((resolve) => {
    finish = resolve;
  });
  (f.session as any).prompt = async (prompt: string) => {
    calls.push(prompt);
    await running;
  };
  (f.session as any).abort = () => {
    throw new Error("voice stop cancelled coding work");
  };
  const owner = await acquireMainOwner({} as any, f.ctx);
  owner.delegatedVoice = true;
  const first = owner.delegate!("delegation-1", "Implement the requested feature");
  const retry = owner.delegate!("delegation-1", "Implement the requested feature");
  expect(first).toBe(retry);
  await new Promise((resolve) => setTimeout(resolve, 0));
  owner.close();
  expect(calls).toEqual(["Implement the requested feature"]);
  finish();
  await first;
  await owner.released;
  expect(calls).toHaveLength(1);
});
