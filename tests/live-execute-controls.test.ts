import { expect, test } from "bun:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { registerLiveStop } from "../src/live/lifecycle-access";
import { registerExecuteTool } from "../src/typescript/extension";
import { requestForegroundStop } from "../src/tasks/foreground-stop";

const binary = resolve(import.meta.dir, "../dist/die");
function fixture(handler: (ctx: any, method: string, params: any, signal: AbortSignal) => Promise<unknown>) {
  let tool: any;
  const bus = createEventBus();
  const pi = {
    events: bus,
    on() {},
    registerTool(value: any) {
      tool = value;
    },
  } as any;
  const control = registerExecuteTool(pi, handler, binary);
  const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "owned", getLeafId: () => "leaf" } } as any;
  return {
    pi,
    control,
    ctx,
    run: (code: string) =>
      tool.execute("control-call", { code, timeoutSeconds: 5 }, new AbortController().signal, () => {}, ctx),
  };
}
test("execute live.stop uses the actual scoped host route, and does not route to jobs", async () => {
  const f = fixture(async () => {
    throw Error("must not call JobService");
  });
  let calls = 0;
  registerLiveStop(f.pi, async (ctx) => {
    expect(ctx).toBe(f.ctx);
    calls++;
    return { stopped: true, errors: [], jobsUnchanged: true };
  });
  const result = await f.run("console.log(JSON.stringify(await live.stop()))");
  expect(result.details.exitCode).toBe(0);
  expect(JSON.parse(result.details.stdout)).toEqual({ stopped: true, errors: [], jobsUnchanged: true });
  expect(calls).toBe(1);
});
test("stopWork helper response is acknowledged before scoped foreground cancellation", async () => {
  const seen: unknown[] = [];
  let aborts = 0;
  const f = fixture(async (_ctx, method, params, signal) => {
    expect(method).toBe("jobs.stopWork");
    expect(params).toEqual({});
    const foreground = requestForegroundStop(
      {
        ...f.ctx,
        isIdle: () => false,
        abort: () => {
          aborts++;
          f.control.stopForeground(f.ctx);
        },
      },
      signal,
      (result) => seen.push(result),
    );
    expect(aborts).toBe(0);
    return { jobs: [{ id: "fake-child", outcome: "pending" }], foreground, outcome: "pending" };
  });
  await expect(f.run("await jobs.stopWork(); await new Promise(() => {});")).rejects.toThrow("Execution cancelled");
  expect(aborts).toBe(1);
  expect(seen).toEqual([{ outcome: "pending" }]);
});
