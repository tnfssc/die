import { expect, test } from "bun:test";
import { createWebLiveRelay, type WebRelayTransport } from "../src/live/web-relay";
import type { SessionOperations } from "../src/session/operations";
import type { VoiceCallbacks, VoiceOrchestration, VoiceProvider, VoiceState } from "../src/live/types";

function harness() {
  const sent: (string | Uint8Array)[] = [];
  let message: (data: unknown) => void = () => {};
  let disconnect: () => void = () => {};
  let hostUpdate: (value: any) => void = () => {};
  let unsubscribed = 0;
  let socketClosed = 0;
  let providerClosed = 0;
  let buffer = 0;
  let state: VoiceState = "idle";
  let callbacks!: VoiceCallbacks;
  let orchestration!: VoiceOrchestration;
  let connectedKey = "";
  const input: string[] = [];
  const contexts: string[] = [];
  let connect: () => Promise<void> = async () => {
    state = "ready";
  };
  const host: SessionOperations = {
    context: () => ({ secret: "host observation" }),
    subscribe: (fn) => {
      hostUpdate = fn;
      return () => {
        unsubscribed++;
      };
    },
    send: async () => "sent",
    steer: async () => "steered",
    list: async () => [],
    inspect: async () => null,
    stop: async () => {
      throw new Error("speech must not stop jobs");
    },
  };
  const transport: WebRelayTransport = {
    get bufferedAmount() {
      return buffer;
    },
    send(data) {
      sent.push(data);
    },
    onMessage(fn) {
      message = fn;
      return () => {
        message = () => {};
      };
    },
    onClose(fn) {
      disconnect = fn;
      return () => {
        disconnect = () => {};
      };
    },
    close() {
      socketClosed++;
    },
  };
  const relay = createWebLiveRelay({
    host,
    transport,
    connectDeadlineMs: 20,
    sessionDeadlineMs: 30,
    apiKey: "SERVER_SECRET",
    providerFactory(cb, orch) {
      callbacks = cb;
      orchestration = orch;
      return {
        get state() {
          return state;
        },
        generation: 0,
        turn: 0,
        async connect(key) {
          connectedKey = key;
          await connect();
        },
        sendAudio(value) {
          input.push(value);
        },
        endAudio() {},
        sendContext(value) {
          contexts.push(value);
        },
        close() {
          providerClosed++;
          state = "closed";
        },
      } satisfies VoiceProvider;
    },
  });
  return {
    relay,
    sent,
    input,
    contexts,
    host,
    transport,
    get callbacks() {
      return callbacks;
    },
    get orchestration() {
      return orchestration;
    },
    get connectedKey() {
      return connectedKey;
    },
    get cleaned() {
      return [unsubscribed, providerClosed, socketClosed];
    },
    receive(value: unknown) {
      message(value);
    },
    disconnect() {
      disconnect();
    },
    update(value: any) {
      hostUpdate(value);
    },
    setBuffer(value: number) {
      buffer = value;
    },
    setConnect(fn: () => Promise<void>) {
      connect = fn;
    },
    setState(value: VoiceState) {
      state = value;
    },
  };
}
const controls = (sent: (string | Uint8Array)[]) =>
  sent.filter((x): x is string => typeof x === "string").map((value) => JSON.parse(value));

test("ready only after provider ready and initial bounded context; binary adaptation and mute", async () => {
  const h = harness();
  await h.relay.start();
  expect(h.connectedKey).toBe("SERVER_SECRET");
  expect(controls(h.sent)).toEqual([{ type: "ready" }]);
  expect(h.contexts[0]).toContain("Host observation");
  h.update({ type: "assistant", text: "update" });
  expect(h.contexts[1]).toContain("update");
  h.receive(new Uint8Array([1, 2]));
  expect(h.input).toEqual(["AQI="]);
  h.receive(JSON.stringify({ type: "mute", muted: true }));
  h.receive(new Uint8Array([3, 4]));
  expect(h.input).toHaveLength(1);
  h.receive(JSON.stringify({ type: "mute", muted: false }));
  h.receive(new ArrayBuffer(3200));
  expect(h.input).toHaveLength(2);
  expect(Buffer.from(h.input[1], "base64")).toHaveLength(3200);
  expect(h.sent.join(" ")).not.toContain("SERVER_SECRET");
  h.receive('{"type":"end"}');
  expect(controls(h.sent).at(-1)).toEqual({ type: "closed" });
  expect(h.cleaned).toEqual([1, 1, 1]);
  h.relay.close();
  expect(h.cleaned).toEqual([1, 1, 1]);
  expect(h.relay.start()).rejects.toThrow("single-use");
});

