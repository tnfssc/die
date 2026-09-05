import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  bindCurrentCompactionSession,
  buildCacheAffineRequest,
  clearInstructionContinuity,
  isCacheAffineProviderPayload,
  isUsableSummaryResponse,
  mapPreparedSummaryBoundary,
  registerCacheAffineCompaction,
  scopeInstructionContinuity,
  setCurrentInstructionFrame,
} from "../src/tasks/cache-affine-compaction";

function wireProvider(ctx: any, pi: any) {
  if (!ctx.modelRegistry) return;
  bindCurrentCompactionSession({
    sessionManager: ctx.sessionManager,
    agent: {
      state: { systemPrompt: ctx.getSystemPrompt(), tools: pi.getAllTools() },
      convertToLlm,
      streamFunction: (m: any, c: any, o: any) => ({ result: () => ctx.modelRegistry.completeSimple(m, c, o) }),
    },
  } as any);
  ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: "offline" });
  ctx.modelRegistry.getProvider = () => ({
    streamSimple: (m: any, c: any, o: any) => ({ result: () => ctx.modelRegistry.completeSimple(m, c, o) }),
  });
}

const usage = {
  input: 10,
  output: 2,
  cacheRead: 8,
  cacheWrite: 0,
  totalTokens: 20,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const model = {
  id: "m",
  name: "M",
  provider: "p",
  api: "openai-responses",
  reasoning: true,
  input: ["text"],
  cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
  contextWindow: 100_000,
  maxTokens: 8_192,
} as any;
const user = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 }) as any;
const assistant = (text: string) =>
  ({
    role: "assistant",
    api: "openai-responses",
    provider: "p",
    model: "m",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage,
    timestamp: 2,
  }) as any;
const entries = [
  { type: "message", id: "1", parentId: null, timestamp: "2026-01-01", message: user("old-user") },
  { type: "message", id: "2", parentId: "1", timestamp: "2026-01-01", message: assistant("old-assistant") },
  { type: "message", id: "3", parentId: "2", timestamp: "2026-01-01", message: user("tail-user") },
  { type: "message", id: "4", parentId: "3", timestamp: "2026-01-01", message: assistant("tail-assistant") },
] as any[];

function event(overrides: any = {}) {
  return {
    type: "session_before_compact",
    branchEntries: entries,
    reason: "threshold",
    willRetry: false,
    signal: new AbortController().signal,
    preparation: {
      firstKeptEntryId: "3",
      messagesToSummarize: [entries[0].message, entries[1].message],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 1_000,
      previousSummary: undefined,
      fileOps: { read: new Set(["read.ts"]), written: new Set(["write.ts"]), edited: new Set() },
      settings: { enabled: true, reserveTokens: 8_192, keepRecentTokens: 2_000 },
    },
    ...overrides,
  } as any;
}

function snapshot(overrides: any = {}) {
  return {
    messages: [user("HOOKED-old-user"), assistant("old-assistant"), user("tail-user"), assistant("tail-assistant")],
    leafId: "4",
    systemPrompt: "actual post-hook system",
    tools: [{ name: "execute", description: "run", parameters: { type: "object" } }],
    model,
    thinkingLevel: "high",
    sessionId: "stable-session",
    ...overrides,
  };
}

