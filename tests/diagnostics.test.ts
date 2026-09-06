import { expect, test } from "bun:test";
import { attachDiagnosticSink, diagnosticRecords, inspectDiagnostics, recordDiagnostic } from "../src/diagnostics";
import { registerOperationDiagnostics } from "../src/diagnostics-extension";

const valid = { component: "provider", code: "provider_failed", outcome: "failed" } as const;

test("diagnostics discard unknown and secret-bearing fields", () => {
  const owner = {};
  const written: any[] = [];
  attachDiagnosticSink(owner, (type, data) => written.push({ type, data }));
  recordDiagnostic(owner, { ...valid, error: "SENTINEL", headers: { authorization: "SENTINEL" } } as any);
  expect(written).toHaveLength(1);
  expect(JSON.stringify(written)).not.toContain("SENTINEL");
  expect(inspectDiagnostics(owner).records).toEqual([valid]);
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

test("ring, durable budget, dedup, and throwing sinks stay bounded and nonthrowing", () => {
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
});

test("reattachment detaches stale sinks and resets per-session visibility", () => {
  const owner = {};
  const first: unknown[] = [],
    second: unknown[] = [];
  const staleDetach = attachDiagnosticSink(owner, (_type, data) => first.push(data));
  recordDiagnostic(owner, valid);
  const detach = attachDiagnosticSink(owner, (_type, data) => second.push(data));
  staleDetach();
  expect(inspectDiagnostics(owner).records).toEqual([]);
  recordDiagnostic(owner, { ...valid, outcome: "fallback" });
  expect(first).toHaveLength(1);
  expect(second).toHaveLength(1);
  detach();
  recordDiagnostic(owner, { ...valid, outcome: "success" });
  expect(second).toHaveLength(1);
});

test("durable replay validates custom entries and diagnostics command switches sessions", async () => {
  const handlers: Record<string, Function[]> = {};
  let command: any;
  const appended: any[] = [],
    notices: string[] = [];
  const pi: any = {
    on(name: string, handler: Function) {
      if (!handlers[name]) handlers[name] = [];
      handlers[name]!.push(handler);
    },
    appendEntry(type: string, data: unknown) {
      appended.push({ type: "custom", customType: type, data });
    },
    registerCommand(_name: string, value: unknown) {
      command = value;
    },
  };
  registerOperationDiagnostics(pi);
  const one = { getBranch: () => appended },
    two = { getBranch: () => appended };
  const ctx = (sessionManager: object) => ({ sessionManager, ui: { notify: (text: string) => notices.push(text) } });
  handlers.session_start[0]({}, ctx(one));
  recordDiagnostic(one, valid);
  handlers.session_shutdown[0]({}, ctx(one));
  handlers.session_start[0]({}, ctx(two));
  recordDiagnostic(two, { ...valid, outcome: "success" });
  await command.handler("durable", ctx(two));
  expect(JSON.parse(notices.at(-1)!).records).toEqual([{ ...valid, outcome: "success" }]);
  expect(JSON.parse(notices.at(-1)!).durable).toHaveLength(2);
  expect(
    diagnosticRecords([{ type: "custom", customType: "die-diagnostic", data: { ...valid, error: "SENTINEL" } }]),
  ).toEqual([valid]);
});
