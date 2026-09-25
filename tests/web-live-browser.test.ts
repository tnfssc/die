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
    await q.controller.end();
    expect(states).toContain("requesting-mic");
  });
  test("end during mic acquisition stops late track without opening socket", async () => {
    const r = rig();
    const start = r.controller.start();
    r.controller.end();
    r.mic.resolve(r.capture);
    await start;
    expect(r.calls.tracks).toBe(1);
    await r.controller.end();
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
    await r.controller.end();
    expect(r.calls).toMatchObject({ tracks: 1, stops: 1, closes: 1 });
  });
  test("disconnect, queue overflow and malformed frames fail visibly and clean up", async () => {
    const r = rig();
    await r.connect();
    r.message({ type: "ready" });
    r.calls.inputQueued = 262144;
    r.frame(pcm);
    expect(r.controller.state).toEqual({ phase: "error", reason: "input queue full" });
    await r.controller.end();
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
    await x.controller.dispose();
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
    await c.dispose();
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
  await expect(r.controller.end()).rejects.toThrow("resource cleanup failed");
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
  await c.dispose();
  expect(r.calls.closes).toBe(1);
});

test("failed resource release blocks restart until retry succeeds", async () => {
  const r = rig();
  await r.connect();
  let fail = true;
  r.transport.close = () => {
    if (fail) throw new Error("socket still open");
    r.calls.closes++;
  };
  await expect(r.controller.end()).rejects.toThrow("resource cleanup failed");
  expect(r.controller.state.phase).toBe("error");
  expect(r.controller.start()).rejects.toThrow("previous resources not released");
  fail = false;
  await r.controller.end();
  expect(r.controller.state.phase).toBe("ended");
  expect(r.calls.closes).toBe(1);
});

test("late acquisition release failure is reported and retried before next start", async () => {
  const r = rig();
  const pending = r.controller.start();
  r.controller.end();
  expect(r.controller.start()).rejects.toThrow("previous resources not released");
  let fail = true;
  r.capture.stop = () => {
    if (fail) throw new Error("track still live");
    r.calls.tracks++;
  };
  r.mic.resolve(r.capture);
  await pending;
  expect(r.controller.state).toEqual({ phase: "error", reason: "late resource cleanup failed" });
  expect(r.controller.start()).rejects.toThrow("previous resources not released");
  fail = false;
  await r.controller.end();
  expect(r.calls.tracks).toBe(1);
});

test("late socket close failure is visible and blocks a new capture", async () => {
  const r = rig();
  const pending = r.controller.start();
  r.mic.resolve(r.capture);
  await r.tick();
  r.controller.end();
  let fail = true;
  r.transport.close = () => {
    if (fail) throw new Error("socket live");
    r.calls.closes++;
  };
  r.socket.resolve(r.transport);
  await pending;
  expect(r.controller.state.reason).toBe("late resource cleanup failed");
  expect(r.controller.start()).rejects.toThrow("previous resources not released");
  fail = false;
  await r.controller.end();
  expect(r.calls.closes).toBe(1);
});


test("synchronous end from requesting-mic clears pending without acquiring", async () => {
  const r = rig();
  let once = true;
  let ending: Promise<void> | undefined;
  r.controller.subscribe((state) => {
    if (once && state.phase === "requesting-mic") {
      once = false;
      ending = r.controller.end();
    }
  });
  await r.controller.start();
  await ending;
  expect(r.controller.state.phase).toBe("ended");
  // A second attempt can enter acquisition (not rejected by a stuck pending flag).
  const again = r.controller.start();
  expect(r.controller.state.phase).toBe("requesting-mic");
  r.controller.end();
  r.mic.resolve(r.capture);
  await again;
  expect(r.calls.tracks).toBe(1);
});

