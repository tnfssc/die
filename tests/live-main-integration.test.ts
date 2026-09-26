/** Real offline Pi -> Live owner -> registered execute -> production task manager integration. */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import asynchronousTasksExtension from "../src/agent/extension";
import { installCurrentConversationAdapter } from "../src/agent/instruction-continuity";
import { acquireMainOwner, type MainOwner } from "../src/live/main-owner";
import { dieSystemPrompt } from "../src/prompts";
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { VoiceSession } from "../src/live/session";
import { registerLiveStop } from "../src/live/lifecycle-access";

// Release/Linux gates build dist/die first. The source-only macOS lane uses
// the existing real CLI wrapper, never a mock runtime or a skipped test.
const compiled = resolve(import.meta.dir, "../dist/die");
const executable =
  process.env.DIE_PROBE_EXECUTABLE ??
  (existsSync(compiled) ? compiled : resolve(import.meta.dir, "fixtures/live-execute-cli.sh"));
const cleanup: Array<() => Promise<void> | void> = [];
const depth = process.env.DIE_SUBAGENT_DEPTH,
  kind = process.env.DIE_SUBAGENT_TYPE;
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
  if (depth === undefined) delete process.env.DIE_SUBAGENT_DEPTH;
  else process.env.DIE_SUBAGENT_DEPTH = depth;
  if (kind === undefined) delete process.env.DIE_SUBAGENT_TYPE;
  else process.env.DIE_SUBAGENT_TYPE = kind;
});

async function fixture(options: { hooks?: boolean; customPrompt?: string; dynamicPrompt?: boolean } = {}) {
  process.env.DIE_SUBAGENT_DEPTH = "0";
  delete process.env.DIE_SUBAGENT_TYPE;
  installCurrentConversationAdapter();
  const dir = await mkdtemp(join(tmpdir(), "die-live-main-vertical-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const manager = SessionManager.create(dir, join(dir, "sessions"));
  let pi!: ExtensionAPI;
  let ctx!: ExtensionContext;
  const observed = { prompts: [] as string[], context: 0, calls: [] as string[], results: [] as string[] };
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: options.customPrompt ?? dieSystemPrompt(),
    appendSystemPromptOverride: () => ["VERTICAL_CUSTOM_APPEND"],
    agentsFilesOverride: () => ({
      agentsFiles: [{ path: join(dir, "AGENTS.md"), content: "VERTICAL_PROJECT_GUIDANCE" }],
    }),
    extensionFactories: [
      { name: "die-tasks", factory: (api) => asynchronousTasksExtension(api, { executablePath: executable }) },
      {
        name: "vertical-capture",
        factory: (api) => {
          pi = api;
          api.on("session_start", (_event, context) => {
            ctx = context;
          });
          api.on("before_agent_start", (event) => {
            observed.prompts.push(event.prompt);
            if (options.dynamicPrompt && event.prompt)
              return { systemPrompt: event.systemPrompt + "\nDYNAMIC:" + event.prompt };
          });
          api.on("context", (event) => {
            observed.context++;
            return { messages: event.messages };
          });
          api.on("tool_call", (event) => {
            observed.calls.push(event.toolCallId);
            if (options.hooks && event.toolCallId === "denied-call") return { block: true, reason: "VERTICAL_DENIED" };
          });
          api.on("tool_result", (event) => {
            observed.results.push(event.toolCallId);
            if (options.hooks) return { content: [...event.content, { type: "text", text: "VERTICAL_RESULT_HOOK" }] };
          });
        },
      },
    ],
  });
  await loader.reload();
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.hasConfiguredAuth = () => true; // only local preflight; any model stream is an error
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    resourceLoader: loader,
    modelRuntime,
    model: getModel("openai-codex", "gpt-5.6-luna"),
    sessionManager: manager,
    tools: ["execute"],
  });
  await session.bindExtensions({});
  let streamCalls = 0;
  session.agent.streamFunction = () => {
    streamCalls++;
    throw new Error("OFFLINE TEST MUST NOT STREAM TEXT MODEL");
  };
  cleanup.push(async () => {
    // SDK dispose does not emit extension shutdown; exercise the real cleanup hook.
    await (session as any)._extensionRunner.emit({ type: "session_shutdown" });
    session.dispose();
  });
  expect(ctx).toBeDefined();
  expect(pi).toBeDefined();
  const contexts: string[] = [];
  let contextSink: ((text: string, options?: { triggerResponse?: boolean }) => void) | undefined;
  const typed: string[] = [];
  const owner = await acquireMainOwner(pi, ctx, {
    onContext: (text, options) => {
      contexts.push(text);
      contextSink?.(text, options);
    },
    onInput: (text) => typed.push(text),
  });
  cleanup.push(async () => {
    owner.close();
    await owner.released;
  });
  return {
    dir,
    manager,
    session,
    pi,
    ctx,
    owner,
    contexts,
    typed,
    observed,
    setContextSink: (sink: typeof contextSink) => {
      contextSink = sink;
    },
    streamCalls: () => streamCalls,
  };
}

