import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  attachDiagnosticSink,
  diagnosticRecorder,
  diagnosticRecords,
  inspectDiagnostics,
  recordDiagnostic,
  scanDiagnosticRecords,
} from "../src/diagnostics";
import { registerOperationDiagnostics } from "../src/diagnostics-extension";
import { MANUAL_SHAKE_ENTRY, latestShakeRecord } from "../src/tasks/manual-shake";
import { NATIVE_FAST_ENTRY } from "../src/tasks/native-fast-mode";

const valid = { component: "provider", code: "provider_failed", outcome: "failed" } as const;
const entry = (data: unknown) => ({ type: "custom", customType: "die-diagnostic", data });

function expectRecord(value: any, core = valid) {
  expect(value).toMatchObject({ version: 1, ...core });
  expect(new Date(value.generated).toISOString()).toBe(value.generated);
}

test("diagnostics discard caller extras and durable replay rejects extras", () => {
  const owner = {};
  const written: any[] = [];
  attachDiagnosticSink(owner, (type, data) => written.push({ type, data }));
  recordDiagnostic(owner, { ...valid, error: "SENTINEL", headers: { authorization: "SENTINEL" } } as any);
  expect(written).toHaveLength(1);
  expect(JSON.stringify(written)).not.toContain("SENTINEL");
  expectRecord(written[0].data);
  expect(inspectDiagnostics(owner).records).toEqual([written[0].data]);
  expect(diagnosticRecords([entry({ ...written[0].data, error: "SENTINEL" })])).toEqual([]);
  expect(diagnosticRecords([entry(written[0].data)])).toEqual([written[0].data]);
});

test("hostile getters and proxies never escape diagnostic recording", () => {
  const owner = {};
  attachDiagnosticSink(owner, () => {});
  const getter = Object.defineProperty({}, "component", {
    get: () => {
      throw new Error("SENTINEL");
    },
  });
  const proxy = new Proxy(
    {},
    {
      get: () => {
        throw new Error("SENTINEL");
      },
      ownKeys: () => {
        throw new Error("SENTINEL");
      },
    },
  );
  expect(() => recordDiagnostic(owner, getter as any)).not.toThrow();
  expect(() => recordDiagnostic(owner, proxy as any)).not.toThrow();
  expect(() => recordDiagnostic(new Proxy({}, {}) as any, proxy as any)).not.toThrow();
});

test("invalid enum and oversized identifiers fail closed", () => {
  const owner = {};
  const written: any[] = [];
  attachDiagnosticSink(owner, (_type, data) => written.push(data));
  recordDiagnostic(owner, { ...valid, outcome: "maybe" } as any);
  recordDiagnostic(owner, { ...valid, taskId: "task_" + "x".repeat(65) });
  recordDiagnostic(owner, { ...valid, code: "new_unreviewed_code" });
  expect(written).toEqual([]);
  expect(inspectDiagnostics(owner)).toMatchObject({ invalid: 3, dropped: 3, records: [] });
});

test("ring, durable budget, dedup, throwing and reentrant sinks stay bounded", () => {
  const owner = {};
  let writes = 0;
  attachDiagnosticSink(owner, () => {
    writes++;
    throw new Error("disk full SENTINEL");
  });
  for (let i = 0; i < 500; i++) expect(() => recordDiagnostic(owner, { ...valid, count: i })).not.toThrow();
  const snapshot = inspectDiagnostics(owner);
  expect(snapshot.records).toHaveLength(100);
  expect(writes).toBe(128);
  expect(snapshot.writeFailures).toBe(128);
  expect(snapshot.budgetDropped).toBe(372);

  const duplicateOwner = {};
  let duplicateWrites = 0;
  attachDiagnosticSink(duplicateOwner, () => duplicateWrites++);
  for (let i = 0; i < 20; i++) recordDiagnostic(duplicateOwner, valid);
  expect(duplicateWrites).toBe(1);
  expect(inspectDiagnostics(duplicateOwner).deduplicated).toBe(19);

  const reentrantOwner = {};
  let reentrantWrites = 0;
  attachDiagnosticSink(reentrantOwner, () => {
    reentrantWrites++;
    recordDiagnostic(reentrantOwner, { ...valid, count: reentrantWrites });
  });
  recordDiagnostic(reentrantOwner, valid);
  expect(reentrantWrites).toBe(1);
  expect(inspectDiagnostics(reentrantOwner)).toMatchObject({ budgetDropped: 1, dropped: 1 });
});

