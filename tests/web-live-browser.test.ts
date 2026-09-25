import { describe, expect, test } from "bun:test";
import { BrowserLiveController, type Capture, type Transport, type TransportMessage } from "../web/live/controller";
function deferred<T>() {
  let resolve!: (x: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function rig() {
  const mic = deferred<Capture>(),
    socket = deferred<Transport>();
  let frame: (x: Uint8Array) => void = () => {},
    message: (x: TransportMessage) => void = () => {};
  const calls = {
    tracks: 0,
    closes: 0,
    stops: 0,
    clears: 0,
    sent: [] as Uint8Array[],
    played: [] as Uint8Array[],
    inputQueued: 0,
    outputQueued: 0,
  };
  const capture: Capture = {
    onPcm16(cb) {
      frame = cb;
      return () => {
        frame = () => {};
      };
    },
    stop() {
      calls.tracks++;
    },
  };
  const transport: Transport = {
    get queuedBytes() {
      return calls.inputQueued;
    },
    onMessage(cb) {
      message = cb;
      return () => {
        message = () => {};
      };
    },
    sendControl() {},
    send16k(x) {
      calls.sent.push(x.slice());
    },
    close() {
      calls.closes++;
    },
  };
  const controller = new BrowserLiveController(
    { acquire16k: () => mic.promise },
    { connect: () => socket.promise },
    () => ({
      get queuedBytes() {
        return calls.outputQueued;
      },
      enqueue24k(x) {
        calls.played.push(x.slice());
      },
      clear() {
        calls.clears++;
      },
      stop() {
        calls.stops++;
      },
    }),
  );
  const tick = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const connect = async () => {
    const starting = controller.start();
    mic.resolve(capture);
    await tick();
    socket.resolve(transport);
    await starting;
  };
  return {
    mic,
    socket,
    capture,
    transport,
    calls,
    controller,
    tick,
    connect,
    frame: (x: Uint8Array) => frame(x),
    message: (x: TransportMessage) => message(x),
  };
}
const pcm = new Uint8Array([1, 0]);
describe("browser live lifecycle (offline)", () => {
  test("permission failure is visible; retry reaches ready; mute and interruption control frames", async () => {
    const r = rig();
    const states: string[] = [];
    r.controller.subscribe((x) => states.push(x.phase));
    const first = r.controller.start();
    r.mic.reject(new Error("permission denied"));
    await first;
    expect(r.controller.state).toEqual({ phase: "error", reason: "permission denied" });
    // A fresh rig tests successful path; the same controller retry is tested below with a sequential media source.
    const q = rig();
    await q.connect();
    expect(q.controller.state.phase).toBe("connecting");
    q.frame(pcm);
    expect(q.calls.sent).toHaveLength(0);
    q.message({ type: "ready" });
    q.frame(pcm);
    expect(q.calls.sent).toHaveLength(1);
    q.controller.setMuted(true);
    q.frame(pcm);
    expect(q.calls.sent).toHaveLength(1);
    q.message({ type: "audio", pcm16: pcm });
    expect(q.calls.played).toHaveLength(1);
    q.message({ type: "interrupted" });
    expect(q.calls.clears).toBe(1);
    expect(q.controller.state.phase).toBe("muted");
    q.controller.setMuted(false);
    q.frame(pcm);
    expect(q.calls.sent).toHaveLength(2);
    q.message({ type: "ready" });
    q.frame(pcm);
    expect(q.calls.sent).toHaveLength(3);
    q.controller.end();
    expect(states).toContain("requesting-mic");
  });
  test("end during mic acquisition stops late track without opening socket", async () => {
    const r = rig();
    const start = r.controller.start();
    r.controller.end();
    r.mic.resolve(r.capture);
    await start;
    expect(r.calls.tracks).toBe(1);
    expect(r.controller.state.phase).toBe("ended");
    expect(r.calls.closes).toBe(0);
  });
  test("end during socket connection closes late socket and all owned resources", async () => {
    const r = rig();
    const start = r.controller.start();
    r.mic.resolve(r.capture);
    await r.tick();
    r.controller.end();
    r.socket.resolve(r.transport);
    await start;
    expect(r.calls).toMatchObject({ tracks: 1, stops: 1, closes: 1 });
  });
  test("disconnect, queue overflow and malformed frames fail visibly and clean up", async () => {
    const r = rig();
    await r.connect();
    r.message({ type: "ready" });
    r.calls.inputQueued = 262144;
    r.frame(pcm);
    expect(r.controller.state).toEqual({ phase: "error", reason: "input queue full" });
    expect(r.calls).toMatchObject({ tracks: 1, stops: 1, closes: 1 });
    const q = rig();
    await q.connect();
    q.message({ type: "ready" });
    q.calls.outputQueued = 524288;
    q.message({ type: "audio", pcm16: pcm });
    expect(q.controller.state.reason).toBe("output buffer full");
    const x = rig();
    await x.connect();
    x.message({ type: "closed", reason: "offline" });
    expect(x.controller.state.reason).toBe("offline");
    x.controller.dispose();
    expect(x.calls.closes).toBe(1);
    const y = rig();
    await y.connect();
    y.message({ type: "ready" });
    y.frame(new Uint8Array(3));
    expect(y.controller.state.reason).toBe("invalid PCM16 frame");
  });
  test("retry on the same controller and dispose", async () => {
    let attempts = 0;
    const r = rig();
    const c = new BrowserLiveController(
      {
        acquire16k: async () => {
          if (!attempts++) throw new Error("denied");
          return r.capture;
        },
      },
      { connect: async () => r.transport },
      () => ({
        queuedBytes: 0,
        enqueue24k() {},
        clear() {},
        stop() {
          r.calls.stops++;
        },
      }),
    );
    await c.start();
    expect(c.state.phase).toBe("error");
    await c.start();
    expect(c.state.phase).toBe("connecting");
    c.dispose();
    expect(r.calls).toMatchObject({ tracks: 1, stops: 1, closes: 1 });
    expect(c.start()).rejects.toThrow("disposed");
  });
});

test("teardown failure is visible while other resources still release", async () => {
  const r = rig();
  await r.connect();
  r.capture.stop = () => {
    throw new Error("device stuck");
  };
  r.controller.end();
  expect(r.controller.state).toEqual({ phase: "error", reason: "resource cleanup failed" });
  expect(r.calls.stops).toBe(1);
  expect(r.calls.closes).toBe(1);
});

test("dispose aborts a pending transport handshake", async () => {
  let signal: AbortSignal | undefined;
  const r = rig();
  const c = new BrowserLiveController(
    {
      async acquire16k() {
        return r.capture;
      },
    },
    {
      connect(value) {
        signal = value;
        return r.socket.promise;
      },
    },
    () => ({ queuedBytes: 0, enqueue24k() {}, clear() {}, stop() {} }),
  );
  const starting = c.start();
  await r.tick();
  c.dispose();
  expect(signal?.aborted).toBe(true);
  r.socket.resolve(r.transport);
  await starting;
  expect(r.calls.tracks).toBe(1);
  expect(r.calls.closes).toBe(1);
});
