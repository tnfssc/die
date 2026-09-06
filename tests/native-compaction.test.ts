import { describe, expect, test } from "bun:test";
import { inspectDiagnostics } from "../src/diagnostics";
import type { Model } from "@earendil-works/pi-ai";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { SessionManager, buildSessionContext } from "@earendil-works/pi-coding-agent";
import {
  adaptNativeCompactionMessages,
  buildCodexCompactionHeaders,
  buildNativeCodexRequest,
  NATIVE_CODEX_SUMMARY,
  parseNativeCodexEvents,
  requestNativeCodexCompaction,
  registerNativeCodexCompaction,
  resolveCodexResponsesUrl,
  type NativeCodexCompactionDetails,
} from "../src/tasks/native-compaction";

const model: Model<any> = {
  id: "gpt-test",
  name: "test",
  api: "openai-codex-responses",
  provider: "openai-codex",
  baseUrl: "https://chatgpt.com/backend-api",
  reasoning: true,
  input: ["text"],
  cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 10000,
};
const payload = {
  model: "gpt-test",
  store: false,
  stream: true,
  instructions: "normal",
  input: [{ role: "user", content: [{ type: "input_text", text: "secret" }] }],
  tools: [{ type: "function", name: "execute" }],
  reasoning: { effort: "high" },
  prompt_cache_key: "session-key",
  tool_choice: "auto",
};

