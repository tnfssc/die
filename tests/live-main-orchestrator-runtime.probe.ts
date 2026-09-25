/** Offline, non-production Live-facing execute probe. Run with DIE_PROBE_EXECUTABLE=absolute/path/to/dist/die bun test this-file. */
import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerExecuteTool } from "../src/typescript/extension";
import { TaskManager } from "../src/tasks/task-manager";
import { JobService } from "../src/tasks/job-service";

const executable = process.env.DIE_PROBE_EXECUTABLE;
if (!executable?.startsWith("/")) throw new Error("Set DIE_PROBE_EXECUTABLE to a locally built Die binary; no user jobs are started");

test("voice-facing declaration dispatches to existing execute tool and child runtime", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "die-live-execute-probe-"));
  try {
    let tool!: ToolDefinition;
    const handlerCalls: Array<{ method: string; params: unknown }> = [];
    const pi = { registerTool(value: ToolDefinition) { tool = value; }, on() {} } as unknown as ExtensionAPI;
    // Real tool registration, executeIsolated child, runner and job bridge; fake session/job service only.
    registerExecuteTool(pi, async (_ctx, method, params) => {
      handlerCalls.push({ method, params });
      if (method === "subagent") return { id: "fixture-worker", status: "running", background: true };
      if (method === "jobs.inspect") return { id: "fixture-worker", status: "running", output: "" };
      throw new Error("Fixture denies " + method);
    }, executable);
    const ctx = { cwd, sessionManager: {
      getSessionId: () => "fixture-session", getLeafId: () => "fixture-leaf",
      getSessionFile: () => join(cwd, "fixture.jsonl"),
    } } as unknown as ExtensionContext;
    // The provider declaration here is deliberately only a test adapter; current Live does not advertise execute.
    const declaration = { name: tool.name, parametersJsonSchema: tool.parameters };
    expect(declaration.parametersJsonSchema).toBe(tool.parameters);
    expect(JSON.stringify(declaration.parametersJsonSchema)).toContain("outputByteLimit");
    const dispatch = async (name: string, args: Record<string, unknown>) => {
      if (name !== declaration.name) throw new Error("Unknown voice tool");
      return tool.execute("fixture-call", args, undefined, undefined, ctx);
    };
    const ok = await dispatch("execute", { code: "const n: number = 6; console.log(n * 7)", timeoutSeconds: 3 });
    expect(ok.isError).toBeFalsy();
    expect(JSON.stringify(ok.content)).toContain("42");
    const worker = await dispatch("execute", { code: 'console.log(await subagent({prompt: "fixture only", waitSeconds: 0}))', timeoutSeconds: 3 });
    expect(worker.isError).toBeFalsy();
    expect(JSON.stringify(worker.content)).toContain("fixture-worker");
    expect(handlerCalls.map(c => c.method)).toEqual(["subagent"]);
    await expect(dispatch("execute", { code: 'await shell("not run")', timeoutSeconds: 3 })).rejects.toThrow("Fixture denies shell");
    await expect(dispatch("execute", { code: 'throw new Error("fixture runtime failure")', timeoutSeconds: 3 })).rejects.toThrow("fixture runtime failure");
    await expect(dispatch("unknown", { code: "1" })).rejects.toThrow("Unknown voice tool");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

// Isolated owner fixture: REAL local manager/service and process; no provider or model child.
// It does not exercise production Pi session ownership, completion routing, or permission UI.
test("execute bridge launches real async shell and inspects completed bounded output", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "die-live-job-probe-"));
  const manager = new TaskManager(() => {});
  const service = new JobService(manager, () => ({ depth: 0 }));
  let tool!: ToolDefinition;
  const pi = { registerTool(value: ToolDefinition) { tool = value; }, on() {} } as unknown as ExtensionAPI;
  const ctx = { cwd, sessionManager: {
    getSessionId: () => "isolated-job-session", getLeafId: () => "isolated-job-leaf",
    getSessionFile: () => join(cwd, "fixture.jsonl"),
  } } as unknown as ExtensionContext;
  registerExecuteTool(pi, (context, method, params, signal) => service.handle(method, params, context, signal), executable);
  const dispatch = (code: string, outputByteLimit?: number) =>
    tool.execute("isolated-call", { code, timeoutSeconds: 5, ...(outputByteLimit === undefined ? {} : { outputByteLimit }) }, undefined, undefined, ctx);
  try {
    // Sleep only in this disposable fixture: waitSeconds:0 proves return before completion.
    const launch = await dispatch('console.log(await shell("sleep 0.3; printf abcdefghij", { waitSeconds: 0 }))');
    expect(launch.isError).toBeFalsy();
    const [job] = manager.list();
    expect(job?.kind).toBe("command");
    expect(job?.status).toBe("running");
    expect(JSON.stringify(launch.content)).toContain(job.id);
    expect(JSON.stringify(launch.content)).toContain("background");
    await manager.wait(job.id);
    const inspection = await dispatch('console.log(await jobs.inspect(' + JSON.stringify(job.id) + ', { limit: 5 }))');
    expect(inspection.isError).toBeFalsy();
    expect(JSON.stringify(inspection.content)).toContain("abcde");
    expect(JSON.stringify(inspection.content)).toContain("nextOffset");
    const page = await service.handle("jobs.inspect", { id: job.id, limit: 5 }, ctx, new AbortController().signal) as {
      status: string; output: string; nextOffset: number; hasMore: boolean;
    };
    expect(page).toMatchObject({ status: "completed", output: "abcde", hasMore: true, nextOffset: 5 });
    const bounded = await dispatch('console.log("x".repeat(2000))', 100);
    expect(bounded.isError).toBeFalsy();
    expect(JSON.stringify(bounded.content)).toContain("Output capture limit reached");
    await expect(dispatch('throw new Error("fixture runtime failure")')).rejects.toThrow("fixture runtime failure");
  } finally {
    await manager.shutdown();
    await rm(cwd, { recursive: true, force: true });
  }
});