describe("cache-affine compaction request", () => {
  test("preserves the exact fully transformed context, system, and tools", () => {
    const request = buildCacheAffineRequest(snapshot(), event())!;
    expect(request.systemPrompt).toBe("actual post-hook system");
    expect(request.tools).toEqual(snapshot().tools);
    expect((request.messages[0] as any).content[0].text).toBe("HOOKED-old-user");
    expect((request.messages[2] as any).content[0].text).toBe("tail-user");
    expect((request.messages[3] as any).content[0].text).toBe("tail-assistant");
    expect((request.messages.at(-1) as any).content[0].text).toContain("messages 1 through 2");
  });

  test("keeps summary and retained tail disjoint for split turns", () => {
    const split = event({
      preparation: {
        ...event().preparation,
        messagesToSummarize: [],
        turnPrefixMessages: [entries[0].message, entries[1].message],
        isSplitTurn: true,
      },
    });
    const request = buildCacheAffineRequest(snapshot(), split)!;
    expect(request.summaryEnd).toBe(2);
    expect(request.tailStart).toBe(3);
  });

  test("rejects a stale snapshot leaf and any untransformed raw tail", () => {
    expect(buildCacheAffineRequest(snapshot({ leafId: "missing" }), event())).toBeUndefined();
    expect(
      buildCacheAffineRequest(snapshot({ leafId: "2", messages: snapshot().messages.slice(0, 2) }), event()),
    ).toBeUndefined();
  });

  test("allows a text-only assistant response after an otherwise unmodified cached prefix", () => {
    const assistantTailEntries = [entries[0], entries[1], { ...entries[3], id: "3", parentId: "2" }];
    const assistantTailEvent = event({
      branchEntries: assistantTailEntries,
      preparation: { ...event().preparation, firstKeptEntryId: "3" },
    });
    const request = buildCacheAffineRequest(
      snapshot({ messages: [user("old-user"), assistant("old-assistant")], leafId: "2" }),
      assistantTailEvent,
    )!;
    expect((request.messages[2] as any).content[0].text).toBe("tail-assistant");
  });

  test("rejects context transforms that change message boundaries", () => {
    expect(buildCacheAffineRequest(snapshot({ messages: snapshot().messages.slice(1) }), event())).toBeUndefined();
  });

  test("uses whole-current scope when transformed retained messages cannot be mapped", () => {
    const raw = [user("discarded"), user("retained-a"), assistant("retained-b")] as any;
    const unchanged = mapPreparedSummaryBoundary(raw, raw, 1);
    expect(unchanged).toEqual({ summaryEnd: 1, tailStart: 2, summaryScope: "prefix" });
    for (const transformed of [
      [raw[0], user("redacted-a"), raw[2]],
      [raw[0], raw[2]],
      [raw[0], raw[2], raw[1]],
      [raw[0], raw[1], user("inserted"), raw[2]],
    ])
      expect(mapPreparedSummaryBoundary(transformed as any, raw, 1).summaryScope).toBe("whole-current-conversation");
  });

  test("does not duplicate retained content into a raw boundary anchor", () => {
    const request = buildCacheAffineRequest(snapshot(), event())!;
    const serialized = JSON.stringify(request.messages);
    expect(serialized.split("tail-user")).toHaveLength(2);
    expect(serialized).not.toContain("retained-tail anchor");
  });

  test("charges transformed-prefix growth against the context window", () => {
    const expanded = snapshot({
      messages: [user("x".repeat(40_000)), assistant("old-assistant"), user("tail-user"), assistant("tail-assistant")],
      model: { ...model, contextWindow: 12_000 },
    });
    expect(buildCacheAffineRequest(expanded, event())).toBeUndefined();
  });

  test("falls back rather than sending an overflowing fork", () => {
    const overflow = event({ reason: "overflow", preparation: { ...event().preparation, tokensBefore: 99_000 } });
    expect(buildCacheAffineRequest(snapshot(), overflow)).toBeUndefined();
  });
});