async function until(check: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("Timed out waiting for actual async completion");
    await Bun.sleep(25);
  }
}

test("main Live owns first-turn instructions, actual execute and background completion without spawning text model", async () => {
  const f = await fixture();
  const instructions = f.owner.orchestration.instructions ?? "";
  expect(instructions).toContain("VERTICAL_PROJECT_GUIDANCE");
  expect(instructions).toContain("VERTICAL_CUSTOM_APPEND");
  expect(instructions).toContain("You lead work.");
  expect(instructions).toContain("shell 3 seconds");
  expect(f.owner.orchestration.directMainAgent).toBe(true);
  expect(f.owner.orchestration.tools.map((t) => t.name)).toEqual(["execute"]);
  f.owner.inputTranscript("Launch isolated local marker job");
  const launch = await f.owner.orchestration.execute({
    name: "execute",
    id: "vertical-call",
    args: {
      code: 'console.log(await shell("sleep 0.3; printf VERTICAL_OFFLINE_MARKER", {waitSeconds:0}))',
      timeoutSeconds: 5,
    },
  });
  expect(JSON.stringify(launch)).toContain("background");
  expect(JSON.stringify(launch)).toContain("id");
  await until(() => f.contexts.some((text) => text.includes("VERTICAL_OFFLINE_MARKER")), 8000);
  expect(f.streamCalls()).toBe(0);
  f.owner.outputTranscript("The job completed.");
  const messages = f.manager
    .getBranch()
    .filter((entry: any) => entry.type === "message")
    .map((entry: any) => entry.message);
  expect(messages.map((m: any) => m.role)).toEqual(expect.arrayContaining(["user", "assistant", "toolResult"]));
  const callIndex = messages.findIndex(
    (m: any) =>
      m.role === "assistant" && m.content?.some((c: any) => c.type === "toolCall" && c.id === "vertical-call"),
  );
  expect(callIndex).toBeGreaterThanOrEqual(0);
  expect(messages[callIndex + 1]).toMatchObject({ role: "toolResult", toolCallId: "vertical-call" });
  expect(messages.at(-1)?.content).toEqual([{ type: "text", text: "The job completed." }]);
  expect(JSON.stringify(messages)).toContain("VERTICAL_OFFLINE_MARKER");
});

test("Live first turn applies production context and before/after tool hooks; typed route cannot steal owner", async () => {
  const f = await fixture({ hooks: true });
  expect(f.observed.context).toBeGreaterThan(0);
  await f.session.prompt("typed turn must not invoke another model");
  expect(f.typed).toEqual(["typed turn must not invoke another model"]);
  expect(f.streamCalls()).toBe(0);
  const denied = await f.owner.orchestration.execute({
    name: "execute",
    id: "denied-call",
    args: { code: 'console.log("SHOULD_NOT_RUN")' },
  });
  expect(JSON.stringify(denied)).toContain("VERTICAL_DENIED");
  expect(JSON.stringify(denied)).not.toContain("SHOULD_NOT_RUN");
  const allowed = await f.owner.orchestration.execute({
    name: "execute",
    id: "allowed-call",
    args: { code: 'console.log("VERTICAL_ALLOWED")' },
  });
  expect(JSON.stringify(allowed)).toContain("VERTICAL_ALLOWED");
  expect(JSON.stringify(allowed)).toContain("VERTICAL_RESULT_HOOK");
  expect(f.observed.calls).toEqual(["denied-call", "allowed-call"]);
  expect(f.observed.results).toEqual(["denied-call", "allowed-call"]);
  expect(f.streamCalls()).toBe(0);
});

