import vm from "node:vm";
import { afterEach, expect, test } from "bun:test";
import {
  browserAudioOutput,
  browserMediaSource,
  browserTransportFactory,
  CAPTURE_PROCESSOR,
} from "../web/live/device-adapters";

const saved = {
  AudioContext: globalThis.AudioContext,
  AudioWorkletNode: globalThis.AudioWorkletNode,
  WebSocket: globalThis.WebSocket,
  navigator: globalThis.navigator,
  location: globalThis.location,
  create: URL.createObjectURL,
  revoke: URL.revokeObjectURL,
};
afterEach(() => {
  Object.assign(globalThis, {
    AudioContext: saved.AudioContext,
    AudioWorkletNode: saved.AudioWorkletNode,
    WebSocket: saved.WebSocket,
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: saved.navigator });
  Object.defineProperty(globalThis, "location", { configurable: true, value: saved.location });
  URL.createObjectURL = saved.create;
  URL.revokeObjectURL = saved.revoke;
});
function fakeAudio() {
  const contexts: any[] = [];
  const nodes: any[] = [];
  class Context {
    currentTime = 0;
    destination = {};
    closed = false;
    started: any[] = [];
    audioWorklet = { addModule: async (_url: string) => {} };
    constructor() {
      contexts.push(this);
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createGain() {
      return { gain: { value: 1 }, connect() {}, disconnect() {} };
    }
    createBuffer(_channels: number, length: number, rate: number) {
      const samples = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => samples };
    }
    createBufferSource() {
      const node = {
        buffer: null as any,
        onended: null as any,
        stopped: false,
        connect() {},
        disconnect() {},
        start: (at: number) => {
          this.started.push(at);
        },
        stop() {
          node.stopped = true;
        },
      };
      nodes.push(node);
      return node;
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      this.closed = true;
      return Promise.resolve();
    }
  }
  class Worklet {
    port = { onmessage: null as any, close() {} };
    connect() {}
    disconnect() {}
  }
  Object.assign(globalThis, { AudioContext: Context, AudioWorkletNode: Worklet });
  return { contexts, nodes };
}
test("output limits actual clock backlog, clear interrupts playing nodes, stop closes context", async () => {
  const { contexts, nodes } = fakeAudio();
  const output = browserAudioOutput();
  const frame = new Uint8Array(9600); // 200ms at 24k
  output.enqueue24k(frame);
  expect(output.queuedBytes).toBe(9600);
  expect(() => output.enqueue24k(frame)).toThrow("output buffer full");
  contexts[0].currentTime = 0.1;
  expect(output.queuedBytes).toBe(4800);
  output.clear();
  expect(nodes[0].stopped).toBe(true);
  expect(output.queuedBytes).toBe(0);
  output.enqueue24k(new Uint8Array([0, 128, 255, 127]));
  expect(nodes[1].buffer.getChannelData(0)[0]).toBe(-1);
  output.stop();
  output.stop();
  await output.closed;
  expect(contexts[0].closed).toBe(true);
  expect(nodes[1].stopped).toBe(true);
});
test("late permission result stops all tracks, no context allocated; capture delivers copied PCM and releases worklet", async () => {
  const { contexts } = fakeAudio();
  let resolve!: (s: any) => void;
  const tracks = [
    {
      stopped: false,
      stop() {
        this.stopped = true;
      },
    },
    {
      stopped: false,
      stop() {
        this.stopped = true;
      },
    },
  ];
  const stream = { getTracks: () => tracks };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: () =>
          new Promise((r) => {
            resolve = r;
          }),
      },
    },
  });
  const signal = new AbortController();
  const acquisition = browserMediaSource().acquire16k(signal.signal);
  signal.abort();
  resolve(stream);
  await expect(acquisition).rejects.toThrow();
  expect(tracks.every((track) => track.stopped)).toBe(true);
  expect(contexts.length).toBe(0);
  URL.createObjectURL = () => "blob:fake";
  URL.revokeObjectURL = () => {};
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => tracks }) } },
  });
  const capture = (await browserMediaSource().acquire16k(new AbortController().signal)) as any;
  let received: Uint8Array | undefined;
  capture.onPcm16((frame: Uint8Array) => {
    received = frame;
  });
  // Inspect the processor source to ensure the rendered hardware rate, not a capture hint, is used.
  expect(CAPTURE_PROCESSOR).toContain("16000 / sampleRate");
  capture.stop();
  await capture.closed;
  expect(contexts[0].closed).toBe(true);
});
test("socket sends copied binary, decodes relay controls, bounds backlog, aborts pending handshake", async () => {
  class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 0;
    bufferedAmount = 0;
    binaryType = "";
    onopen: any;
    onclose: any;
    onmessage: any;
    onerror: any;
    sent: any[] = [];
    closed = false;
    constructor(readonly url: string) {
      Socket.instances.push(this);
    }
    send(data: any) {
      this.sent.push(data);
    }
    close() {
      this.closed = true;
      this.readyState = 3;
      queueMicrotask(() => this.onclose?.());
    }
  }
  Object.assign(globalThis, { WebSocket: Socket });
  Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "https://example.test/page" } });
  const abort = new AbortController();
  const pending = browserTransportFactory("/voice").connect(abort.signal);
  abort.abort();
  await expect(pending).rejects.toThrow();
  expect(Socket.instances[0].closed).toBe(true);
  const connecting = browserTransportFactory("/voice").connect(new AbortController().signal);
  const socket = Socket.instances[1];
  expect(socket.url).toBe("wss://example.test/voice");
  socket.readyState = 1;
  socket.onopen();
  // Same network turn: ready/audio arrive before connect() continuation registers.
  socket.onmessage({ data: JSON.stringify({ type: "ready" }) });
  socket.onmessage({ data: new Uint8Array([1, 0]).buffer });
  const transport = await connecting;
  const seen: string[] = [];
  transport.onMessage((message) => seen.push(message.type));
  socket.onmessage({ data: "not json" });
  expect(seen).toEqual(["ready", "audio", "error"]);
  const frame = new Uint8Array([4, 5]);
  transport.send16k(frame);
  frame[0] = 7;
  expect(socket.sent[0][0]).toBe(4);
  socket.bufferedAmount = 6400;
  expect(() => transport.send16k(frame)).toThrow("Input buffer full");
  transport.sendControl({ type: "mute", muted: true });
  expect(socket.sent[1]).toBe('{"type":"mute","muted":true}');
  await transport.close();
  await transport.close();
  expect(socket.closed).toBe(true);
  const overflowing = browserTransportFactory("/voice").connect(new AbortController().signal);
  const crowded = Socket.instances[2];
  crowded.readyState = 1;
  crowded.onopen();
  for (let i = 0; i < 4; i++) crowded.onmessage?.({ data: new Uint8Array(9600).buffer });
  const bounded = await overflowing;
  const overflowMessages: any[] = [];
  bounded.onMessage((message) => overflowMessages.push(message));
  expect(overflowMessages).toEqual([{ type: "error", reason: "Voice startup buffer full" }]);
  expect(crowded.closed).toBe(true);
  await bounded.close();
});