describe("provider serialization guard", () => {
  test("requires the entire old native wire sequence and cache-affecting fields", () => {
    const old = {
      instructions: "s",
      input: [{ type: "message", id: "1" }],
      tools: [{ name: "execute" }],
      reasoning: { effort: "high" },
      prompt_cache_key: "sid",
    };
    expect(isCacheAffineProviderPayload(old, { ...old, input: [...old.input, { type: "message", id: "2" }] })).toBe(
      true,
    );
    expect(
      isCacheAffineProviderPayload(old, {
        ...old,
        input: [
          { type: "message", id: "changed" },
          { type: "message", id: "2" },
        ],
      }),
    ).toBe(false);
    expect(isCacheAffineProviderPayload(old, { ...old, prompt_cache_key: "new", input: [...old.input, {}] })).toBe(
      false,
    );
    expect(
      isCacheAffineProviderPayload(old, { ...old, unknown_provider_option: true, input: [...old.input, {}] }),
    ).toBe(false);
    expect(isCacheAffineProviderPayload(old, { ...old, max_output_tokens: 2048, input: [...old.input, {}] })).toBe(
      true,
    );
  });

  test("accepts Anthropic cache marker relocation while preserving policy", () => {
    const policy = { type: "ephemeral", ttl: "1h" };
    const old = {
      model: "claude",
      messages: [
        { role: "user", content: [{ type: "text", text: "old", cache_control: policy }] },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
      ],
      system: [{ type: "text", text: "s", cache_control: policy }],
    };
    const candidate: any = {
      ...old,
      messages: [
        { role: "user", content: [{ type: "text", text: "old" }] },
        old.messages[1],
        { role: "user", content: [{ type: "text", text: "summarize", cache_control: policy }] },
      ],
    };
    expect(isCacheAffineProviderPayload(old, candidate)).toBe(true);
    const changed = structuredClone(candidate);
    changed.messages[2].content[0].cache_control = { type: "ephemeral", ttl: "5m" };
    expect(isCacheAffineProviderPayload(old, changed)).toBe(false);
    const dropped = structuredClone(candidate);
    delete dropped.messages[2].content[0].cache_control;
    expect(isCacheAffineProviderPayload(old, dropped)).toBe(false);
  });
});

describe("summary validation", () => {
  const response = (stopReason: string, content: any[]): AssistantMessage =>
    ({
      role: "assistant",
      api: "openai-responses",
      provider: "p",
      model: "m",
      timestamp: 1,
      usage,
      stopReason,
      content,
    }) as any;
  test("accepts text and rejects errors, cancellation, length and tool calls", () => {
    expect(isUsableSummaryResponse(response("stop", [{ type: "text", text: "summary" }]))).toBe(true);
    expect(isUsableSummaryResponse(response("error", [{ type: "text", text: "x" }]))).toBe(false);
    expect(isUsableSummaryResponse(response("aborted", []))).toBe(false);
    expect(isUsableSummaryResponse(response("length", [{ type: "text", text: "partial" }]))).toBe(false);
    expect(
      isUsableSummaryResponse(response("toolUse", [{ type: "toolCall", id: "x", name: "execute", arguments: {} }])),
    ).toBe(false);
  });
});

