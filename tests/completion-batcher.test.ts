import { describe, expect, spyOn, test } from "bun:test";
import { CompletionBatcher } from "../src/tasks/completion-batcher";

describe("task completion batching", () => {
  test("coalesces a burst of 50 completions into one notification", async () => {
    const batches: number[][] = [];
    const batcher = new CompletionBatcher<number>((items) => batches.push(items), 20, 100);
    for (let index = 0; index < 50; index++) batcher.add(index);

    await Bun.sleep(40);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(50);
    expect(batches[0][0]).toBe(0);
    expect(batches[0][49]).toBe(49);
    batcher.dispose();
  });

  test("maximum wait prevents starvation under continuous completions", async () => {
    const batches: number[][] = [];
    const batcher = new CompletionBatcher<number>((items) => batches.push(items), 30, 60);
    for (let index = 0; index < 5; index++) {
      batcher.add(index);
      await Bun.sleep(20);
    }

    await Bun.sleep(50);
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches.flat()).toEqual([0, 1, 2, 3, 4]);
    batcher.dispose();
  });
  test("contains batch flush callback failures without retrying", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const batcher = new CompletionBatcher<number>(
      () => {
        calls++;
        throw new Error("notification failed");
      },
      10,
      50,
    );
    try {
      batcher.add(1);
      batcher.add(2);
      await Bun.sleep(30);

      expect(calls).toBe(1);
      expect(error).toHaveBeenCalledTimes(1);
      expect(() => batcher.flush()).not.toThrow();
    } finally {
      batcher.dispose();
      error.mockRestore();
    }
  });

  test("dispose prevents later additions from rearming timers", async () => {
    let calls = 0;
    const batcher = new CompletionBatcher<number>(() => calls++, 10, 20);
    batcher.dispose();
    batcher.add(1);

    await Bun.sleep(30);
    expect(calls).toBe(0);
  });
});