test("reload seeds the lifetime durable cap and scoped recorders expire", () => {
  const owner = {};
  const persisted: any[] = [];
  attachDiagnosticSink(owner, (_type, data) => persisted.push(entry(data)));
  const staleRecorder = diagnosticRecorder(owner);
  for (let i = 0; i < 128; i++) recordDiagnostic(owner, { ...valid, count: i });
  expect(persisted).toHaveLength(128);

  let writes = 0;
  attachDiagnosticSink(owner, () => writes++, persisted);
  staleRecorder({ ...valid, outcome: "fallback" });
  recordDiagnostic(owner, { ...valid, outcome: "success" });
  expect(writes).toBe(0);
  expect(inspectDiagnostics(owner)).toMatchObject({ accepted: 1, budgetDropped: 1 });

  const scanLimitedOwner = {};
  let scanLimitedWrites = 0;
  attachDiagnosticSink(scanLimitedOwner, () => scanLimitedWrites++, [
    ...persisted,
    ...Array.from({ length: 10_001 }, () => ({ type: "message" })),
  ]);
  recordDiagnostic(scanLimitedOwner, { ...valid, outcome: "noop" });
  expect(scanLimitedWrites).toBe(0);
});

test("bounded replay searches backward for diagnostics and reports scan loss", () => {
  const owner = {};
  const captured: any[] = [];
  attachDiagnosticSink(owner, (_type, data) => captured.push(data));
  recordDiagnostic(owner, valid);
  const oldDiagnostic = entry(captured[0]);
  const records = diagnosticRecords([oldDiagnostic, ...Array.from({ length: 600 }, () => ({ type: "message" }))]);
  expect(records).toHaveLength(1);
  const limited = scanDiagnosticRecords([
    oldDiagnostic,
    ...Array.from({ length: 10_001 }, () => ({ type: "message" })),
  ]);
  expect(limited).toMatchObject({ records: [], scanned: 10_000, scanLimit: 10_000, scanLimited: true });
  expect(
    scanDiagnosticRecords(
      new Proxy([], {
        get: () => {
          throw new Error("SENTINEL");
        },
      }),
    ),
  ).toMatchObject({
    records: [],
    scanLimited: true,
  });
});

test("extension guards same-manager switches and preserves shutdown diagnostics", async () => {
  const handlers: Record<string, Function[]> = {};
  let command: any;
  const notices: string[] = [];
  let activeEntries: any[] = [];
  let leafId: string | null = "leaf-one";
  const pi: any = {
    on(name: string, handler: Function) {
      if (!handlers[name]) handlers[name] = [];
      handlers[name].push(handler);
    },
    appendEntry(type: string, data: unknown) {
      const id = `diagnostic-${activeEntries.length}`;
      activeEntries.push({ type: "custom", customType: type, data, id, parentId: leafId });
      leafId = id;
    },
    registerCommand(_name: string, value: unknown) {
      command = value;
    },
  };
  registerOperationDiagnostics(pi);
  let sid = "one";
  const manager = {
    getSessionId: () => sid,
    getEntries: () => activeEntries,
    getLeafId: () => leafId,
    branch: (id: string) => {
      leafId = id;
    },
    resetLeaf: () => {
      leafId = null;
    },
  };
  const ctx = { sessionManager: manager, ui: { notify: (text: string) => notices.push(text) } };
  handlers.session_start[0]({}, ctx);
  const stale = diagnosticRecorder(manager);
  recordDiagnostic(manager, valid);
  expect(leafId).toBe("leaf-one");
  handlers.session_shutdown[0]({}, ctx);
  recordDiagnostic(manager, { ...valid, outcome: "fallback" });
  expect(activeEntries).toHaveLength(2);

  sid = "two";
  activeEntries = [];
  leafId = null;
  handlers.session_start[0]({}, ctx);
  stale({ ...valid, outcome: "cancelled" });
  recordDiagnostic(manager, { ...valid, outcome: "success" });
  expect(activeEntries).toHaveLength(1);
  expect(leafId).toBeNull();
  await command.handler("durable", ctx);
  const output = JSON.parse(notices.at(-1)!);
  expect(output.records).toHaveLength(1);
  expect(output.durable).toHaveLength(1);
  expect(output.durableScan.scanLimited).toBe(false);
});

