import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { voiceToolResult } from "../src/live/tool-result";

test("small results retain structured content and errors", async () => {
  const value = { content: [{ type: "text", text: "ok" }], isError: true };
  expect(await voiceToolResult(value)).toEqual({ output: value });
});

test("large and image-bearing results have a bounded wire preview and complete readable artifact", async () => {
  const value = { content: [{ type: "image", data: "a".repeat(200_000), mimeType: "image/png" }] };
  const mapped = await voiceToolResult(value);
  expect(mapped.truncated).toBe(true);
  expect((mapped.preview as string).length).toBeLessThanOrEqual(8192);
  expect(JSON.parse(await readFile(mapped.artifactPath as string, "utf8"))).toEqual({ output: value });
});

test("unserializable tool results report failure instead of fabricating success", async () => {
  const cyclic: any = {};
  cyclic.self = cyclic;
  expect(await voiceToolResult(cyclic)).toEqual({ error: "Tool result could not be serialized" });
});

test("small image still identifies visual modality loss and retains data in artifact", async () => {
  const value = { content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }] };
  const mapped = await voiceToolResult(value);
  expect(mapped.imageNotVisuallyRendered).toBe(true);
  expect(mapped.truncated).toBe(false);
  expect(JSON.parse(await readFile(mapped.artifactPath as string, "utf8"))).toEqual({ output: value });
});
