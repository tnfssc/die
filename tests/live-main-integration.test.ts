/** Real offline Pi -> Live owner -> registered execute -> production task manager integration. */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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

const executable = process.env.DIE_PROBE_EXECUTABLE ?? resolve(import.meta.dir, "../dist/die");
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

test("Gemini adapter direct function call executes real shell and receives async completion on its voice wire", async () => {
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
  );
  cleanup.push(() => voice.close());
  await voice.connect("offline-injected-adapter-no-network");
  f.setContextSink((text, options) => voice.sendContext(text, options));
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
});

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