test("extension refuses persistence when the active leaf cannot be restored", () => {
  const handlers: Record<string, Function> = {};
  let appends = 0;
  const pi: any = {
    on: (name: string, handler: Function) => {
      handlers[name] = handler;
    },
    appendEntry: () => appends++,
    registerCommand() {},
  };
  registerOperationDiagnostics(pi);
  const manager = {
    getSessionId: () => "session",
    getEntries: () => [],
    getLeafId: () => "active-leaf",
    // No public branch API: writing would make restoration impossible.
  };
  handlers.session_start({}, { sessionManager: manager });
  recordDiagnostic(manager, valid);
  expect(appends).toBe(0);
  expect(inspectDiagnostics(manager)).toMatchObject({ writeFailures: 0, accepted: 1 });
});

test("actual SDK keeps the runtime leaf stable and reopened diagnostics context-transparent", async () => {
  const root = await mkdtemp(join(tmpdir(), "die-diagnostics-sdk-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const manager = SessionManager.create(root, join(root, "sessions"));
    manager.appendMessage({ role: "user", content: "same conversation", timestamp: 1 });
    manager.appendMessage({
      role: "assistant",
      api: "openai-chat-completions",
      provider: "openai",
      model: "gpt-4o",
      content: [{ type: "text", text: "same answer" }],
      stopReason: "stop",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: 2,
    });
    manager.appendThinkingLevelChange("high");
    manager.appendModelChange("openai", "gpt-4o");
    const shake = {
      version: 1 as const,
      sessionId: manager.getSessionId(),
      shakenAt: 2,
      assistantEntryIds: [],
      toolResultEntryIds: [],
    };
    manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, shake);
    const fast = {
      version: 1 as const,
      sessionId: manager.getSessionId(),
      provider: "openai",
      model: "gpt-4o",
      enabled: true,
      costAcknowledged: true,
      timestamp: 3,
    };
    manager.appendCustomEntry(NATIVE_FAST_ENTRY, fast);

    const runtime = await ModelRuntime.create({
      authPath: join(root, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: root,
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      extensionFactories: [{ name: "diagnostics", factory: registerOperationDiagnostics }],
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: root,
      agentDir: root,
      resourceLoader: loader,
      model: getModel("openai", "gpt-4o"),
      modelRuntime: runtime,
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
      tools: [],
    }));
    await session.bindExtensions({ mode: "print" });

    const leaf = manager.getLeafId();
    const context = manager.buildSessionContext();
    const branch = manager.getBranch();
    expect(latestShakeRecord(branch, manager.getSessionId())).toEqual(shake);
    expect((branch.find((value: any) => value.customType === NATIVE_FAST_ENTRY) as any)?.data).toEqual(fast);

    recordDiagnostic(manager, valid);
    expect(manager.getLeafId()).toBe(leaf);
    expect(manager.getBranch()).toEqual(branch);

    const append = manager.appendCustomEntry.bind(manager);
    manager.appendCustomEntry = ((type: string, data?: unknown) => {
      const id = append(type, data);
      if (type === "die-diagnostic") throw new Error("append completed, observer failed");
      return id;
    }) as typeof manager.appendCustomEntry;
    expect(() => recordDiagnostic(manager, { ...valid, outcome: "fallback" })).not.toThrow();
    expect(manager.getLeafId()).toBe(leaf);
    expect(manager.getBranch()).toEqual(branch);

    const file = manager.getSessionFile()!;
    session.dispose();
    session = undefined;
    const reopened = SessionManager.open(file);
    expect(reopened.buildSessionContext()).toEqual(context);
    expect(reopened.buildSessionContext()).toMatchObject({
      thinkingLevel: "high",
      model: { provider: "openai", modelId: "gpt-4o" },
    });
    expect(latestShakeRecord(reopened.getBranch(), reopened.getSessionId())).toEqual(shake);
    expect((reopened.getBranch().find((value: any) => value.customType === NATIVE_FAST_ENTRY) as any)?.data).toEqual(
      fast,
    );
    expect(diagnosticRecords(reopened.getEntries())).toHaveLength(2);
    expect(reopened.getLeafEntry()).toMatchObject({ type: "custom", customType: "die-diagnostic" });
  } finally {
    session?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("diagnostic getters cannot substitute unvalidated values after validation", () => {
  const owner = {};
  let reads = 0;
  recordDiagnostic(owner, {
    component: "cache",
    code: "observer_failed",
    outcome: "failed",
    get taskId() {
      return ++reads === 1 ? "task_12345678" : "SECRET_SENTINEL";
    },
  });
  expect(reads).toBe(1);
  expect(JSON.stringify(inspectDiagnostics(owner))).not.toContain("SECRET_SENTINEL");
  expect(inspectDiagnostics(owner).records[0]?.taskId).toBe("task_12345678");
});
