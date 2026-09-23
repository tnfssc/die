import { expect, test } from "bun:test";
import { testLiveConnection } from "../src/live/connection-test";
import { LiveTransport, type LiveCallbacks, type LiveSocket } from "../src/live/transport";

function fixture() {
  let callbacks!: LiveCallbacks;
  let connects = 0,
    closes = 0;
  const transport = (cb: LiveCallbacks) => {
    callbacks = cb;
    return {
      connect: () => {
        connects++;
      },
      close: () => {
        closes++;
      },
    };
  };
  return {
    transport,
    ready: () => callbacks.ready(),
    fail: () => callbacks.closed("SECRET"),
    counts: () => ({ connects, closes }),
  };
}
test("setup success closes once without any audio/agent dependencies", async () => {
  const f = fixture();
  const p = testLiveConnection("FAKE", { transport: f.transport });
  f.ready();
  f.fail();
  await p;
  expect(f.counts()).toEqual({ connects: 1, closes: 1 });
});
test("failure is opaque and cleans transport", async () => {
  const f = fixture();
  const p = testLiveConnection("FAKE", { transport: f.transport });
  f.fail();
  await expect(p).rejects.toThrow("Live connection test did not complete");
  expect(f.counts().closes).toBe(1);
});
test("abort before and during handshake closes safely", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(testLiveConnection("FAKE", { transport: f.transport, signal: controller.signal })).rejects.toThrow();
  expect(f.counts().connects).toBe(0);
  const second = new AbortController();
  const p = testLiveConnection("FAKE", { transport: f.transport, signal: second.signal });
  second.abort();
  f.ready();
  await expect(p).rejects.toThrow();
  expect(f.counts().closes).toBe(1);
});
test("timeout and synchronous failure are bounded and sanitized", async () => {
  const f = fixture();
  await expect(testLiveConnection("FAKE", { transport: f.transport, timeoutMs: 1 })).rejects.toThrow();
  expect(f.counts().closes).toBe(1);
  await expect(
    testLiveConnection("FAKE", {
      transport: () => {
        throw new Error("SECRET");
      },
    }),
  ).rejects.toThrow("Live connection test did not complete");
});
test("real adapter fake wire sends exactly setup and closes after setupComplete", async () => {
  const sent: unknown[] = [];
  let closes = 0;
  const socket: LiveSocket = {
    bufferedAmount: 0,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: (data) => sent.push(JSON.parse(data)),
    close: () => {
      closes++;
    },
  };
  const p = testLiveConnection("FAKE", { transport: (cb) => new LiveTransport(cb, () => socket) });
  socket.onopen?.(new Event("open"));
  socket.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ setupComplete: {} }) }));
  await p;
  expect(sent).toHaveLength(1);
  expect(Object.keys(sent[0] as object)).toEqual(["setup"]);
  expect(closes).toBe(1);
  expect(socket.onmessage).toBeNull();
});