test("reject audio before ready; late connection cannot revive relay", async () => {
  const h = harness();
  let resolve!: () => void;
  h.setConnect(
    () =>
      new Promise<void>((r) => {
        resolve = () => {
          h.setState("ready");
          r();
        };
      }),
  );
  const pending = h.relay.start();
  h.receive(new Uint8Array([1, 2]));
  expect(controls(h.sent)).toEqual([{ type: "error", code: "not_ready" }, { type: "closed" }]);
  resolve();
  await pending;
  expect(h.cleaned).toEqual([0, 1, 1]);
  expect(controls(h.sent)).not.toContainEqual({ type: "ready" });
});

test("interrupt flush epoch, bounded output, stale audio ignored; disconnect cleans without stopping jobs", async () => {
  const h = harness();
  await h.relay.start();
  h.callbacks.onAudio?.(Buffer.alloc(20_000).toString("base64"), 0);
  expect(h.sent.filter((x) => x instanceof Uint8Array).map((x) => x.byteLength)).toEqual([9600, 9600, 800]);
  h.callbacks.onInterrupted?.(1);
  h.callbacks.onAudio?.(Buffer.alloc(2).toString("base64"), 0);
  expect(controls(h.sent).at(-1)).toEqual({ type: "interrupted", epoch: 1 });
  h.callbacks.onAudio?.(Buffer.alloc(2).toString("base64"), 1);
  expect(h.sent.at(-1)).toEqual(Buffer.alloc(2));
  h.disconnect();
  expect(h.cleaned).toEqual([1, 1, 1]);
});

test("invalid input, backpressure and provider failures use sanitized errors and cleanup", async () => {
  for (const bad of [new Uint8Array(3202), new Uint8Array(3), '{"type":"end","extra":1}', "garbage"]) {
    const h = harness();
    await h.relay.start();
    h.receive(bad);
    expect(controls(h.sent).at(-2)).toEqual({ type: "error", code: "invalid_input" });
    expect(h.cleaned).toEqual([1, 1, 1]);
  }
  const h = harness();
  await h.relay.start();
  h.setBuffer(256_000);
  h.callbacks.onAudio?.(Buffer.alloc(2).toString("base64"), 0);
  expect(h.cleaned).toEqual([1, 1, 1]);
  const p = harness();
  await p.relay.start();
  p.callbacks.onError?.({ code: "transport_error", message: "SERVER_SECRET provider stack trace" });
  expect(controls(p.sent)).toEqual([{ type: "ready" }, { type: "error", code: "provider_error" }, { type: "closed" }]);
});

test("inert until provider actually reports ready, and authority comes only from injected host", async () => {
  const h = harness();
  h.setConnect(async () => {});
  await h.relay.start();
  expect(controls(h.sent)).toEqual([{ type: "error", code: "provider_error" }, { type: "closed" }]);
  const ok = harness();
  await ok.relay.start();
  ok.callbacks.onInputTranscript?.({ text: "hello", finished: true });
  expect(await ok.orchestration.execute({ name: "agent_send", args: { requestId: "r1" } })).toBe("sent");
  ok.relay.close();
});

test("connection and session deadlines close once; no ready on timed-out connection", async () => {
  const h = harness();
  let resolve!: () => void;
  h.setConnect(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const pending = h.relay.start();
  await new Promise((r) => setTimeout(r, 40));
  expect(controls(h.sent)).toEqual([{ type: "error", code: "timeout" }, { type: "closed" }]);
  resolve();
  await pending;
  expect(h.cleaned).toEqual([0, 1, 1]);
  const ready = harness();
  await ready.relay.start();
  await new Promise((r) => setTimeout(r, 50));
  expect(controls(ready.sent).at(-2)).toEqual({ type: "error", code: "timeout" });
  expect(ready.cleaned).toEqual([1, 1, 1]);
});