describe("native Codex request", () => {
  test("appends the documented trigger at explicitly standard tier without changing provider identity", () => {
    const request = buildNativeCodexRequest(payload)!;
    expect(request.input).toEqual([...payload.input, { type: "compaction_trigger" }]);
    expect(request.service_tier).toBe("default");
    expect({ ...request, input: payload.input, service_tier: undefined }).toEqual({
      ...payload,
      service_tier: undefined,
    });
    expect(payload.input).toHaveLength(1);
  });
  test("rejects unsupported and already compacted payloads", () => {
    expect(buildNativeCodexRequest({ ...payload, stream: false })).toBeUndefined();
    expect(buildNativeCodexRequest({ ...payload, input: [{ type: "compaction_trigger" }] })).toBeUndefined();
    expect(
      buildNativeCodexRequest({ ...payload, input: [{ type: "compaction", id: "cmp_old", encrypted_content: "old" }] }),
    ).toBeDefined();
  });
  test("uses the installed Codex backend path", () => {
    expect(resolveCodexResponsesUrl(model.baseUrl)).toBe("https://chatgpt.com/backend-api/codex/responses");
  });
  test("parses one opaque item and accounts cached, uncached, and output tokens", () => {
    const item = { type: "compaction" as const, id: "cmp_1", encrypted_content: "opaque" };
    const result = parseNativeCodexEvents(
      [
        { type: "response.output_item.done", item },
        {
          type: "response.completed",
          response: {
            status: "completed",
            output: [item],
            usage: {
              input_tokens: 100,
              input_tokens_details: { cached_tokens: 70, cache_write_tokens: 5 },
              output_tokens: 10,
              output_tokens_details: { reasoning_tokens: 8 },
              total_tokens: 110,
            },
          },
        },
      ],
      model,
    );
    expect(result.item).toEqual(item);
    expect(result.usage).toMatchObject({
      input: 25,
      cacheRead: 70,
      cacheWrite: 5,
      output: 10,
      reasoning: 8,
      totalTokens: 110,
    });
    expect(result.usage.cost.total).toBeGreaterThan(0);
  });
  test("rejects plaintext or mixed output instead of calling it native", () => {
    expect(() =>
      parseNativeCodexEvents(
        [{ type: "response.completed", response: { status: "completed", output: [{ type: "message" }], usage: {} } }],
        model,
      ),
    ).toThrow("invalid opaque");
    const item = { type: "compaction" as const, id: "cmp_1", encrypted_content: "opaque" };
    expect(() =>
      parseNativeCodexEvents(
        [
          {
            type: "response.completed",
            response: {
              status: "completed",
              output: [item, { type: "message" }],
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        ],
        model,
      ),
    ).toThrow("unsupported additional");
  });
  test("requires exact and consistent opaque items", () => {
    const base = { type: "compaction" as const, id: "cmp_exact", encrypted_content: "x" },
      usage = { input_tokens: 1, output_tokens: 0 };
    expect(() =>
      parseNativeCodexEvents(
        [{ type: "response.completed", response: { status: "completed", output: [{ ...base, extra: true }], usage } }],
        model,
      ),
    ).toThrow("invalid opaque");
    expect(() =>
      parseNativeCodexEvents(
        [
          { type: "response.output_item.done", item: base },
          {
            type: "response.completed",
            response: { status: "completed", output: [{ ...base, encrypted_content: "different" }], usage },
          },
        ],
        model,
      ),
    ).toThrow("invalid opaque");

    expect(() =>
      parseNativeCodexEvents(
        [{ type: "response.completed", response: { status: "completed", output: [base, { ...base }], usage } }],
        model,
      ),
    ).toThrow("invalid opaque");
  });
  test("rejects negative or internally inconsistent accounting", () => {
    const item = { type: "compaction" as const, id: "cmp_bad", encrypted_content: "x" };
    const event = (usage: any) => [
      { type: "response.completed", response: { status: "completed", output: [item], usage } },
    ];
    expect(() => parseNativeCodexEvents(event({ input_tokens: -1, output_tokens: 0 }), model)).toThrow(
      "invalid accounting",
    );
    expect(() =>
      parseNativeCodexEvents(
        event({ input_tokens: 2, input_tokens_details: { cached_tokens: 3 }, output_tokens: 0 }),
        model,
      ),
    ).toThrow("inconsistent accounting");
  });
  test("retains billable usage on failed terminals", () => {
    const item = { type: "compaction" as const, id: "cmp_failed", encrypted_content: "x" };
    try {
      parseNativeCodexEvents(
        [
          {
            type: "response.failed",
            response: {
              status: "failed",
              output: [item],
              usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
            },
          },
        ],
        model,
      );
      throw new Error("expected failure");
    } catch (error: any) {
      expect(error.usage).toMatchObject({ input: 4, output: 1, totalTokens: 5 });
    }
  });
  test("observes exact native dispatch, including fetch failure but not pre-dispatch abort", async () => {
    const seen: Model<any>[] = [];
    await expect(
      requestNativeCodexCompaction({
        model,
        payload,
        headers: { Authorization: "Bearer hidden", "chatgpt-account-id": "acct" },
        onDispatch: (m) => seen.push(m),
        fetch: (async () => {
          throw new Error("offline");
        }) as any,
      }),
    ).rejects.toThrow("offline");
    expect(seen).toEqual([model]);
    const controller = new AbortController();
    controller.abort(new Error("early"));
    await expect(
      requestNativeCodexCompaction({
        model,
        payload,
        headers: { Authorization: "Bearer hidden", "chatgpt-account-id": "acct" },
        signal: controller.signal,
        onDispatch: (m) => seen.push(m),
        fetch: (async () => {
          throw new Error("must not fetch");
        }) as any,
      }),
    ).rejects.toThrow("early");
    expect(seen).toHaveLength(1);
    await expect(
      requestNativeCodexCompaction({
        model,
        payload,
        headers: { Authorization: "Bearer hidden", "chatgpt-account-id": "acct" },
        onDispatch: (m) => seen.push(m),
        fetch: (() => {
          throw new Error("synchronous failure");
        }) as any,
      }),
    ).rejects.toThrow("synchronous failure");
    expect(seen).toHaveLength(1);
    const cyclic: any = { role: "user" };
    cyclic.self = cyclic;
    await expect(
      requestNativeCodexCompaction({
        model,
        payload: { ...payload, input: [cyclic] },
        headers: { Authorization: "Bearer hidden", "chatgpt-account-id": "acct" },
        onDispatch: (m) => seen.push(m),
        fetch: (async () => {
          throw new Error("must not fetch");
        }) as any,
      }),
    ).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });
  test("performs one cancellable request and never changes normal request fields", async () => {
    let seen: any;
    const item = { type: "compaction" as const, id: "cmp_9", encrypted_content: "cipher" };
    const fetch = async (url: any, init: any) => {
      seen = { url, init };
      return new Response(
        "data: " +
          JSON.stringify({
            type: "response.completed",
            response: {
              status: "completed",
              output: [item],
              usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
            },
          }) +
          "\n\n",
        { status: 200 },
      );
    };
    const out = await requestNativeCodexCompaction({
      model,
      payload,
      headers: { Authorization: "Bearer hidden", "chatgpt-account-id": "acct", "x-route": "kept" },
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(out.item).toEqual(item);
    const body = JSON.parse(seen.init.body);
    expect(body.input.at(-1)).toEqual({ type: "compaction_trigger" });
    expect(body.instructions).toBe("normal");
    expect(seen.init.headers.get("x-route")).toBe("kept");
    expect(seen.init.headers.get("chatgpt-account-id")).toBe("acct");
    expect(seen.init.headers.get("session-id")).toBe("session-key");
    expect(seen.init.headers.get("x-client-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(seen.init.headers.get("x-client-request-id")).not.toBe("session-key");
    expect(seen.init.headers.get("accept")).toBe("text/event-stream");
  });
});

describe("opaque checkpoint adapter", () => {
  test("survives JSON roundtrip and replays exact item only for the original model", () => {
    const manager = SessionManager.inMemory();
    const first = manager.appendMessage({ role: "user", content: [{ type: "text", text: "old" }], timestamp: 1 });
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "tail" }], timestamp: 2 });
    const item = { type: "compaction" as const, id: "cmp_resume", encrypted_content: "opaque-resume" };
    const details: NativeCodexCompactionDetails = {
      strategy: "codex-native",
      version: 1,
      api: "openai-codex-responses",
      provider: model.provider,
      model: model.id,
      thinkingLevel: null,
      item,
    };
    manager.appendCompaction(NATIVE_CODEX_SUMMARY, first, 20, JSON.parse(JSON.stringify(details)), true, {
      input: 3,
      output: 1,
      cacheRead: 2,
      cacheWrite: 0,
      totalTokens: 6,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });
    const messages = buildSessionContext(manager.getEntries()).messages;
    const ctx = { sessionManager: manager, model } as any;
    const adapted = adaptNativeCompactionMessages(messages, ctx);
    expect(adapted[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "thinking", thinkingSignature: JSON.stringify(item) }],
    });
    const wire = convertResponsesMessages(model, { messages: adapted as any }, new Set([model.provider]), {
      includeSystemPrompt: false,
    });
    expect(wire[0]).toEqual(item);
    const switched = adaptNativeCompactionMessages(messages, { ...ctx, model: { ...model, id: "other" } } as any);
    expect(switched[0].role).toBe("compactionSummary");
    expect((switched[0] as any).summary).toBe(NATIVE_CODEX_SUMMARY);
  });
});

