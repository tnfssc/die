import { expect, test } from "bun:test";
import { stream } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { getModel } from "@earendil-works/pi-ai/compat";
import { executeReference, workingValues } from "../src/prompts";

const sentinel = "provider-prompt-serialization-sentinel";

function dummyCodexJwt(): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "test-account",
      },
    }),
    "signature",
  ].join(".");
}

test("Codex serializes the complete system prompt as instructions without a network request", async () => {
  const model = getModel("openai-codex", "gpt-5.6-luna");
  expect(model).toBeDefined();

  const systemPrompt = [
    "provider-prompt-serialization-marker",
    ...workingValues,
    ...executeReference,
  ].join("\n\n");
  let captured: { instructions?: unknown; tool_choice?: unknown } | undefined;
  let networkCalls = 0;

  const events = [];
  for await (const event of stream(
    model!,
    {
      systemPrompt,
      messages: [{ role: "user", content: "Serialize this request, but do not send it.", timestamp: 0 }],
    },
    {
      apiKey: dummyCodexJwt(),
      transport: "sse",
      fetch: (async () => {
        networkCalls++;
        throw new Error("network must not be used");
      }) as unknown as typeof fetch,
      onPayload(payload) {
        const body = payload as { instructions?: unknown; tool_choice?: unknown };
        captured = { instructions: body.instructions, tool_choice: body.tool_choice };
        throw new Error(sentinel);
      },
    },
  )) {
    events.push(event);
  }

  expect(captured?.instructions).toBe(systemPrompt);
  expect(captured?.tool_choice).toBe("auto");
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe("error");
  if (events[0].type === "error") {
    expect(events[0].reason).toBe("error");
    expect(events[0].error.errorMessage).toContain(sentinel);
  }
  expect(networkCalls).toBe(0);
});