test("Live close releases exclusive owner; interruption does not cancel an asynchronous job", async () => {
  const f = await fixture();
  await expect(acquireMainOwner(f.pi, f.ctx)).rejects.toThrow();
  const launch = await f.owner.orchestration.execute({
    name: "execute",
    id: "preserve-job",
    args: {
      code: 'console.log(await shell("sleep 0.3; printf INTERRUPTED_JOB_SURVIVED", {waitSeconds:0}))',
      timeoutSeconds: 5,
    },
  });
  expect(JSON.stringify(launch)).toContain("background");
  f.owner.interrupt();
  await until(() => f.contexts.some((text) => text.includes("INTERRUPTED_JOB_SURVIVED")), 8000);
  f.owner.close();
  await f.owner.released;
  await expect(
    f.owner.orchestration.execute({ name: "execute", id: "stale", args: { code: 'console.log("bad")' } }),
  ).rejects.toThrow();
  const replacement = await acquireMainOwner(f.pi, f.ctx);
  replacement.close();
  await replacement.released;
  expect(f.streamCalls()).toBe(0);
});

test("switching the on-disk session invalidates stale Live calls without a model request", async () => {
  const f = await fixture();
  f.manager.newSession();
  await expect(
    f.owner.orchestration.execute({ name: "execute", id: "obsolete", args: { code: 'console.log("SHOULD_NOT_RUN")' } }),
  ).rejects.toThrow();
  f.owner.close();
  await f.owner.released;
  expect(f.streamCalls()).toBe(0);
});

test("explicit jobs.stopWork cancels only isolated fixture work and does not run the text model", async () => {
  const f = await fixture();
  const launch = await f.owner.orchestration.execute({
    name: "execute",
    id: "cancel-job",
    args: {
      code: 'console.log(await shell("sleep 10; printf SHOULD_NOT_FINISH", {waitSeconds:0}))',
      timeoutSeconds: 5,
    },
  });
  expect(JSON.stringify(launch)).toContain("background");
  const stopped = await f.owner.orchestration.execute({
    name: "execute",
    id: "stop-work",
    args: {
      code: "console.log(await jobs.stopWork())",
      timeoutSeconds: 5,
    },
  });
  expect(JSON.stringify(stopped)).toContain("discoveryComplete");
  expect(JSON.stringify(stopped)).toContain("Execution cancelled");
  expect(f.streamCalls()).toBe(0);
});

test("main Live receives capability and delegation guidance in its assembled root and execute tool", async () => {
  const f = await fixture();
  const root = f.owner.orchestration.instructions;
  const execute = f.owner.orchestration.tools?.find((tool) => tool.name === "execute");
  expect(root).toContain("Network, filesystem, and worker access depend on the actual environment");
  expect(root).toContain("A past assistant denial is not evidence of a current limit");
  expect(root).toContain("When the user clearly asks to delegate, launch subagent");
  expect(root).toContain("Use tools for authorized work beyond coding too");
  expect(execute?.description).toContain("call the shell() or subagent() globals inside execute");
  expect(execute?.description).toContain("depends on the actual environment and result");
  f.owner.close();
  await f.owner.released;
});

test("custom root prompt is byte-identical to ordinary prompt assembly before first text model turn", async () => {
  const f = await fixture({ customPrompt: "VERTICAL_CUSTOM_ROOT_SYSTEM" });
  const livePrompt = f.owner.orchestration.instructions;
  expect(livePrompt).toContain("VERTICAL_CUSTOM_ROOT_SYSTEM");
  expect(livePrompt).toContain("VERTICAL_PROJECT_GUIDANCE");
  // User-owned custom root prompt retains the ordinary override semantics.
  expect(livePrompt).not.toContain("You lead work.");
  f.owner.close();
  await f.owner.released;
  let ordinaryPrompt: string | undefined;
  f.session.agent.streamFunction = (_model, context) => {
    ordinaryPrompt = getCurrentSystemPrompt(context.messages);
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "offline" }],
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
    } as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message });
    return stream;
  };
  await f.session.prompt("first ordinary text turn after Live");
  expect(ordinaryPrompt).toBe(livePrompt);
});