test("dispose retries failed release but never permits another acquisition", async () => {
  const r = rig();
  await r.connect();
  let fails = true;
  r.transport.close = () => {
    if (fails) throw new Error("socket live");
    r.calls.closes++;
  };
  await expect(r.controller.dispose()).rejects.toThrow("resource cleanup failed");
  expect(r.controller.state.reason).toBe("resource cleanup failed");
  expect(r.controller.start()).rejects.toThrow("disposed");
  fails = false;
  await r.controller.end();
  expect(r.controller.state.phase).toBe("ended");
  expect(r.calls.closes).toBe(1);
  expect(r.controller.start()).rejects.toThrow("disposed");
});

test("late release failure after dispose remains retryable", async () => {
  const r = rig();
  const starting = r.controller.start();
  r.controller.dispose();
  let fails = true;
  r.capture.stop = () => {
    if (fails) throw new Error("track live");
    r.calls.tracks++;
  };
  r.mic.resolve(r.capture);
  await starting;
  expect(r.controller.state.reason).toBe("late resource cleanup failed");
  fails = false;
  await r.controller.end();
  expect(r.controller.state.phase).toBe("ended");
  expect(r.calls.tracks).toBe(1);
  expect(r.controller.start()).rejects.toThrow("disposed");
});

for (const registration of ["transport", "capture"] as const) {
  test(`synchronous end during ${registration} registration retains failed unsubscribe`, async () => {
    const r = rig();
    let fails = true, unsubscribed = 0;
    if (registration === "transport") {
      r.transport.onMessage = () => {
        r.controller.end();
        return () => {
          if (fails) throw new Error("listener live");
          unsubscribed++;
        };
      };
    } else {
      r.capture.onPcm16 = () => {
        r.controller.end();
        return () => {
          if (fails) throw new Error("listener live");
          unsubscribed++;
        };
      };
    }
    const starting = r.controller.start();
    r.mic.resolve(r.capture);
    await r.tick();
    r.socket.resolve(r.transport);
    await starting;
    expect(r.controller.state.reason).toBe("late resource cleanup failed");
    expect(r.controller.start()).rejects.toThrow("previous resources not released");
    fails = false;
    await r.controller.end();
    expect(r.controller.state.phase).toBe("ended");
    expect(unsubscribed).toBe(1);
  });
}


test("synchronous dispose from requesting-mic does not acquire or leave pending", async () => {
  const r = rig();
  let disposing: Promise<void> | undefined;
  r.controller.subscribe((state) => {
    if (state.phase === "requesting-mic") disposing = r.controller.dispose();
  });
  await r.controller.start();
  await disposing;
  expect(r.controller.state.phase).toBe("ended");
  expect(r.controller.start()).rejects.toThrow("disposed");
});

test("dispose during registration retains a late failed unsubscribe for end retry", async () => {
  const r = rig();
  let fails = true, releases = 0;
  r.transport.onMessage = () => {
    r.controller.dispose();
    return () => {
      if (fails) throw new Error("listener live");
      releases++;
    };
  };
  const starting = r.controller.start();
  r.mic.resolve(r.capture);
  await r.tick();
  r.socket.resolve(r.transport);
  await starting;
  expect(r.controller.state.reason).toBe("late resource cleanup failed");
  fails = false;
  await r.controller.end();
  expect(r.controller.state.phase).toBe("ended");
  expect(releases).toBe(1);
  expect(r.controller.start()).rejects.toThrow("disposed");
});


test("end waits for asynchronous capture, audio and socket teardown", async () => {
  const r = rig();
  const capture = deferred<void>(), audio = deferred<void>(), socket = deferred<void>();
  r.capture.stop = () => capture.promise;
  r.transport.close = () => socket.promise;
  // A separate controller verifies all three asynchronous resources, including output.
  const c = new BrowserLiveController(
    { acquire16k: async () => r.capture },
    { connect: async () => r.transport },
    () => ({ queuedBytes: 0, enqueue24k() {}, clear() {}, stop: () => audio.promise }),
  );
  await c.start();
  let settled = false;
  const ending = c.end().then(() => { settled = true; });
  await r.tick();
  expect(settled).toBe(false);
  capture.resolve();
  await r.tick();
  expect(settled).toBe(false);
  audio.resolve();
  await r.tick();
  expect(settled).toBe(false);
  socket.resolve();
  await ending;
  expect(c.state.phase).toBe("ended");
});