describe("extension lifecycle", () => {
  test("passes model/thinking/session identity, never executes tools, and returns usage checkpoint", async () => {
    const handlers = new Map<string, Function>();
    let captured: any;
    const pi = {
      on: (name: string, fn: Function) => handlers.set(name, fn),
      getActiveTools: () => ["execute"],
      getAllTools: () => [{ name: "execute", description: "run", parameters: { type: "object" }, sourceInfo: {} }],
    } as any;
    registerCacheAffineCompaction(pi, () => [{ id: "task_fixture", kind: "command", status: "running" }]);
    const ctx = {
      model,
      thinkingLevel: "high",
      getSystemPrompt: () => "actual post-hook system",
      sessionManager: { getLeafId: () => "4", getSessionId: () => "stable-session" },
      modelRegistry: {
        completeSimple: async (m: any, context: any, options: any) => {
          captured = { m, context, options };
          options.onPayload({
            instructions: "actual post-hook system",
            input: [
              { role: "user", content: "old" },
              { role: "assistant", content: "new" },
            ],
            tools: [{ name: "execute" }],
            reasoning: { effort: "high" },
            prompt_cache_key: "stable-session",
            metadata: { current: true },
          });
          return {
            role: "assistant",
            api: model.api,
            provider: "p",
            model: "m",
            timestamp: 1,
            stopReason: "stop",
            usage,
            content: [{ type: "text", text: "## Goal\nContinue" }],
          };
        },
      },
    } as any;
    wireProvider(ctx, pi);
    await handlers.get("context")!({ messages: snapshot().messages }, ctx);
    await handlers.get("before_provider_request")!(
      {
        payload: {
          instructions: "actual post-hook system",
          input: [{ role: "user", content: "old" }],
          tools: [{ name: "execute" }],
          reasoning: { effort: "high" },
          prompt_cache_key: "stable-session",
        },
      },
      ctx,
    );
    const result = await handlers.get("session_before_compact")!(event(), ctx);
    expect(captured.options).toMatchObject({ sessionId: "stable-session", reasoning: "high" });
    expect(captured.context.tools.map((tool: any) => tool.name)).toEqual(["execute"]);
    expect(result.compaction.usage.cacheRead).toBe(8);
    expect(result.compaction.summary).toContain("task_fixture: command, running");
    expect(result.compaction.firstKeptEntryId).toBe("3");
    expect(result.compaction.details).toMatchObject({
      strategy: "cache-affine-plaintext",
      summaryEnd: 2,
      tailStart: 3,
      priorPayloadAffine: false,
    });
  });

  test("cancels rather than duplicating inference after a paid unusable response", async () => {
    const handlers = new Map<string, Function>();
    const attempts: any[] = [];
    const notices: Array<[string, string]> = [];
    const pi = {
      appendEntry: (type: string, data: any) => attempts.push({ type, data }),
      on: (n: string, f: Function) => handlers.set(n, f),
      getActiveTools: () => [],
      getAllTools: () => [],
    } as any;
    registerCacheAffineCompaction(pi);
    const ctx = {
      model,
      thinkingLevel: "high",
      getSystemPrompt: () => "s",
      ui: { notify: (message: string, level: string) => notices.push([message, level]) },
      sessionManager: { getLeafId: () => "4", getSessionId: () => "stable-session" },
      modelRegistry: {
        completeSimple: async (_m: any, _context: any, options: any) => {
          options.onPayload({
            input: [
              { role: "user", content: "old" },
              { role: "assistant", content: "new" },
            ],
          });
          return {
            role: "assistant",
            api: model.api,
            provider: "p",
            model: "m",
            timestamp: 1,
            stopReason: "length",
            usage,
            content: [{ type: "text", text: "partial" }],
          };
        },
      },
    } as any;
    wireProvider(ctx, pi);
    await handlers.get("context")!({ messages: snapshot().messages }, ctx);
    await handlers.get("before_provider_request")!({ payload: { input: [{ role: "user", content: "old" }] } }, ctx);
    expect(await handlers.get("session_before_compact")!(event(), ctx)).toEqual({ cancel: true });
    expect(notices[0]?.[0]).toContain("avoid duplicate inference");
    expect(attempts).toEqual([
      { type: "die-compaction-attempt", data: { strategy: "cache-affine-plaintext", stopReason: "length", usage } },
    ]);
  });

  test("makes unavailable preparation observable without flattening raw history", async () => {
    const handlers = new Map<string, Function>();
    const notices: string[] = [];
    const pi = {
      on: (n: string, f: Function) => handlers.set(n, f),
      getActiveTools: () => [],
      getAllTools: () => [],
    } as any;
    registerCacheAffineCompaction(pi);
    const ctx = {
      model,
      thinkingLevel: "high",
      getSystemPrompt: () => "s",
      ui: { notify: (message: string) => notices.push(message) },
      sessionManager: { getLeafId: () => "2", getSessionId: () => "stable-session" },
    } as any;
    wireProvider(ctx, pi);
    await handlers.get("context")!({ messages: snapshot().messages.slice(0, 2) }, ctx);
    await handlers.get("before_provider_request")!({ payload: { input: [{}] } }, ctx);
    expect(await handlers.get("session_before_compact")!(event(), ctx)).toEqual({ cancel: true });
    expect(notices[0]).toContain("this Pi runtime has no current-context preparation seam");
  });

  test("provider errors and aborts cancel without alternate inference", async () => {
    const handlers = new Map<string, Function>();
    const pi = {
      on: (n: string, f: Function) => handlers.set(n, f),
      getActiveTools: () => [],
      getAllTools: () => [],
    } as any;
    registerCacheAffineCompaction(pi);
    const ctx = {
      model,
      thinkingLevel: "high",
      getSystemPrompt: () => "s",
      sessionManager: { getLeafId: () => "4", getSessionId: () => "stable-session" },
      modelRegistry: {
        completeSimple: async () => {
          throw new Error("offline");
        },
      },
    } as any;
    wireProvider(ctx, pi);
    await handlers.get("context")!({ messages: snapshot().messages }, ctx);
    await handlers.get("before_provider_request")!({ payload: { input: [{ role: "user", content: "old" }] } }, ctx);
    expect(await handlers.get("session_before_compact")!(event(), ctx)).toEqual({ cancel: true });
    const controller = new AbortController();
    controller.abort();
    expect(await handlers.get("session_before_compact")!(event({ signal: controller.signal }), ctx)).toEqual({
      cancel: true,
    });
  });
});