test("real live.stop helper returns after teardown without self-cancelling execute or background jobs", async () => {
  const f = await fixture();
  registerLiveStop(f.pi, async () => {
    f.owner.close();
    return { stopped: true, errors: [], jobsUnchanged: true };
  });
  const result = await f.owner.orchestration.execute({
    id: "stop-live",
    name: "execute",
    args: {
      code: 'console.log(await live.stop()); console.log("LIVE_STOP_CALLER_FINISHED")',
      timeoutSeconds: 5,
    },
  });
  expect(JSON.stringify(result)).toContain("LIVE_STOP_CALLER_FINISHED");
  expect(JSON.stringify(result)).toContain("stopped: true");
  await f.owner.released;
  const messages = f.manager
    .getBranch()
    .filter((e: any) => e.type === "message")
    .map((e: any) => e.message);
  expect(messages.at(-1)).toMatchObject({ role: "toolResult", toolCallId: "stop-live" });
  expect(f.streamCalls()).toBe(0);
});

test("overlapping executes keep canonical pairs contiguous while deferring every other owner record", async () => {
  const f = await fixture();
  const tool = (f.session as any)._toolRegistry.get("execute");
  const execute = tool.execute.bind(tool);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  tool.execute = async (id: string, ...args: any[]) => {
    if (id === "overlap-a") {
      entered();
      await gate;
    }
    return execute(id, ...args);
  };
  const a = { id: "overlap-a", name: "execute", args: { code: 'console.log("A")' } };
  const b = { id: "overlap-b", name: "execute", args: { code: 'console.log("B")' } };
  const first = f.owner.orchestration.execute(a);
  await started;
  const second = f.owner.orchestration.execute(b);
  f.owner.outputTranscript("assistant while tool runs");
  f.owner.inputTranscript("final user while tool runs");
  const typed = f.owner.typedInput("typed while tool runs");
  f.owner.sendContext("host completion while tool runs");
  expect(f.observed.calls).toEqual(["overlap-a"]);
  expect(
    f.manager
      .getBranch()
      .filter((e: any) => e.type === "message")
      .map((e: any) => e.message.role)
      .at(-1),
  ).toBe("assistant");
  resume();
  await Promise.all([first, second, typed]);
  expect(await f.owner.orchestration.execute(b)).toEqual(await second);
  const persisted = f.manager
    .getBranch()
    .filter((e: any) => e.type === "message")
    .map((e: any) => e.message);
  const fromCall = persisted.findIndex(
    (m: any) => m.role === "assistant" && m.content.some((c: any) => c.type === "toolCall" && c.id === "overlap-a"),
  );
  const inMemory = f.session.agent.state.messages
    .filter((m: any) => m.role !== "custom")
    .slice(-persisted.slice(fromCall).length);
  expect(inMemory).toEqual(persisted.slice(fromCall));
  const calls = persisted
    .map((m: any, i: number) =>
      m.role === "assistant" && m.content.some((part: any) => part.type === "toolCall") ? i : -1,
    )
    .filter((i: number) => i !== -1);
  expect(calls).toHaveLength(2);
  for (const i of calls)
    expect(persisted[i + 1]).toMatchObject({ role: "toolResult", toolCallId: persisted[i].content[0].id });
  const branch = f.manager.getBranch();
  for (const id of ["overlap-a", "overlap-b"]) {
    const i = branch.findIndex(
      (e: any) => e.type === "message" && e.message.role === "assistant" && e.message.content[0]?.id === id,
    );
    expect(branch[i + 1]).toMatchObject({ type: "message", message: { role: "toolResult", toolCallId: id } });
  }
  expect(persisted.some((m: any) => m.role === "user" && m.content[0].text === "final user while tool runs")).toBe(
    true,
  );
  expect(persisted.some((m: any) => m.role === "user" && m.content[0].text === "typed while tool runs")).toBe(true);
  expect(
    f.manager
      .getBranch()
      .some((e: any) => e.type === "custom_message" && e.content?.[0]?.text === "host completion while tool runs"),
  ).toBe(true);
});

