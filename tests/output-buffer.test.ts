import { describe, expect, test } from "bun:test";
import { BoundedOutputBuffer } from "../src/tasks/output-buffer";

describe("bounded task output buffer", () => {
  test("retains only the configured tail without whole-buffer concatenation", () => {
    const output = new BoundedOutputBuffer(10);
    output.append("12345");
    output.append("67890");
    output.append("abcde");

    expect(output.retainedBytes).toBe(10);
    expect(output.baseOffset).toBe(5);
    expect(output.endOffset).toBe(15);
    const result = output.read(0, 20);
    expect(result.outputLost).toBe(true);
    expect(result.buffer.toString()).toBe("67890abcde");
  });

  test("supports cursor pagination across chunks", () => {
    const output = new BoundedOutputBuffer(100);
    output.append("abc");
    output.append("def");

    const first = output.read(0, 4);
    const second = output.read(first.nextOffset, 4);
    expect(first.buffer.toString()).toBe("abcd");
    expect(first.hasMore).toBe(true);
    expect(second.buffer.toString()).toBe("ef");
    expect(second.hasMore).toBe(false);
  });

  test("bounds metadata for pathological tiny writes", () => {
    const output = new BoundedOutputBuffer(1_000);
    for (let index = 0; index < 20_000; index++) output.append("x");

    expect(output.retainedBytes).toBe(1_000);
    expect(output.baseOffset).toBe(19_000);
    expect(output.read(output.baseOffset, 2_000).buffer.length).toBe(1_000);
  });

  test("copies only the retained tail of one oversized write", () => {
    const output = new BoundedOutputBuffer(4);
    output.append(Buffer.from("0123456789"));

    expect(output.retainedBytes).toBe(4);
    expect(output.baseOffset).toBe(6);
    expect(output.read(6, 4).buffer.toString()).toBe("6789");
  });
});
