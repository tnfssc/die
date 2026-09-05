import { test, expect } from "bun:test";
import * as z from "zod/mini";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { toolParameters } from "../src/tool-schema";
import extension from "../src/tasks/extension";
test("only execute is registered with a provider-friendly schema", () => {
  const tools: any[] = [];
  extension({
    registerTool: (t: any) => tools.push(t),
    registerCommand() {},
    registerMessageRenderer() {},
    on() {},
  } as any);
  expect(tools.map((t) => t.name)).toEqual(["execute"]);
  expect(tools[0].parameters).toMatchObject({
    type: "object",
    required: ["code"],
    properties: { code: { type: "string" }, timeoutSeconds: { minimum: 0.1 } },
  });
  expect(toolParameters(z.object({ choice: z.enum(["one", "two"]) }))).toMatchObject({
    properties: { choice: { enum: ["one", "two"] } },
  });
  expect(
    validateToolArguments(tools[0], {
      type: "toolCall",
      id: "t",
      name: "execute",
      arguments: { code: "console.log(1)", timeoutSeconds: "2" },
    }),
  ).toEqual({ code: "console.log(1)", timeoutSeconds: 2 });
  for (const args of [{}, { code: "ok", timeoutSeconds: 0 }])
    expect(() =>
      validateToolArguments(tools[0], { type: "toolCall", id: "t", name: "execute", arguments: args }),
    ).toThrow();
});