test("capture overflow during connecting fails visibly and releases capture", async () => {
  const r = rig();
  let error: ((e: Error) => void) | undefined;
  r.capture.onError = (cb) => { error = cb; return () => { error = undefined; }; };
  const pending = r.controller.start();
  r.mic.resolve(r.capture);
  await r.tick();
  error?.(new Error("capture worklet queue overflow"));
  r.socket.resolve(r.transport);
  await pending;
  await r.controller.end();
  expect(r.calls.tracks).toBe(1);
  expect(r.calls.closes).toBe(1);
});


test("immediate start/end and dispose prevent acquisition before startup resumes", async () => {
  for (const stop of ["end", "dispose"] as const) {
    const r = rig();
    const starting = r.controller.start();
    const ending = r.controller[stop]();
    r.mic.resolve(r.capture);
    await Promise.all([starting, ending]);
    expect(r.calls.tracks).toBe(1);
    expect(r.calls.closes).toBe(0);
    expect(r.controller.state.phase).toBe("ended");
  }
});

test("end/dispose during deferred failed-release retry cannot start a new mic", async () => {
  for (const stop of ["end", "dispose"] as const) {
    const r = rig();
    await r.connect();
    r.capture.stop = () => { throw new Error("track busy"); };
    await expect(r.controller.end()).rejects.toThrow("resource cleanup failed");
    const retry = deferred<void>();
    r.capture.stop = () => retry.promise;
    const starting = r.controller.start();
    const ending = r.controller[stop]();
    retry.resolve();
    await Promise.all([starting, ending]);
    expect(r.controller.state.phase).toBe("ended");
    expect(r.calls.tracks).toBe(0); // replaced stop did not increment fixture's counter
    expect(r.calls.closes).toBe(1);
    if (stop === "dispose") await expect(r.controller.start()).rejects.toThrow("disposed");
  }
});

test("concurrent end/dispose callers wait for the same asynchronous teardown", async () => {
  const r = rig();
  await r.connect();
  const gate = deferred<void>();
  r.capture.stop = () => gate.promise;
  const first = r.controller.end();
  const second = r.controller.end();
  const disposed = r.controller.dispose();
  expect(second).toBe(first);
  expect(disposed).toBe(first);
  let done = false;
  void Promise.all([first, second, disposed]).then(() => { done = true; });
  await r.tick();
  expect(done).toBe(false);
  gate.resolve();
  await Promise.all([first, second, disposed]);
  expect(r.controller.state.phase).toBe("ended");
});

test("async teardown failures reject every concurrent waiter and remain retryable", async () => {
  const r = rig();
  await r.connect();
  const gate = deferred<void>();
  let failing = true;
  r.transport.close = async () => {
    await gate.promise;
    if (failing) throw new Error("socket busy");
    r.calls.closes++;
  };
  const first = r.controller.end();
  const second = r.controller.dispose();
  gate.resolve();
  const results = await Promise.allSettled([first, second]);
  expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(r.controller.state.phase).toBe("error");
  failing = false;
  await r.controller.dispose();
  expect(r.controller.state.phase).toBe("ended");
  expect(r.calls.closes).toBe(1);
});

test("late asynchronous stop failure rejects awaited end, then retries", async () => {
  const r = rig();
  const starting = r.controller.start();
  const ending = r.controller.end();
  const gate = deferred<void>();
  let failing = true;
  r.capture.stop = async () => {
    await gate.promise;
    if (failing) throw new Error("track busy");
    r.calls.tracks++;
  };
  r.mic.resolve(r.capture);
  gate.resolve();
  await starting;
  await expect(ending).rejects.toThrow("resource cleanup failed");
  expect(r.controller.state.phase).toBe("error");
  failing = false;
  await r.controller.end();
  expect(r.calls.tracks).toBe(1);
});
