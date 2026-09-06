import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  CACHE_CALL_ENTRY,
  CacheCountdown,
  DEFAULT_CACHE_TTL_MS,
  loadCacheSettings,
  parseCacheSettings,
  parseCacheTtl,
  registerCacheCountdown,
} from "../src/tasks/cache-countdown";
import { reportProviderAttempt, subscribeProviderAttempts } from "../src/tasks/provider-attempts";
import { inspectDiagnostics } from "../src/diagnostics";

function context(provider = "openai", id = "alpha", entries: any[] = []) {
  return {
    model: { provider, id },
    sessionManager: { getEntries: () => entries },
    ui: { notify() {} },
  } as unknown as ExtensionContext;
}

describe("cache countdown", () => {
  test("is per-agent/model, coarse, warning-colored state, expired, and unknown", () => {
    let now = 1_000_000;
    const a = new CacheCountdown(() => now),
      b = new CacheCountdown(() => now);
    const ctx = context();
    expect(a.estimate(ctx)).toEqual({ state: "unknown", text: "cache est ?" });
    a.record({ appendEntry() {} } as unknown as ExtensionAPI, ctx.model!);
    expect(a.estimate(ctx)).toMatchObject({ state: "active", text: "cache est 60m" });
    now += 45 * 60_000;
    expect(a.estimate(ctx)).toMatchObject({ state: "warning", text: "cache est 15m" });
    now += 10 * 60_000;
    expect(a.estimate(ctx)).toMatchObject({ state: "urgent", text: "cache est 5m" });
    now += 5 * 60_000;
    expect(a.estimate(ctx)).toEqual({ state: "expired", text: "cache est expired" });
    expect(b.estimate(ctx).state).toBe("unknown");
    expect(a.estimate(context("openai", "beta")).state).toBe("unknown");
  });
  test("restores durable exact-model calls without allowing descendant resets", () => {
    const parent = new CacheCountdown(() => 9000);
    const entries = [
      { type: "custom", customType: CACHE_CALL_ENTRY, data: { timestamp: 1000, provider: "p", model: "m" } },
    ];
    parent.restore(context("p", "m", entries));
    const child = new CacheCountdown(() => 9000);
    child.record({ appendEntry() {} } as unknown as ExtensionAPI, context("p", "m").model!, 8000);
    expect(parent.estimate(context("p", "m"), 9000).text).toBe("cache est 60m");
    expect(child.estimate(context("p", "m"), 9000).text).toBe("cache est 60m");
    expect(parent.estimate(context("p", "other"), 9000).state).toBe("unknown");
  });
  test("a branch-local shake invalidates only earlier cache observations", () => {
    const countdown = new CacheCountdown(() => 3000);
    countdown.restore(
      context("p", "m", [
        { type: "custom", customType: CACHE_CALL_ENTRY, data: { timestamp: 1000, provider: "p", model: "m" } },
        { type: "custom", customType: "die-manual-shake", data: {} },
      ]),
    );
    expect(countdown.estimate(context("p", "m"), 3000).state).toBe("unknown");
    countdown.restore(
      context("p", "m", [
        { type: "custom", customType: "die-manual-shake", data: {} },
        { type: "custom", customType: CACHE_CALL_ENTRY, data: { timestamp: 2000, provider: "p", model: "m" } },
      ]),
    );
    expect(countdown.estimate(context("p", "m"), 3000).state).toBe("active");
  });

  test("validates durations and strict persisted settings", () => {
    expect(parseCacheTtl("30m")).toBe(1_800_000);
    expect(parseCacheTtl("1h")).toBe(DEFAULT_CACHE_TTL_MS);
    expect(parseCacheTtl("1.5h")).toBe(5_400_000);
    expect(parseCacheTtl("2")).toBe(120_000);
    for (const bad of ["", "zero", "0m", "8d", "1.001m"]) expect(() => parseCacheTtl(bad)).toThrow();
    expect(() => parseCacheSettings({ cacheTtlMs: 60000, extra: true })).toThrow("unknown setting");
  });
  test("public command persists separately and records observed attempts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-cache-"));
    const path = join(dir, "cache-settings.json"),
      userPath = join(dir, "settings.json");
    try {
      await writeFile(userPath, JSON.stringify({ theme: "custom", unrelated: { keep: true } }));
      const handlers = new Map<string, Function>();
      let command: any,
        note = "",
        kind = "",
        appended: any[] = [];
      const pi = {
        on: (name: string, fn: Function) => handlers.set(name, fn),
        registerCommand: (name: string, value: any) => {
          expect(name).toBe("cache-ttl");
          command = value;
        },
        appendEntry: (type: string, data: any) => appended.push({ type, data }),
      } as unknown as ExtensionAPI;
      const cache = new CacheCountdown(() => 123456);
      registerCacheCountdown(pi, cache, path);
      const ctx = context();
      (ctx.ui as any).notify = (message: string, k: string) => {
        note = message;
        kind = k;
      };
      await handlers.get("session_start")!({}, ctx);
      reportProviderAttempt(ctx.sessionManager as object, { provider: "openai", id: "alpha" }, "response", 123456);
      reportProviderAttempt(ctx.sessionManager as object, { provider: "openai", id: "alpha" }, "response", 123457); // response-backed retry
      expect(appended).toHaveLength(2);
      expect(appended[0].type).toBe(CACHE_CALL_ENTRY);
      await command.handler("90m", ctx);
      expect(kind).toBe("info");
      expect(note).toContain("does not guarantee");
      expect((await loadCacheSettings(path)).ttlMs).toBe(5_400_000);
      await command.handler("nonsense", ctx);
      expect(kind).toBe("error");
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ cacheTtlMs: 5_400_000 });
      expect(JSON.parse(await readFile(userPath, "utf8"))).toEqual({ theme: "custom", unrelated: { keep: true } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("response observations use event identity and count retries, never the later selected model", async () => {
    const handlers = new Map<string, Function>(),
      appended: any[] = [];
    const pi = {
      on: (name: string, fn: Function) => handlers.set(name, fn),
      registerCommand() {},
      appendEntry: (type: string, data: any) => appended.push({ type, data }),
    } as unknown as ExtensionAPI;
    registerCacheCountdown(pi, new CacheCountdown(), join(tmpdir(), "missing-cache-settings-" + Date.now()));
    const ctx = context("p", "prepared");
    await handlers.get("session_start")!({}, ctx);
    handlers.get("before_provider_request")!({ payload: {} }, ctx);
    (ctx as any).model = { provider: "p", id: "selected-later" };
    for (const status of [401, 429, 500]) {
      handlers.get("after_provider_response")!({ status, headers: {}, model: { provider: "p", id: "actual" } }, ctx);
      handlers.get("before_provider_request")!({ payload: {} }, ctx); // provider retry is a new attempt
    }
    handlers.get("after_provider_response")!({ status: 200, headers: {}, model: { provider: "p", id: "actual" } }, ctx);
    handlers.get("before_provider_request")!({ payload: {} }, ctx);
    (ctx as any).model = { provider: "p", id: "selected-after-dispatch" };
    handlers.get("message_end")!(
      { message: { role: "assistant", provider: "p", model: "actual-ws", stopReason: "stop" } },
      ctx,
    );
    handlers.get("message_end")!(
      { message: { role: "assistant", provider: "p", model: "duplicate", stopReason: "stop" } },
      ctx,
    );
    expect(appended.map((entry) => entry.data.model)).toEqual(["actual", "actual-ws"]);
  });

  test("correlates distinguishable interleaved responses and blocks ambiguous overlap", async () => {
    const handlers = new Map<string, Function>(),
      appended: any[] = [];
    const pi = {
      on: (name: string, fn: Function) => handlers.set(name, fn),
      registerCommand() {},
      appendEntry: (type: string, data: any) => appended.push({ type, data }),
    } as unknown as ExtensionAPI;
    registerCacheCountdown(pi, new CacheCountdown(), join(tmpdir(), "missing-cache-settings-" + Date.now()));
    const ctx = context("p", "one");
    await handlers.get("session_start")!({}, ctx);
    handlers.get("before_provider_request")!({}, ctx);
    (ctx as any).model = { provider: "p", id: "two" };
    handlers.get("before_provider_request")!({}, ctx);
    handlers.get("after_provider_response")!({ status: 200, model: { provider: "p", id: "two" } }, ctx);
    handlers.get("after_provider_response")!({ status: 200, model: { provider: "p", id: "one" } }, ctx);
    expect(appended.map((entry) => entry.data.model)).toEqual(["two", "one"]);

    (ctx as any).model = { provider: "p", id: "same" };
    handlers.get("before_provider_request")!({}, ctx);
    handlers.get("before_provider_request")!({}, ctx);
    handlers.get("after_provider_response")!({ status: 200, model: { provider: "p", id: "same" } }, ctx);
    handlers.get("after_provider_response")!({ status: 200, model: { provider: "p", id: "same" } }, ctx);
    expect(appended).toHaveLength(2);
    expect(inspectDiagnostics(ctx.sessionManager as object).records).toContainEqual({
      component: "cache",
      code: "cache_correlation_unavailable",
      outcome: "blocked",
      dispatch: "unknown",
      count: 2,
    });
  });

  test("attempt IDs are unique and observer diagnostics contain no private failure data", () => {
    const owner = {},
      ids: string[] = [];
    subscribeProviderAttempts(owner, (event) => ids.push(event.operationId));
    subscribeProviderAttempts(owner, () => {
      throw new Error("secret payload and credential");
    });
    reportProviderAttempt(owner, { provider: "p", id: "m" }, "dispatch", 1);
    reportProviderAttempt(owner, { provider: "p", id: "m" }, "dispatch", 2);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const records = inspectDiagnostics(owner).records;
    expect(records.filter((record) => record.code === "observer_failed")).toHaveLength(2);
    expect(JSON.stringify(records)).not.toContain("secret");
    expect(
      records.every(
        (record) => !Object.keys(record).some((key) => ["error", "payload", "headers", "usage"].includes(key)),
      ),
    ).toBe(true);
  });
  test("warns about corrupt cache settings without changing them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-cache-corrupt-"));
    const path = join(dir, "cache-settings.json");
    try {
      const corrupt = "{ definitely not json";
      await writeFile(path, corrupt);
      const handlers = new Map<string, Function>();
      let warning = "",
        kind = "";
      const pi = {
        on: (name: string, fn: Function) => handlers.set(name, fn),
        registerCommand() {},
        appendEntry() {},
      } as unknown as ExtensionAPI;
      registerCacheCountdown(pi, new CacheCountdown(), path);
      const ctx = context();
      (ctx.ui as any).notify = (message: string, k: string) => {
        warning = message;
        kind = k;
      };
      await handlers.get("session_start")!({}, ctx);
      expect(kind).toBe("warning");
      expect(warning).toContain("left unchanged");
      expect(await readFile(path, "utf8")).toBe(corrupt);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("provider observers are nonfatal and append failure causes no model drift", () => {
    const owner = {};
    let observed = "";
    subscribeProviderAttempts(owner, () => {
      throw new Error("broken optional telemetry");
    });
    subscribeProviderAttempts(owner, (event) => {
      observed = event.model.id;
    });
    expect(() => reportProviderAttempt(owner, { provider: "p", id: "native" }, "dispatch", 1000)).not.toThrow();
    expect(observed).toBe("native");

    const countdown = new CacheCountdown(() => 2000);
    countdown.record({ appendEntry() {} } as unknown as ExtensionAPI, { provider: "p", id: "stable" }, 1000);
    expect(() =>
      countdown.record(
        {
          appendEntry() {
            throw new Error("disk full");
          },
        } as unknown as ExtensionAPI,
        { provider: "p", id: "drift" },
        1500,
      ),
    ).toThrow("disk full");
    expect(countdown.estimate(context("p", "stable"), 2000).state).toBe("active");
    expect(countdown.estimate(context("p", "drift"), 2000).state).toBe("unknown");
  });
});