describe("fail-closed checkpoint lifecycle", () => {
  function harness(manager: any, currentModel: any, append?: (type: string, data: any) => void) {
    const handlers = new Map<string, Function>();
    const entries: any[] = [];
    const capture = registerNativeCodexCompaction({
      on: (name: string, fn: Function) => handlers.set(name, fn),
      appendEntry: append ?? ((type: string, data: any) => entries.push({ type, data })),
    } as any);
    let aborted = 0;
    const notifications: string[] = [];
    const ctx: any = {
      model: currentModel,
      sessionManager: manager,
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: false, error: "offline" }) },
      abort: () => aborted++,
      ui: { notify: (message: string) => notifications.push(message) },
    };
    return {
      handlers,
      capture,
      ctx,
      entries,
      notifications,
      get aborted() {
        return aborted;
      },
    };
  }
  function checkpointManager() {
    const manager = SessionManager.inMemory();
    const first = manager.appendMessage({ role: "user", content: [{ type: "text", text: "old" }], timestamp: 1 });
    const details: NativeCodexCompactionDetails = {
      strategy: "codex-native",
      version: 1,
      api: "openai-codex-responses",
      provider: model.provider,
      model: model.id,
      thinkingLevel: null,
      item: { type: "compaction", id: "cmp_guard", encrypted_content: "opaque" },
    };
    manager.appendCompaction(NATIVE_CODEX_SUMMARY, first, 10, details, true);
    return manager;
  }
  test("explicit invalidation prevents a pre-shake native snapshot from being reused", () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage({ role: "user", content: "ordinary", timestamp: 1 });
    const h = harness(manager, model);
    h.handlers.get("context")!({ messages: manager.buildSessionContext().messages }, h.ctx);
    expect(h.capture.hasFreshCapture()).toBe(false);
    h.handlers.get("before_provider_headers")!({ headers: { Authorization: "Bearer x" } }, h.ctx);
    h.handlers.get("before_provider_request")!({ payload }, h.ctx);
    expect(h.capture.hasFreshCapture()).toBe(true);
    h.capture.invalidateCapture();
    expect(h.capture.hasFreshCapture()).toBe(false);
  });
  test("records individual native fallback reasons and releases the cache-affine hook", async () => {
    const run = async (
      setup: (h: ReturnType<typeof harness>, manager: ReturnType<typeof SessionManager.inMemory>) => void,
      mutateEvent: (value: any) => any = (value) => value,
    ) => {
      const manager = SessionManager.inMemory();
      manager.appendMessage({ role: "user", content: "ordinary", timestamp: 1 });
      const h = harness(manager, model);
      setup(h, manager);
      const branch = manager.getBranch();
      const value: any = {
        type: "session_before_compact",
        branchEntries: branch,
        reason: "manual",
        willRetry: false,
        signal: new AbortController().signal,
        preparation: {
          firstKeptEntryId: branch[0].id,
          messagesToSummarize: [],
          turnPrefixMessages: [],
          isSplitTurn: false,
          tokensBefore: 10,
          fileOps: { read: new Set(), written: new Set(), edited: new Set() },
          settings: { enabled: true, reserveTokens: 1, keepRecentTokens: 1 },
        },
      };
      expect(await h.handlers.get("session_before_compact")!(mutateEvent(value), h.ctx)).toBeUndefined();
      expect(h.capture.hasFreshCapture()).toBe(false);
      return { h, code: inspectDiagnostics(manager).records.at(-1)?.code };
    };
    expect((await run(() => {})).code).toBe("capture_missing");
    expect(
      (
        await run((h, manager) => {
          h.handlers.get("context")!({ messages: manager.buildSessionContext().messages }, h.ctx);
          h.capture.invalidateCapture();
        })
      ).code,
    ).toBe("state_invalid");
    expect(
      (
        await run((h, manager) => {
          h.handlers.get("context")!({ messages: manager.buildSessionContext().messages }, h.ctx);
          h.handlers.get("before_provider_headers")!({ headers: {} }, h.ctx);
          h.handlers.get("before_provider_request")!({ payload }, h.ctx);
          h.ctx.thinkingLevel = "high";
        })
      ).code,
    ).toBe("identity_stale");
    expect(
      (
        await run((h, manager) => {
          h.handlers.get("context")!({ messages: manager.buildSessionContext().messages }, h.ctx);
        })
      ).code,
    ).toBe("payload_missing");
    expect(
      (
        await run((h, manager) => {
          h.handlers.get("context")!({ messages: manager.buildSessionContext().messages }, h.ctx);
          h.handlers.get("before_provider_request")!({ payload }, h.ctx);
        })
      ).code,
    ).toBe("headers_missing");
    expect(
      (
        await run((h, manager) => {
          h.handlers.get("context")!({ messages: manager.buildSessionContext().messages }, h.ctx);
          h.handlers.get("before_provider_headers")!({ headers: {} }, h.ctx);
          h.handlers.get("before_provider_request")!({ payload: {} }, h.ctx);
        })
      ).code,
    ).toBe("payload_incompatible");
    expect(
      (
        await run(
          (h, manager) => {
            h.handlers.get("context")!({ messages: manager.buildSessionContext().messages }, h.ctx);
            h.handlers.get("before_provider_headers")!({ headers: {} }, h.ctx);
            h.handlers.get("before_provider_request")!({ payload }, h.ctx);
          },
          (value) => ({
            ...value,
            preparation: {
              ...value.preparation,
              messagesToSummarize: [{ role: "user", content: [{ type: "text", text: "not captured" }], timestamp: 1 }],
            },
          }),
        )
      ).code,
    ).toBe("coverage_incomplete");
  });
  test("aborts a switched-model request before a provider payload can proceed", () => {
    const h = harness(checkpointManager(), { ...model, provider: "foreign", api: "openai-responses" });
    const messages = buildSessionContext(h.ctx.sessionManager.getEntries()).messages;
    h.handlers.get("context")!({ messages }, h.ctx);
    expect(h.aborted).toBe(1);
    expect(() => h.handlers.get("before_provider_request")!({ payload: {} }, h.ctx)).toThrow("cannot be sent");
    expect(h.notifications[0]).toContain("Switch back");
  });
  test("cancels custom and missing-snapshot compaction rather than flattening a checkpoint", async () => {
    const manager = checkpointManager(),
      h = harness(manager, model);
    const branch = manager.getBranch();
    const base: any = {
      type: "session_before_compact",
      branchEntries: branch,
      reason: "manual",
      willRetry: false,
      signal: new AbortController().signal,
      preparation: {
        firstKeptEntryId: branch[0].id,
        messagesToSummarize: [],
        turnPrefixMessages: [],
        isSplitTurn: false,
        tokensBefore: 10,
        fileOps: { read: new Set(), written: new Set(), edited: new Set() },
        settings: { enabled: true, reserveTokens: 1, keepRecentTokens: 1 },
      },
    };
    expect(await h.handlers.get("session_before_compact")!({ ...base, customInstructions: "focus" }, h.ctx)).toEqual({
      cancel: true,
    });
    expect(await h.handlers.get("session_before_compact")!(base, h.ctx)).toEqual({ cancel: true });
  });
  test("usage append failure cannot replace a billable provider failure or permit fallback", async () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage({ role: "user", content: "ordinary", timestamp: 1 });
    let appends = 0;
    const h = harness(manager, model, () => {
      appends++;
      throw new Error("private append failure");
    });
    h.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({
      ok: true,
      headers: { Authorization: "Bearer hidden", "chatgpt-account-id": "acct" },
    });
    h.handlers.get("context")!({ messages: manager.buildSessionContext().messages }, h.ctx);
    h.handlers.get("before_provider_headers")!({ headers: {} }, h.ctx);
    h.handlers.get("before_provider_request")!({ payload }, h.ctx);
    const branch = manager.getBranch();
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        "data: " +
          JSON.stringify({
            type: "response.failed",
            response: {
              status: "failed",
              output: [],
              usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
            },
          }) +
          "\n\n",
        { status: 200 },
      )) as any;
    try {
      const result = await h.handlers.get("session_before_compact")!(
        {
          type: "session_before_compact",
          branchEntries: branch,
          signal: new AbortController().signal,
          preparation: {
            firstKeptEntryId: branch[0].id,
            messagesToSummarize: [],
            turnPrefixMessages: [],
            tokensBefore: 10,
            fileOps: { read: new Set(), written: new Set(), edited: new Set() },
            settings: { enabled: true, reserveTokens: 1, keepRecentTokens: 1 },
          },
        },
        h.ctx,
      );
      expect(result).toEqual({ cancel: true });
      expect(appends).toBe(1);
      expect(h.notifications.some((message) => message.includes("usage checkpoint could not be written"))).toBe(true);
      expect(JSON.stringify(h.notifications)).not.toContain("private append failure");
      expect(inspectDiagnostics(manager).records.map((record) => record.code)).toContain("state_write_failed");
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
  test("constructs provider-equivalent OAuth and cache headers", () => {
    const claim = Buffer.from(
        JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-jwt" } }),
      ).toString("base64url"),
      token = "x." + claim + ".y";
    const headers = buildCodexCompactionHeaders({ "x-route": "safe", Authorization: "stale" }, model, {
      apiKey: token,
      headers: { "x-auth-extra": "yes" },
    });
    expect(headers.get("authorization")).toBe("Bearer " + token);
    expect(headers.get("chatgpt-account-id")).toBe("acct-jwt");
    expect(headers.get("x-route")).toBe("safe");
    expect(headers.get("x-auth-extra")).toBe("yes");
  });
  test("permits thinking changes without changing opaque identity", () => {
    const manager = checkpointManager(),
      h = harness(manager, model);
    h.ctx.thinkingLevel = "high";
    const result = h.handlers.get("context")!({ messages: manager.buildSessionContext().messages }, h.ctx);
    expect(h.aborted).toBe(0);
    expect(result.messages[0].role).toBe("assistant");
  });
  test("rejects unknown checkpoint versions and missing serialized opaque items", () => {
    const manager = checkpointManager(),
      h = harness(manager, model);
    h.handlers.get("context")!({ messages: manager.buildSessionContext().messages }, h.ctx);
    expect(() => h.handlers.get("before_provider_request")!({ payload: { input: [] } }, h.ctx)).toThrow("lost during");
    expect(h.aborted).toBe(1);
    const entry = manager.getEntries().find((e) => e.type === "compaction") as any;
    entry.details.version = 99;
    h.handlers.get("context")!({ messages: manager.buildSessionContext().messages }, h.ctx);
    expect(h.aborted).toBe(2);
    expect(h.notifications.at(-1)).toContain("Unsupported or damaged");
  });
  test("notice edits preserve replay and deterministic job facts", () => {
    const manager = checkpointManager();
    const entry = manager.getEntries().find((e) => e.type === "compaction") as any;
    entry.summary = "A notice from an older prompt version.";
    entry.details.runtimeState = "Runtime-owned work at checkpoint: task_still_running; not a restart guarantee.";
    const adapted = adaptNativeCompactionMessages(manager.buildSessionContext().messages, {
      sessionManager: manager,
      model,
    } as any);
    expect(adapted[0].role).toBe("assistant");
    expect(adapted[1]).toMatchObject({ role: "user", content: entry.details.runtimeState });
  });
  test("blocks lossy branch summaries but permits navigation without summarizing", () => {
    const h = harness(checkpointManager(), model),
      handler = h.handlers.get("session_before_tree")!;
    expect(handler({ preparation: { userWantsSummary: true, entriesToSummarize: [] } }, h.ctx)).toEqual({
      cancel: true,
    });
    expect(handler({ preparation: { userWantsSummary: false, entriesToSummarize: [] } }, h.ctx)).toBeUndefined();
  });
});