test("unfinished ASR is revoked at turn boundary, interruption and close; a new final utterance admits tools", async () => {
  const f = await fixture();
  f.owner.beginInput?.();
  f.owner.inputTranscript("not final", false);
  const missing = f.owner.orchestration.execute({
    id: "no-final",
    name: "execute",
    args: { code: 'console.log("UNSAFE")' },
  });
  f.owner.turnComplete();
  await expect(missing).rejects.toThrow("without a final transcript");
  f.owner.beginInput?.();
  f.owner.inputTranscript("interrupted draft", false);
  const interrupted = f.owner.orchestration.execute({
    id: "interrupted",
    name: "execute",
    args: { code: 'console.log("UNSAFE")' },
  });
  f.owner.interrupt();
  await expect(interrupted).rejects.toThrow("without a final transcript");
  expect(f.observed.calls).toEqual([]);
  f.owner.inputTranscript("valid new input", true);
  const valid = await f.owner.orchestration.execute({
    id: "after-revocation",
    name: "execute",
    args: { code: 'console.log("SAFE")' },
  });
  expect(JSON.stringify(valid)).toContain("SAFE");
  f.owner.beginInput?.();
  const closing = f.owner.orchestration.execute({
    id: "closed-pending",
    name: "execute",
    args: { code: 'console.log("UNSAFE")' },
  });
  f.owner.close();
  await expect(closing).rejects.toThrow("without a final transcript");
  await f.owner.released;
  expect(f.observed.calls).toEqual(["after-revocation"]);
});

test("ordinary branch appends keep Live authority, duplicate tool calls do not replay side effects", async () => {
  const f = await fixture();
  f.manager.appendCustomEntry("voice-cost", { actual: "billing metadata" });
  const path = join(f.dir, "side-effect.txt");
  const call = {
    id: "deduplicated",
    name: "execute",
    args: {
      code:
        'await (await import("node:fs/promises")).appendFile(' +
        JSON.stringify(path) +
        ', "once"); console.log("DONE")',
    },
  };
  const first = await f.owner.orchestration.execute(call);
  const second = await f.owner.orchestration.execute(call);
  expect(second).toEqual(first);
  expect(await Bun.file(path).text()).toBe("once");
  await expect(f.owner.orchestration.execute({ ...call, args: { code: "different" } })).rejects.toThrow(
    "different arguments",
  );
  expect(f.streamCalls()).toBe(0);
});
test("prompt-dependent per-turn changes fail closed instead of dispatching with stale instructions", async () => {
  const f = await fixture({ dynamicPrompt: true });
  f.owner.inputTranscript("new user request", true);
  await expect(
    f.owner.orchestration.execute({
      id: "unsafe-old-policy",
      name: "execute",
      args: { code: 'console.log("MUST_NOT_RUN")' },
    }),
  ).rejects.toThrow("instructions changed");
  expect(f.observed.prompts).toContain("new user request");
  expect(f.observed.calls).toEqual([]);
  expect(f.streamCalls()).toBe(0);
  await f.owner.released;
});

test.each(["gemini-3.8-live", "gemini-3.8-live-extended-thinking"])(
  "%s direct function call executes real shell and receives async completion on its voice wire",
  async (model) => {
    const f = await fixture();
    let params: any;
    const wire: any[] = [];
    const voice = new VoiceSession(
      { onInputTranscript: (t) => f.owner.inputTranscript(t.text, t.finished) },
      () => ({
        live: {
          connect: async (p: any) => {
            params = p;
            return {
              sendRealtimeInput() {},
              sendClientContent(v: any) {
                wire.push({ context: v });
              },
              sendToolResponse(v: any) {
                wire.push({ tool: v });
              },
              close() {},
            } as any;
          },
        },
      }),
      f.owner.orchestration,
      model,
    );
    cleanup.push(() => voice.close());
    await voice.connect("offline-injected-adapter-no-network");
    f.setContextSink((text, options) => voice.sendContext(text, options));
    expect(params.model).toBe(model);
    expect(params.config.systemInstruction).toBe(f.owner.orchestration.instructions);
    expect(params.config.tools[0].functionDeclarations.map((tool: any) => tool.name)).toEqual(["execute"]);
    params.callbacks.onmessage({
      serverContent: { inputTranscription: { text: "run offline marker", finished: true } },
      toolCall: {
        functionCalls: [
          {
            id: "wire-shell",
            name: "execute",
            args: { code: 'console.log(await shell("sleep 0.2; printf VOICE_WIRE_COMPLETION", {waitSeconds:0}))' },
          },
        ],
      },
    });
    await until(() => wire.some((event) => event.tool?.functionResponses?.id === "wire-shell"), 8000);
    await until(
      () =>
        wire.some(
          (event) =>
            event.context?.turnComplete === true && JSON.stringify(event.context).includes("VOICE_WIRE_COMPLETION"),
        ),
      8000,
    );
    expect(f.streamCalls()).toBe(0);
    expect(JSON.stringify(f.manager.getBranch())).toContain('"toolCallId":"wire-shell"');
  },
);

