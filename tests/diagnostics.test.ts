import { expect, test } from "bun:test";
import {
  attachDiagnosticSink,
  diagnosticRecorder,
  diagnosticRecords,
  inspectDiagnostics,
  recordDiagnostic,
  scanDiagnosticRecords,
} from "../src/diagnostics";
import { registerOperationDiagnostics } from "../src/diagnostics-extension";

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
  const pi: any = {
    on(name: string, handler: Function) {
      if (!handlers[name]) handlers[name] = [];
      handlers[name].push(handler);
    },
    appendEntry(type: string, data: unknown) {
      activeEntries.push({ type: "custom", customType: type, data });
    },
    registerCommand(_name: string, value: unknown) {
      command = value;
    },
  };
  registerOperationDiagnostics(pi);
  let sid = "one";
  const manager = { getSessionId: () => sid, getBranch: () => activeEntries };
  const ctx = { sessionManager: manager, ui: { notify: (text: string) => notices.push(text) } };
  handlers.session_start[0]({}, ctx);
  const stale = diagnosticRecorder(manager);
  recordDiagnostic(manager, valid);
  handlers.session_shutdown[0]({}, ctx);
  recordDiagnostic(manager, { ...valid, outcome: "fallback" });
  expect(activeEntries).toHaveLength(2);

  sid = "two";
  activeEntries = [];
  handlers.session_start[0]({}, ctx);
  stale({ ...valid, outcome: "cancelled" });
  recordDiagnostic(manager, { ...valid, outcome: "success" });
  expect(activeEntries).toHaveLength(1);
  await command.handler("durable", ctx);
  const output = JSON.parse(notices.at(-1)!);
  expect(output.records).toHaveLength(1);
  expect(output.durable).toHaveLength(1);
  expect(output.durableScan.scanLimited).toBe(false);
});
