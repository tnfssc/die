import { expect, test } from "bun:test";
import { OpenAIRealtimeSession, type RealtimeSocket } from "../src/live/openai-session";

class Socket implements RealtimeSocket {
  readyState = 1;
  private listeners = new Map<string, ((event: any) => void)[]>();
  send(_data: string) {}
  close() { this.readyState = 3; }
  addEventListener(type: "open" | "message" | "error" | "close", handler: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }
  fire(type: string, data: unknown = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(type === "message" ? { data: JSON.stringify(data) } : {});
  }
}
async function rejection(error: unknown): Promise<string> {
  const socket = new Socket();
  const messages: string[] = [];
  const session = new OpenAIRealtimeSession({ onError: (e) => messages.push(e.message) }, () => socket);
  const pending = session.connect("private-key");
  socket.fire("open");
  socket.fire("message", { type: "error", error });
  await pending;
  expect(session.state).toBe("closed");
  expect(messages).toHaveLength(1);
  return messages[0];
}
test("session rejection names safe code, type and structural field including indexed tools", async () => {
  expect(await rejection({ code: "invalid_value", type: "invalid_request_error", param: "session.audio.output.format.rate", message: "private-key" }))
    .toBe("OpenAI rejected voice session setup (details withheld) (code invalid_value, type invalid_request_error, field session.audio.output.format.rate)");
  expect(await rejection({ code: "unknown_parameter", param: "session.tools[12].parameters.required" }))
    .toContain("field session.tools[12].parameters.required");
  expect(await rejection({ code: "invalid_type", param: "tools[0].name" })).toContain("field tools[0].name");
});
test("untrusted tokens, fields, message and metadata never surface", async () => {
  const secret = "private-key prompt https://example.test/key?token=secret Authorization";
  for (const error of [
    { code: secret, type: secret, param: secret, message: secret, headers: secret },
    { code: "invalid_value_" + secret, type: "invalid_request_error", param: "session.tools[0].parameters.properties." + secret, message: secret },
    { code: "unknown_parameter", param: "session.audio.output.format.rate[0]." + secret, message: secret },
    { code: "unknown_parameter", param: "tools[9999].name", message: secret },
    { code: "invalid_value", param: "session.instructions." + secret, message: secret },
  ]) {
    const output = await rejection(error);
    expect(output).not.toContain(secret);
    expect(output).not.toContain("tools[9999]");
    expect(output).not.toContain("properties.");
    expect(output).not.toContain("rate[0]");
    expect(output.length).toBeLessThan(220);
  }
  expect(await rejection({ message: secret })).toBe("OpenAI rejected voice session setup (details withheld)");
});
test("friendly quota diagnosis is preserved without raw provider text", async () => {
  const output = await rejection({ code: "insufficient_quota", message: "private-key" });
  expect(output).toContain("Check API billing and limits");
  expect(output).not.toContain("private-key");
});
