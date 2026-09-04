import { describe, expect, test } from "bun:test";
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
});