describe("native transport boundaries", () => {
  const headers = { Authorization: "Bearer fixture", "chatgpt-account-id": "fixture" };
  const completed = (item: any) =>
    "data: " +
    JSON.stringify({
      type: "response.completed",
      response: { status: "completed", output: [item], usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 } },
    }) +
    "\n\n";
  test("parses fragmented SSE frames, including split UTF-8", async () => {
    const item = { type: "compaction" as const, id: "cmp_fragmented", encrypted_content: "opaque-🔐" };
    const bytes = new TextEncoder().encode(completed(item));
    const fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            for (let i = 0; i < bytes.length; i += 3) stream.enqueue(bytes.slice(i, i + 3));
            stream.close();
          },
        }),
      );
    await expect(requestNativeCodexCompaction({ model, payload, headers, fetch: fetch as any })).resolves.toMatchObject(
      { item },
    );
  });
  test("treats CRLF as one line ending with event headers", async () => {
    const item = { type: "compaction" as const, id: "cmp_crlf", encrypted_content: "opaque" };
    const body =
      "event: response.completed\r\ndata: " +
      JSON.stringify({
        type: "response.completed",
        response: {
          status: "completed",
          output: [item],
          usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
        },
      }) +
      "\r\n\r\n";
    const fetch = async () => new Response(body);
    await expect(requestNativeCodexCompaction({ model, payload, headers, fetch: fetch as any })).resolves.toMatchObject(
      { item },
    );
  });
  test("parses multiline data and every byte boundary, including CRLF and UTF-8", async () => {
    const item = { type: "compaction" as const, id: "cmp_every_byte", encrypted_content: "opaque-🔐" };
    const event = {
      type: "response.completed",
      response: { status: "completed", output: [item], usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 } },
    };
    const json = JSON.stringify(event),
      split = json.indexOf(',"response"') + 1;
    const body =
      "event: response.completed\r\ndata: " + json.slice(0, split) + "\r\ndata: " + json.slice(split) + "\r\n\r\n";
    const bytes = new TextEncoder().encode(body);
    const fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            for (let i = 0; i < bytes.length; i++) stream.enqueue(bytes.slice(i, i + 1));
            stream.close();
          },
        }),
      );
    await expect(requestNativeCodexCompaction({ model, payload, headers, fetch: fetch as any })).resolves.toMatchObject(
      { item },
    );
  });
  test("supports lone-CR SSE framing split at every byte", async () => {
    const item = { type: "compaction" as const, id: "cmp_cr", encrypted_content: "opaque" };
    const bytes = new TextEncoder().encode(
      "event: response.completed\rdata: " +
        JSON.stringify({
          type: "response.completed",
          response: {
            status: "completed",
            output: [item],
            usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
          },
        }) +
        "\r\r",
    );
    const fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            for (let i = 0; i < bytes.length; i++) stream.enqueue(bytes.slice(i, i + 1));
            stream.close();
          },
        }),
      );
    await expect(requestNativeCodexCompaction({ model, payload, headers, fetch: fetch as any })).resolves.toMatchObject(
      { item },
    );
  });
  test("returns and cancels the body immediately after a completed event", async () => {
    const item = { type: "compaction" as const, id: "cmp_terminal", encrypted_content: "opaque" };
    let cancelled = false;
    const fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(new TextEncoder().encode(completed(item)));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    const result = await requestNativeCodexCompaction({ model, payload, headers, fetch: fetch as any });
    expect(result.item).toEqual(item);
    expect(cancelled).toBe(true);
  });
  test("keeps a completed result when the connection resets afterward", async () => {
    const item = { type: "compaction" as const, id: "cmp_reset", encrypted_content: "opaque" };
    let pulls = 0;
    const fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(stream) {
            if (pulls++ === 0) stream.enqueue(new TextEncoder().encode(completed(item)));
            else stream.error(new Error("late reset"));
          },
        }),
      );
    await expect(requestNativeCodexCompaction({ model, payload, headers, fetch: fetch as any })).resolves.toMatchObject(
      { item, usage: { totalTokens: 5 } },
    );
  });
  test("retains usage on failed, incomplete, and cancelled terminals", async () => {
    for (const [type, status] of [
      ["response.failed", "failed"],
      ["response.incomplete", "incomplete"],
      ["response.cancelled", "cancelled"],
    ]) {
      const event = {
        type,
        response: { status, output: [], usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 } },
      };
      const fetch = async () => new Response("data: " + JSON.stringify(event) + "\n\n");
      try {
        await requestNativeCodexCompaction({ model, payload, headers, fetch: fetch as any });
        throw new Error("expected terminal failure");
      } catch (error: any) {
        expect(error).toBeInstanceOf(Error);
        expect(error.usage).toMatchObject({ input: 7, output: 2, totalTokens: 9 });
      }
    }
  });
  test("aborts and cleans up an in-flight response body", async () => {
    const controller = new AbortController();
    let requests = 0,
      cancelled = false;
    const fetch = async (_url: any, init: any) => {
      requests++;
      expect(init.signal).toBe(controller.signal);
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            setTimeout(() => controller.abort(new Error("native-cancel-test")), 0);
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    };
    await expect(
      requestNativeCodexCompaction({
        model,
        payload,
        headers,
        signal: controller.signal,
        fetch: fetch as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("native-cancel-test");
    expect(requests).toBe(1);
    expect(cancelled).toBe(true);
  });
  test("cancels oversized response reads", async () => {
    let cancelled = false;
    const fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    await expect(
      requestNativeCodexCompaction({ model, payload, headers, fetch: fetch as unknown as typeof globalThis.fetch }),
    ).rejects.toThrow("size limit");
    expect(cancelled).toBe(true);
  });
});

test("stream-only terminal accepts exactly one completed opaque item", () => {
  const item = { type: "compaction" as const, id: "cmp_stream", encrypted_content: "opaque-fixture" };
  const done = { type: "response.output_item.done", item };
  const terminal = {
    type: "response.completed",
    response: { status: "completed", output: [], usage: { input_tokens: 100, output_tokens: 10 } },
  };
  expect(parseNativeCodexEvents([done, terminal], model).item).toEqual(item);
  expect(() => parseNativeCodexEvents([terminal], model)).toThrow("invalid opaque item set");
  expect(() => parseNativeCodexEvents([done, done, terminal], model)).toThrow("invalid opaque item set");
  expect(() =>
    parseNativeCodexEvents([done, { ...terminal, response: { ...terminal.response, output: [item, item] } }], model),
  ).toThrow("invalid opaque item set");
});