test("stop voice then stop work in one real execute still cancels the draining voice foreground after its report", async () => {
  const f = await fixture();
  registerLiveStop(f.pi, async () => {
    f.owner.close();
    return { stopped: true, errors: [], jobsUnchanged: true };
  });
  const result = await f.owner.orchestration.execute({
    id: "both-stops",
    name: "execute",
    args: {
      code: 'console.log(await live.stop()); console.log(await jobs.stopWork()); await Bun.sleep(1000); console.log("SHOULD_NOT_REACH")',
      timeoutSeconds: 5,
    },
  });
  expect(JSON.stringify(result)).toContain("stopped: true");
  expect(JSON.stringify(result)).toContain("discoveryComplete");
  expect(JSON.stringify(result)).toContain("Execution cancelled");
  expect(JSON.stringify(result)).not.toContain("SHOULD_NOT_REACH");
  await f.owner.released;
});

test("paired GPT delta stream remains canonical passive history without TUI bubbles or model turns", async () => {
  const f = await fixture();
  f.owner.delegatedVoice = true;
  for (let n = 0; n < 24; n++)
    f.owner.sendContext(
      JSON.stringify({ source: "gpt_live_provisional", role: "user", delta: "delta" + n, uncertain: true }),
      { customType: "live-transcript" },
    );
  f.owner.sendContext(
    JSON.stringify({
      source: "gpt_live_provisional",
      role: "assistant",
      delta: "reply",
      uncertain: true,
      playbackVerified: false,
    }),
    { customType: "live-transcript" },
  );
  await until(
    () => f.manager.buildSessionContext().messages.filter((m: any) => m.customType === "live-transcript").length === 25,
  );
  const transcripts = f.manager.buildSessionContext().messages.filter((m: any) => m.customType === "live-transcript");
  expect(transcripts).toHaveLength(25);
  expect(transcripts.every((m: any) => m.role === "custom" && m.display === false)).toBe(true);
  expect((transcripts.at(-1) as any)?.content).toEqual([
    {
      type: "text",
      text: JSON.stringify({
        source: "gpt_live_provisional",
        role: "assistant",
        delta: "reply",
        uncertain: true,
        playbackVerified: false,
      }),
    },
  ]);
  expect(f.session.agent.state.messages.filter((m: any) => m.customType === "live-transcript")).toHaveLength(25);
  expect(f.streamCalls()).toBe(0); // passive fragments never wake the coding agent
}, 12000);

test("paired backend survives production input routing: voice and typed turns each run once", async () => {
  const f = await fixture();
  f.owner.delegatedVoice = true;
  let calls = 0;
  f.session.agent.streamFunction = ((model: any) => {
    calls++;
    const stream = createAssistantMessageEventStream();
    const message: any = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
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
      content: [{ type: "text", text: "CANONICAL_PAIRED_RESULT_" + calls }],
    };
    stream.push({ type: "done", reason: "stop", message });
    return stream;
  }) as any;
  await f.owner.delegate!("spoken-1", "Provisional spoken request with provenance");
  await f.session.prompt("Typed request through production input handler");
  expect(calls).toBe(2);
  expect(f.contexts.join("\n")).toContain("CANONICAL_PAIRED_RESULT_2");
  const history = JSON.stringify(f.manager.buildSessionContext());
  expect(history).toContain("Provisional spoken request with provenance");
  expect(history).toContain("Typed request through production input handler");
}, 5000);