test("provider guard never treats tool-input cache_control keys as cache metadata", () => {
  const before = {
    messages: [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t", name: "execute", input: { cache_control: { type: "ephemeral" } } }],
      },
    ],
  };
  const after = {
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "t", name: "execute", input: {} }] },
      { role: "user", content: [{ type: "text", text: "summary", cache_control: { type: "ephemeral" } }] },
    ],
  };
  expect(isCacheAffineProviderPayload(before, after)).toBe(false);
});

test("summary focus is literal data, not another round of template replacement", () => {
  const request = buildCacheAffineRequest(snapshot(), event(), "Preserve $& and {{tailAnchor}} literally")!;
  expect((request.messages[request.messages.length - 1] as any).content[0].text).toContain(
    "Preserve $& and {{tailAnchor}} literally",
  );
});

describe("instruction frame ownership lifecycle", () => {
  const manager = (initial: string) => {
    let id = initial;
    return {
      getSessionId: () => id,
      switchTo: (next: string) => {
        id = next;
      },
    };
  };

  test("independent managers sharing one persisted id never share ownership", () => {
    const first = manager("persisted-id");
    const second = manager("persisted-id");
    scopeInstructionContinuity(first);
    scopeInstructionContinuity(second);
    expect(setCurrentInstructionFrame(first, "first-frame")).toBe(true);
    expect(setCurrentInstructionFrame(second, "second-frame")).toBe(true);
    clearInstructionContinuity(first);
    expect(setCurrentInstructionFrame(first, "leak")).toBe(false);
    expect(setCurrentInstructionFrame(second, "still-owned")).toBe(true);
    clearInstructionContinuity(second);
  });

  test("shutdown/reload/new clearing and in-place session switches cannot revive a frame", () => {
    const owner = manager("old-session");
    for (const lifecycle of ["shutdown", "reload", "new"] as const) {
      scopeInstructionContinuity(owner);
      expect(setCurrentInstructionFrame(owner, lifecycle + "-frame")).toBe(true);
      clearInstructionContinuity(owner);
      expect(setCurrentInstructionFrame(owner, "stale")).toBe(false);
    }
    scopeInstructionContinuity(owner);
    expect(setCurrentInstructionFrame(owner, "old-frame")).toBe(true);
    owner.switchTo("new-session");
    expect(setCurrentInstructionFrame(owner, "cross-session-leak")).toBe(false);
    owner.switchTo("old-session");
    expect(setCurrentInstructionFrame(owner, "revived-frame")).toBe(false);
  });
});
