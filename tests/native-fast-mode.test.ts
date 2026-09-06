import { expect, test } from "bun:test";
import { zstdDecompressSync } from "node:zlib";
import { getModel } from "@earendil-works/pi-ai/compat";
import * as codex from "@earendil-works/pi-ai/api/openai-codex-responses";
import * as openai from "@earendil-works/pi-ai/api/openai-responses";
import {
  CODEX_FAST_MODELS,
  NATIVE_FAST_ENTRY,
  nativeFastSupport,
  registerNativeFastMode,
  withStandardProviderTier,
} from "../src/tasks/native-fast-mode";

function harness(model: any, options: { mode?: string; accept?: boolean; sessionId?: string } = {}) {
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
      entries.push({ type: "custom", customType, data });
    },
  } as any;
  const ctx = {
    mode: options.mode ?? "tui",
    model,
    modelRegistry: { isUsingOAuth: (value: any) => value.provider === "openai-codex" },
    sessionManager: {
      getSessionId: () => options.sessionId ?? "session-a",
      getBranch: () => entries,
      getEntries: () => entries,
    },
    ui: {
      confirm: async () => true,
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
  return { command, ctx, entries, notices, statuses, emit };
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
  expect(h.entries).toEqual([]);
  expect(h.notices.at(-1).message).toContain("no model-bound setting");
  await h.command.handler("on", h.ctx);
  expect(h.entries).toEqual([]);
  expect(h.notices.at(-1).message).toContain("--accept-cost");

  const accepted = harness(model, { mode: "print", accept: true });
  await accepted.command.handler("on", accepted.ctx);
  expect(accepted.entries[0].customType).toBe(NATIVE_FAST_ENTRY);
  expect(accepted.entries[0].data).toMatchObject({ enabled: true, costAcknowledged: true, model: "gpt-5.6-luna" });
  const payload: any = { model: model.id, input: [] };
  await accepted.emit("before_provider_request", { payload });
  expect(payload.service_tier).toBe("priority");

  accepted.ctx.model = getModel("openai-codex", "gpt-5.5")!;
  const changed: any = {};
  await accepted.emit("before_provider_request", { payload: changed });
  expect(changed.service_tier).toBeUndefined();
  accepted.ctx.model = model;
  accepted.ctx.sessionManager.getSessionId = () => "new-child-session";
  const child: any = {};
  await accepted.emit("before_provider_request", { payload: child });
  expect(child.service_tier).toBeUndefined();
});

test("restored records require an explicit cost acknowledgement", async () => {
  const model = getModel("openai-codex", "gpt-5.5")!;
  const h = harness(model);
  h.entries.push({
    type: "custom",
    customType: NATIVE_FAST_ENTRY,
    data: {
      version: 1,
      sessionId: "session-a",
      provider: model.provider,
      model: model.id,
      enabled: true,
      costAcknowledged: false,
      timestamp: 1,
    },
  });
  expect(h.emit("before_provider_request", { payload: {} })).rejects.toThrow("authorization is missing");
});

test("compaction forces default before capture and releases its session scope", async () => {
  const model = getModel("openai-codex", "gpt-5.5")!;
  const h = harness(model, { mode: "print", accept: true });
  await h.command.handler("on", h.ctx);
  const compacted: any = {};
  await withStandardProviderTier(h.ctx.sessionManager, () => h.emit("before_provider_request", { payload: compacted }));
  expect(compacted.service_tier).toBe("default");
  const ordinary: any = {};
  await h.emit("before_provider_request", { payload: ordinary });
  expect(ordinary.service_tier).toBe("priority");
});

test("explicit off emits default without changing untouched provider defaults", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const untouched = harness(model);
  const first: any = { service_tier: "project-custom" };
  await untouched.emit("before_provider_request", { payload: first });
  expect(first.service_tier).toBe("project-custom");
  await untouched.command.handler("off", untouched.ctx);
  const optedOut: any = { service_tier: "project-custom" };
  await untouched.emit("before_provider_request", { payload: optedOut });
  expect(optedOut.service_tier).toBe("default");
});

test("actual Pi streamSimple OpenAI serialization carries injected fast tier", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const h = harness(model, { mode: "print", accept: true });
  await h.command.handler("on", h.ctx);
  let body: any;
  const result = await openai
    .streamSimple(
      model,
      { systemPrompt: "sys", messages: [{ role: "user", content: "hi", timestamp: 1 }], tools: [] },
      {
        apiKey: "offline-key",
        reasoning: "low",
        fetch: (async (_url: any, init: any) => {
          body = JSON.parse(init.body);
          return sse("priority");
        }) as typeof fetch,
        onPayload: async (payload) => h.emit("before_provider_request", { payload }),
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
  await codex
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
        onPayload: async (payload) => h.emit("before_provider_request", { payload }),
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
    const response = await codex
      .streamSimple(
        model,
        { systemPrompt: "ws-system", messages: [{ role: "user", content: "hi", timestamp: 1 }], tools: [] },
        {
          apiKey: token,
          transport: "websocket",
          onPayload: async (payload) => h.emit("before_provider_request", { payload }),
        },
      )
      .result();
    expect(response.stopReason).toBe("stop");
    expect(frame).toMatchObject({ type: "response.create", service_tier: "priority", instructions: "ws-system" });
  } finally {
    globalThis.WebSocket = original;
  }
});