test("paired backend resumes from production async task notification without inventing a user turn", async () => {
  const f = await fixture();
  f.owner.delegatedVoice = true;
  const originalBeforeTool = f.session.agent.beforeToolCall!;
  f.session.agent.beforeToolCall = (async (...args: any[]) => {
    const result = await (originalBeforeTool as any)(...args);
    f.owner.sendContext("Provisional overlapping voice transcript", { customType: "live-transcript" });
    return result;
  }) as any;
  let calls = 0;
  f.session.agent.streamFunction = ((model: any, context: any) => {
    const step = ++calls;
    const stream = createAssistantMessageEventStream();
    if (step >= 3) expect(JSON.stringify(context.messages)).toContain("PAIRED_ASYNC_REAL_MARKER");
    const message: any = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      timestamp: Date.now(),
      stopReason: step === 1 ? "toolUse" : "stop",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      content:
        step === 1
          ? [
              {
                type: "toolCall",
                id: "paired-async-launch",
                name: "execute",
                arguments: {
                  code: 'console.log(await shell("sleep 0.2; printf PAIRED_ASYNC_REAL_MARKER", {waitSeconds:0}))',
                },
              },
            ]
          : [{ type: "text", text: step === 2 ? "Background work queued." : "PAIRED_ASYNC_VERIFIED_COMPLETION" }],
    };
    stream.push({ type: "done", reason: step === 1 ? "toolUse" : "stop", message });
    return stream;
  }) as any;
  await f.owner.delegate!("spoken-async", "Launch the requested background marker job");
  await until(() => f.contexts.some((text) => text.includes("PAIRED_ASYNC_VERIFIED_COMPLETION")), 8000);
  expect(calls).toBe(3);
  const messages = f.manager.buildSessionContext().messages;
  expect(messages.filter((m) => m.role === "user")).toHaveLength(1);
  const toolIndex = messages.findIndex(
    (m) => m.role === "assistant" && JSON.stringify(m).includes("paired-async-launch"),
  );
  expect(messages[toolIndex + 1]?.role).toBe("toolResult");
  expect(messages.some((m: any) => m.role === "custom" && m.customType === "live-transcript")).toBe(true);
  expect(messages.some((m: any) => m.role === "custom" && m.customType === "task-complete")).toBe(true);
}, 12000);

test("paired execute can stop voice then work through the production scoped helpers", async () => {
  const f = await fixture();
  f.owner.delegatedVoice = true;
  registerLiveStop(f.pi, async () => {
    f.owner.close();
    return { stopped: true, errors: [], jobsUnchanged: true };
  });
  let calls = 0;
  let observedAbort = false;
  f.session.agent.streamFunction = ((model: any, _context: any, options: any) => {
    if (!options?.signal?.aborted) calls++;
    const stream = createAssistantMessageEventStream();
    const message: any = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      timestamp: Date.now(),
      stopReason: "toolUse",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      content: [
        {
          type: "toolCall",
          id: "paired-stop-both",
          name: "execute",
          arguments: {
            code: 'console.log(await live.stop()); console.log(await jobs.stopWork()); await Bun.sleep(1000); console.log("PAIRED_SHOULD_NOT_REACH")',
            timeoutSeconds: 5,
          },
        },
      ],
    };
    if (options?.signal?.aborted) {
      observedAbort = true;
      message.content = [];
      message.stopReason = "aborted";
      stream.push({ type: "error", reason: "aborted", error: message });
      return stream;
    }
    if (calls > 1) {
      message.content = [{ type: "text", text: "Unexpected extra model turn" }];
      message.stopReason = "stop";
    }
    stream.push({ type: "done", reason: calls > 1 ? "stop" : "toolUse", message });
    return stream;
  }) as any;
  await f.owner.delegate!("explicit-both-stop", "Explicit user request: stop voice then current-session work");
  await f.owner.released;
  const results = f.manager.buildSessionContext().messages.filter((m) => m.role === "toolResult");
  expect(observedAbort).toBe(true);
  expect(calls).toBe(1);
  expect(JSON.stringify(results)).not.toContain("PAIRED_SHOULD_NOT_REACH");
  expect(JSON.stringify(results)).toContain("cancel");
}, 10000);
