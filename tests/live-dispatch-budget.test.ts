import { expect, test } from "bun:test";
import { installLiveDispatchBudget } from "./live-dispatch-budget";

test("live dispatch budget blocks the fifth provider call and distinguishes runtime invocations", () => {
  const reachedProvider: Array<Record<string, unknown>> = [];
  const provider = {
    streamSimple(_model: unknown, _context: unknown, options?: Record<string, unknown>) {
      reachedProvider.push(options ?? {});
      return Symbol("offline-stream");
    },
  };
  const runtime = {
    getProvider(id: string) {
      return id === "offline" ? provider : undefined;
    },
    streamSimple(model: { provider: string }, context: unknown, options?: Record<string, unknown>) {
      if (options?.failPreparation) throw new Error("offline preparation rejection");
      return this.getProvider(model.provider)!.streamSimple(model, context, options);
    },
  };
  const evidence: unknown[] = [];
  const budget = installLiveDispatchBudget(runtime, "offline", 4, (item) => evidence.push(item));
  const model = { provider: "offline", id: "fixture", api: "fixture-api" };

  expect(() => runtime.streamSimple(model, {}, { failPreparation: true })).toThrow("preparation rejection");
  for (let request = 0; request < 4; request++) {
    runtime.streamSimple(model, {}, { transport: "sse", maxRetries: 99 });
  }
  expect(() => runtime.streamSimple(model, {}, { transport: "sse" })).toThrow("request dispatch limit");

  expect(budget).toMatchObject({ invocations: 6, dispatches: 4 });
  expect(reachedProvider).toHaveLength(4);
  expect(evidence).toHaveLength(4);
  expect(evidence.every((item) => (item as { transport: unknown }).transport === "sse")).toBe(true);
  expect(reachedProvider.every((options) => options.transport === "sse")).toBe(true);
  expect(reachedProvider.every((options) => options.maxRetries === 0)).toBe(true);
});
