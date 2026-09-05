import { expect, test } from "bun:test";
import { installLiveDispatchBudget } from "./live-dispatch-budget";

test("live dispatch budget blocks the fifth call before the provider stream", () => {
  const reachedProvider: Array<Record<string, unknown>> = [];
  const runtime = {
    streamSimple(_model: unknown, _context: unknown, options?: Record<string, unknown>) {
      reachedProvider.push(options ?? {});
      return Symbol("offline-stream");
    },
  };
  const evidence: unknown[] = [];
  const budget = installLiveDispatchBudget(runtime, 4, item => evidence.push(item));
  const model = { provider: "offline", id: "fixture", api: "fixture-api" };

  for (let request = 0; request < 4; request++) {
    runtime.streamSimple(model, {}, { transport: "sse", maxRetries: 99 });
  }
  expect(() => runtime.streamSimple(model, {}, { transport: "sse" })).toThrow(
    "request dispatch limit",
  );

  expect(budget).toMatchObject({ attempts: 5, dispatches: 4 });
  expect(reachedProvider).toHaveLength(4);
  expect(evidence).toHaveLength(4);
  expect(reachedProvider.every(options => options.transport === "sse")).toBe(true);
  expect(reachedProvider.every(options => options.maxRetries === 0)).toBe(true);
});