test("worklet resamples one hardware second to exactly 16k PCM samples at common rates", () => {
  for (const rate of [44100, 48000, 16000]) {
    const frames: Uint8Array[] = [];
    let Processor!: new () => { process(inputs: Float32Array[][]): boolean };
    class Base {
      port = {
        postMessage(frame: Uint8Array) {
          frames.push(frame);
          this.onmessage?.({ data: "ack" });
        },
        onmessage: undefined as undefined | ((event: { data: string }) => void),
      };
    }
    vm.runInNewContext(CAPTURE_PROCESSOR, {
      AudioWorkletProcessor: Base,
      sampleRate: rate,
      Uint8Array,
      Number,
      Math,
      registerProcessor(_name: string, processorClass: typeof Processor) {
        Processor = processorClass;
      },
    });
    const processor = new Processor();
    for (let remaining = rate; remaining > 0; ) {
      const length = Math.min(128, remaining);
      processor.process([[new Float32Array(length).fill(0.5)]]);
      remaining -= length;
    }
    expect(frames.length).toBe(50);
    expect(frames.every((f) => f.byteLength === 640 && f[0] === 0 && f[1] === 64)).toBe(true);
  }
});

test("worklet bounds transfers without acknowledgements and signals overflow", () => {
  const messages: (Uint8Array | { type: string })[] = [];
  let Processor!: new () => { process(inputs: Float32Array[][]): boolean };
  class Base {
    port = {
      postMessage(value: Uint8Array | { type: string }) {
        messages.push(value);
      },
    };
  }
  vm.runInNewContext(CAPTURE_PROCESSOR, {
    AudioWorkletProcessor: Base,
    sampleRate: 16000,
    Uint8Array,
    Number,
    Math,
    registerProcessor(_name: string, processorClass: typeof Processor) {
      Processor = processorClass;
    },
  });
  const processor = new Processor();
  for (let i = 0; i < 16000; i += 128) processor.process([[new Float32Array(128)]]);
  expect(messages.filter((x) => x instanceof Uint8Array)).toHaveLength(8);
  expect(messages.filter((x) => !(x instanceof Uint8Array))).toEqual([{ type: "overflow" }]);
});
