import { expect, test } from "bun:test";
import { zstdDecompressSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import * as codex from "@earendil-works/pi-ai/api/openai-codex-responses";
import * as openai from "@earendil-works/pi-ai/api/openai-responses";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { inspectDiagnostics } from "../src/diagnostics";
import {
  CODEX_FAST_MODELS,
  FAST_CHECKPOINT_PERSIST_FAILED,
  FAST_GUARD_TIER_MUTATION,
  FAST_REFUSED_AUTH,
  FAST_REFUSED_STALE,
  NATIVE_FAST_ENTRY,
  nativeFastSupport,
  registerNativeFastMode,
  withStandardProviderTier,
} from "../src/tasks/native-fast-mode";

function harness(
  model: any,
  options: {
    mode?: string;
    accept?: boolean;
    sessionId?: string;
    confirm?: () => Promise<boolean>;
    appendFails?: boolean;
  } = {},
) {
  const entries: any[] = [],
    notices: any[] = [],
    statuses: any[] = [];
  const hooks = new Map<string, any[]>();
  let command: any;
  const pi = {
    registerFlag() {},
    getFlag: () => options.accept ?? false,
    registerCommand(name: string, value: any) {
      if (name === "fast") command = value;
    },
    on(name: string, handler: any) {
      hooks.set(name, [...(hooks.get(name) ?? []), handler]);
    },
    appendEntry(customType: string, data: any) {
      if (options.appendFails) throw new Error("private persistence detail");
      entries.push({ type: "custom", customType, data });
    },
  } as any;
  const runtime = {
    isUsingOAuth: (provider: string) => provider === "openai-codex",
    async prepareRequest(requestModel: any, requestOptions: any) {
      return {
        provider: {
          id: requestModel.provider,
          streamSimple: requestModel.provider === "openai-codex" ? codex.streamSimple : openai.streamSimple,
        },
        model: requestModel,
        options: requestOptions,
      };
    },
    streamSimple(model: any, context: any, requestOptions: any) {
      const api = model.provider === "openai-codex" ? codex : openai;
      return api.streamSimple(model, context, requestOptions);
    },
  };
  const ctx = {
    mode: options.mode ?? "tui",
    model,
    modelRegistry: { runtime, isUsingOAuth: (value: any) => value.provider === "openai-codex" },
    sessionManager: {
      getSessionId: () => options.sessionId ?? "session-a",
      getBranch: () => entries,
      getEntries: () => entries,
    },
    ui: {
      confirm: options.confirm ?? (async () => true),
      notify: (message: string, kind: string) => notices.push({ message, kind }),
      setStatus: (key: string, value?: string) => statuses.push({ key, value }),
    },
  } as any;
  registerNativeFastMode(pi);
  const emit = async (name: string, event: any = {}) => {
    let value;
    for (const handler of hooks.get(name) ?? []) value = await handler(event, ctx);
    return value;
  };
  return { command, ctx, entries, notices, statuses, emit, runtime };
}

function sse(serviceTier: string) {
  const response = {
    status: "completed",
    service_tier: serviceTier,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }] }],
    usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5, input_tokens_details: { cached_tokens: 0 } },
  };
  return new Response(`data: ${JSON.stringify({ type: "response.completed", response })}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const CODEX_TOKEN = [
  Buffer.from("{}").toString("base64url"),
  Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })).toString("base64url"),
  "x",
].join(".");

async function wirePayload(
  h: ReturnType<typeof harness>,
  model = h.ctx.model,
  options: { onPayload?: (payload: any) => any; sessionId?: string } = {},
): Promise<any> {
  let body: any;
  await h.runtime
    .streamSimple(
      model,
      { systemPrompt: "sys", messages: [{ role: "user", content: "hi", timestamp: 1 }], tools: [] },
      {
        apiKey: model.provider === "openai-codex" ? CODEX_TOKEN : "offline-key",
        transport: "sse",
        sessionId: options.sessionId ?? h.ctx.sessionManager.getSessionId(),
        onPayload: options.onPayload,
        fetch: (async (_url: any, init: any) => {
          const bytes = Buffer.from(await new Response(init.body).arrayBuffer());
          body = JSON.parse(
            init.headers.get("content-encoding") === "zstd" ? zstdDecompressSync(bytes).toString() : bytes.toString(),
          );
          return sse(model.provider === "openai-codex" ? "priority" : "fast");
        }) as typeof fetch,
      },
    )
    .result();
  return body;
}

test("exact provider/model/auth allowlist rejects lookalikes before dispatch", () => {
  expect(nativeFastSupport(getModel("openai", "gpt-5.3-codex")!).supported).toBe(true);
  expect(nativeFastSupport(getModel("openai-codex", "gpt-5.6-luna")!).supported).toBe(true);
  expect(CODEX_FAST_MODELS.has("gpt-5.3-codex-spark")).toBe(false);
  expect(nativeFastSupport(getModel("openai-codex", "gpt-5.3-codex-spark")!).supported).toBe(false);
  expect(nativeFastSupport(getModel("openai-codex", "gpt-5.4-mini")!).supported).toBe(false);
  const custom = { ...getModel("openai", "gpt-5.3-codex")!, provider: "gateway" };
  expect(nativeFastSupport(custom).supported).toBe(false);
  const proxy = { ...getModel("openai", "gpt-5.3-codex")!, baseUrl: "https://proxy.example/v1" };
  expect(nativeFastSupport(proxy).supported).toBe(false);
});

test("fast mode rejects the wrong authentication surface", async () => {
  const codexModel = getModel("openai-codex", "gpt-5.5")!;
  const codex = harness(codexModel, { mode: "print", accept: true });
  codex.ctx.modelRegistry.isUsingOAuth = () => false;
  await codex.command.handler("on", codex.ctx);
  expect(codex.entries).toEqual([]);
  expect(codex.notices.at(-1).message).toContain("ChatGPT OAuth");

  const apiModel = getModel("openai", "gpt-5.3-codex")!;
  const api = harness(apiModel, { mode: "print", accept: true });
  api.ctx.modelRegistry.isUsingOAuth = () => true;
  await api.command.handler("on", api.ctx);
  expect(api.entries).toEqual([]);
  expect(api.notices.at(-1).message).toContain("API-key auth surface");
});

test("/fast is safe status; on requires consent and state is session/model/branch bound", async () => {
  const model = getModel("openai-codex", "gpt-5.6-luna")!;
  const h = harness(model, { mode: "print", accept: false });
  await h.command.handler("", h.ctx);
  expect(h.notices.at(-1).message).toContain("no model-bound setting");
  await h.command.handler("on", h.ctx);
  expect(h.entries).toEqual([]);
  expect(h.notices.at(-1).message).toContain("--accept-cost");

  const accepted = harness(model, { mode: "print", accept: true });
  await accepted.command.handler("on", accepted.ctx);
  expect(accepted.entries[0].data).toMatchObject({ enabled: true, costAcknowledged: true, model: model.id });
  expect((await wirePayload(accepted)).service_tier).toBe("priority");

  accepted.ctx.model = getModel("openai-codex", "gpt-5.5")!;
  expect((await wirePayload(accepted)).service_tier).toBeUndefined();
  accepted.ctx.model = model;
  accepted.ctx.sessionManager.getSessionId = () => "new-child-session";
  expect((await wirePayload(accepted)).service_tier).toBeUndefined();
});

test("enabling and restoring fast fail visibly without the pinned runtime seam", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const h = harness(model, { mode: "print", accept: true });
  h.ctx.modelRegistry.runtime = undefined;
  await h.command.handler("on", h.ctx);
  expect(h.entries).toEqual([]);
  expect(h.notices.at(-1)).toMatchObject({ kind: "error" });
  expect(h.notices.at(-1).message).toContain("pinned Pi 0.85");

  h.entries.push({
    type: "custom",
    customType: NATIVE_FAST_ENTRY,
    data: {
      version: 1,
      sessionId: "session-a",
      provider: model.provider,
      model: model.id,
      enabled: true,
      costAcknowledged: true,
      timestamp: 1,
    },
  });
  await h.emit("session_start");
  expect(h.notices.at(-1)).toMatchObject({ kind: "error" });
  expect(h.notices.at(-1).message).toContain("compatibility seam is missing");
});

test("consent is rejected if session, branch, or model changes while confirmation is open", async () => {
  const model = getModel("openai-codex", "gpt-5.6-luna")!;
  let release!: (accepted: boolean) => void;
  const h = harness(model, { confirm: () => new Promise((resolve) => (release = resolve)) });
  h.ctx.sessionManager.getLeafId = () => "leaf-a";
  const pending = h.command.handler("on", h.ctx);
  await Promise.resolve();
  h.ctx.model = getModel("openai-codex", "gpt-5.5")!;
  h.ctx.sessionManager.getSessionId = () => "session-b";
  h.ctx.sessionManager.getLeafId = () => "leaf-b";
  release(true);
  await pending;
  expect(h.entries).toEqual([]);
  expect(h.notices.at(-1).message).toContain("became stale");
});

test("compaction snapshot is request-local and explicit off affects only later requests", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const h = harness(model, { mode: "print", accept: true });
  await h.command.handler("on", h.ctx);
  expect((await withStandardProviderTier(h.ctx.sessionManager, () => wirePayload(h))).service_tier).toBe("default");
  expect((await wirePayload(h)).service_tier).toBe("fast");

  let release!: () => void;
  const scoped = withStandardProviderTier(h.ctx.sessionManager, async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return wirePayload(h);
  });
  expect((await wirePayload(h)).service_tier).toBe("fast");
  release();
  expect((await scoped).service_tier).toBe("default");

  await h.command.handler("off", h.ctx);
  expect((await wirePayload(h)).service_tier).toBe("default");
  const untouched = harness(model);
  expect(
    (
      await wirePayload(untouched, model, {
        onPayload: (payload) => ({ ...payload, service_tier: "project-custom" }),
      })
    ).service_tier,
  ).toBe("project-custom");
});

test("actual Pi streamSimple OpenAI serialization carries injected fast tier", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const h = harness(model, { mode: "print", accept: true });
  await h.command.handler("on", h.ctx);
  let body: any;
  const result = await h.runtime
    .streamSimple(
      model,
      { systemPrompt: "sys", messages: [{ role: "user", content: "hi", timestamp: 1 }], tools: [] },
      {
        apiKey: "offline-key",
        reasoning: "low",
        fetch: (async (_url: any, init: any) => {
          body = JSON.parse(init.body);
          return sse("fast");
        }) as typeof fetch,
        sessionId: "session-a",
      },
    )
    .result();
  expect(result.stopReason).toBe("stop");
  expect(body.service_tier).toBe("fast");
  expect(body.model).toBe("gpt-5.3-codex");
  expect(body.reasoning.effort).toBe("low");
});

test("actual Pi streamSimple Codex SSE serialization carries priority and preserves request settings", async () => {
  const model = getModel("openai-codex", "gpt-5.6-luna")!;
  const h = harness(model, { mode: "print", accept: true });
  await h.command.handler("on", h.ctx);
  let body: any;
  const token = [
    Buffer.from("{}").toString("base64url"),
    Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })).toString(
      "base64url",
    ),
    "x",
  ].join(".");
  await h.runtime
    .streamSimple(
      model,
      { systemPrompt: "keep-system", messages: [{ role: "user", content: "hi", timestamp: 1 }], tools: [] },
      {
        apiKey: token,
        transport: "sse",
        reasoning: "low",
        fetch: (async (_url: any, init: any) => {
          const bytes = Buffer.from(await new Response(init.body).arrayBuffer());
          body = JSON.parse(
            init.headers.get("content-encoding") === "zstd" ? zstdDecompressSync(bytes).toString() : bytes.toString(),
          );
          return sse("priority");
        }) as typeof fetch,
        sessionId: "session-a",
      },
    )
    .result();
  expect(body).toMatchObject({ service_tier: "priority", instructions: "keep-system", stream: true, store: false });
  expect(body.reasoning.effort).toBe("low");
});

test("actual Pi streamSimple Codex WebSocket frame carries priority", async () => {
  const model = getModel("openai-codex", "gpt-5.6-luna")!;
  const h = harness(model, { mode: "print", accept: true });
  await h.command.handler("on", h.ctx);
  const original = globalThis.WebSocket;
  let frame: any;
  class FixtureWebSocket extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    constructor(_url: string, _options?: unknown) {
      super();
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }
    send(value: string) {
      frame = JSON.parse(value);
      const response = {
        type: "response.completed",
        response: {
          status: "completed",
          service_tier: "priority",
          output: [],
          usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5, input_tokens_details: { cached_tokens: 0 } },
        },
      };
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(response) })));
    }
    close() {
      this.readyState = 3;
    }
  }
  try {
    globalThis.WebSocket = FixtureWebSocket as any;
    const token = [
      Buffer.from("{}").toString("base64url"),
      Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })).toString(
        "base64url",
      ),
      "x",
    ].join(".");
    const response = await h.runtime
      .streamSimple(
        model,
        { systemPrompt: "ws-system", messages: [{ role: "user", content: "hi", timestamp: 1 }], tools: [] },
        {
          apiKey: token,
          transport: "websocket",
          sessionId: "session-a",
        },
      )
      .result();
    expect(response.stopReason).toBe("stop");
    expect(frame).toMatchObject({ type: "response.create", service_tier: "priority", instructions: "ws-system" });
  } finally {
    globalThis.WebSocket = original;
  }
});

test("actual ModelRuntime request snapshot ignores model changes during delayed auth preparation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-fast-snapshot-"));
  const originalFetch = globalThis.fetch;
  try {
    const base = getModel("openai", "gpt-5.3-codex")!;
    const other = { ...base, id: "gpt-6-astra" };
    for (const authorizedModel of [other, base]) {
      const runtime = await ModelRuntime.create({
        authPath: join(dir, authorizedModel.id + ".json"),
        modelsPath: null,
        refreshOnCreate: false,
      });
      runtime.isUsingOAuth = () => false;
      let release!: () => void;
      runtime.getAuth = (async () => {
        await new Promise<void>((resolve) => (release = resolve));
        return { auth: { apiKey: "offline-key" } };
      }) as any;
      const entries: any[] = [
        {
          type: "custom",
          customType: NATIVE_FAST_ENTRY,
          data: {
            version: 1,
            sessionId: "session-a",
            provider: authorizedModel.provider,
            model: authorizedModel.id,
            enabled: true,
            costAcknowledged: true,
            timestamp: 1,
          },
        },
      ];
      const hooks = new Map<string, any[]>();
      const pi = {
        registerFlag() {},
        getFlag: () => false,
        registerCommand() {},
        on(name: string, handler: any) {
          hooks.set(name, [...(hooks.get(name) ?? []), handler]);
        },
        appendEntry() {},
      } as any;
      const ctx = {
        model: base,
        modelRegistry: { runtime, isUsingOAuth: () => false },
        sessionManager: {
          getSessionId: () => "session-a",
          getBranch: () => entries,
          getEntries: () => entries,
        },
        ui: { notify() {}, setStatus() {} },
      } as any;
      registerNativeFastMode(pi);
      for (const handler of hooks.get("session_start") ?? []) await handler({}, ctx);
      let body: any;
      globalThis.fetch = (async (_url: any, init: any) => {
        body = JSON.parse(init.body);
        return sse(authorizedModel === base ? "fast" : "default");
      }) as typeof fetch;
      const pending = runtime
        .streamSimple(
          base,
          { systemPrompt: "sys", messages: [{ role: "user", content: "hi", timestamp: 1 }], tools: [] },
          { sessionId: "session-a", onPayload: async (payload) => payload },
        )
        .result();
      while (!release) await Promise.resolve();
      ctx.model = other;
      release();
      await pending;
      expect(body.model).toBe(base.id);
      expect(body.service_tier).toBe(authorizedModel === base ? "fast" : undefined);
      for (const handler of hooks.get("session_shutdown") ?? []) await handler({}, ctx);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("real AgentSession ModelRuntime guard survives swallowed hook throws and stops late mutation before mock fetch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "die-fast-boundary-"));
  const originalFetch = globalThis.fetch;
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let dispatches = 0;
  try {
    const model = getModel("openai", "gpt-5.3-codex")!;
    const manager = SessionManager.inMemory(dir);
    manager.appendCustomEntry(NATIVE_FAST_ENTRY, {
      version: 1,
      sessionId: manager.getSessionId(),
      provider: model.provider,
      model: model.id,
      enabled: true,
      costAcknowledged: true,
      timestamp: 1,
    });
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      extensionFactories: [
        {
          name: "native-fast",
          factory: (pi) => {
            registerNativeFastMode(pi);
          },
        },
        {
          name: "late-tier-mutator",
          factory: (pi) =>
            pi.on("before_provider_request", (event) => {
              (event.payload as any).service_tier = "default";
              throw new Error("swallowed late hook failure");
            }),
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
    runtime.isUsingOAuth = () => false;
    runtime.getAuth = (async () => ({ auth: { apiKey: "offline-key" } })) as any;
    globalThis.fetch = (async () => {
      dispatches++;
      return sse("fast");
    }) as unknown as typeof fetch;
    session = (
      await createAgentSession({
        cwd: dir,
        agentDir: dir,
        resourceLoader: loader,
        modelRuntime: runtime,
        model,
        sessionManager: manager,
        tools: [],
      })
    ).session;
    await session.bindExtensions({ mode: "print" });
    await session.prompt("prove no dispatch");
    expect(dispatches).toBe(0);
    const last = session.messages.at(-1) as any;
    expect(last.stopReason).toBe("error");
    expect(last.errorMessage).toContain("late service-tier mutation");
    const diagnostic = inspectDiagnostics(manager).records.at(-1)!;
    expect(diagnostic).toMatchObject({ code: FAST_GUARD_TIER_MUTATION, outcome: "blocked", dispatch: "none" });
    expect(Object.keys(diagnostic).sort()).toEqual(["code", "component", "dispatch", "operationId", "outcome"]);
    expect(JSON.stringify(diagnostic)).not.toContain("swallowed late hook failure");
  } finally {
    session?.dispose();
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

for (const scenario of ["corrupt-record", "wrong-auth", "unsupported-model"] as const) {
  test(`real ModelRuntime blocks ${scenario} at zero fetch dispatches`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-fast-reject-"));
    const originalFetch = globalThis.fetch;
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    let dispatches = 0;
    try {
      const documented = getModel("openai", "gpt-5.3-codex")!;
      const model = scenario === "unsupported-model" ? { ...documented, id: "gpt-5.3-codex-lookalike" } : documented;
      const manager = SessionManager.inMemory(dir);
      manager.appendCustomEntry(NATIVE_FAST_ENTRY, {
        version: scenario === "corrupt-record" ? 99 : 1,
        sessionId: manager.getSessionId(),
        provider: model.provider,
        model: model.id,
        enabled: true,
        costAcknowledged: true,
        timestamp: 1,
      });
      const loader = new DefaultResourceLoader({
        cwd: dir,
        agentDir: dir,
        noExtensions: true,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        extensionFactories: [
          {
            name: "native-fast",
            factory: (pi) => {
              registerNativeFastMode(pi);
            },
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
      runtime.isUsingOAuth = () => scenario === "wrong-auth";
      runtime.getAuth = (async () => ({ auth: { apiKey: "offline-key" } })) as any;
      globalThis.fetch = (async () => {
        dispatches++;
        return sse("fast");
      }) as unknown as typeof fetch;
      session = (
        await createAgentSession({
          cwd: dir,
          agentDir: dir,
          resourceLoader: loader,
          modelRuntime: runtime,
          model,
          sessionManager: manager,
          tools: [],
        })
      ).session;
      await session.bindExtensions({ mode: "print" });
      await session.prompt("must fail closed");
      expect(dispatches).toBe(0);
      expect((session.messages.at(-1) as any).stopReason).toBe("error");
    } finally {
      session?.dispose();
      globalThis.fetch = originalFetch;
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("fast refusals and the concrete tier guard emit privacy-bounded static diagnostics", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const auth = harness(model, { mode: "print", accept: true });
  auth.ctx.modelRegistry.isUsingOAuth = () => true;
  await auth.command.handler("on", auth.ctx);
  expect(inspectDiagnostics(auth.ctx.sessionManager).records.at(-1)).toMatchObject({
    component: "fast",
    code: FAST_REFUSED_AUTH,
    outcome: "blocked",
    dispatch: "none",
  });

  const stale = harness(model, {
    confirm: async () => {
      stale.ctx.sessionManager.getSessionId = () => "changed-session";
      return true;
    },
  });
  await stale.command.handler("on", stale.ctx);
  expect(inspectDiagnostics(stale.ctx.sessionManager).records.at(-1)?.code).toBe(FAST_REFUSED_STALE);
});

test("fast checkpoint append failure is a controlled refusal with no setting", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const h = harness(model, { mode: "print", accept: true, appendFails: true });
  await h.command.handler("on", h.ctx);
  expect(h.entries).toEqual([]);
  expect(h.notices.at(-1)).toMatchObject({ kind: "error" });
  const records = inspectDiagnostics(h.ctx.sessionManager).records;
  expect(records.at(-1)).toMatchObject({ code: FAST_CHECKPOINT_PERSIST_FAILED, outcome: "failed" });
  expect(JSON.stringify(records)).not.toContain("private persistence detail");
});
