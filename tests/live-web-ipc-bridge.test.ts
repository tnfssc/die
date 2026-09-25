import { test, expect } from "bun:test";
import { EventEmitter } from "node:events";
import { attachWebVoiceIpc } from "../src/live/web-ipc-bridge";

class Channel extends EventEmitter {
  output: Buffer[] = [];
  writableLength = 0;
  destroyed = false;
  write(frame: Uint8Array) {
    this.output.push(Buffer.from(frame));
    return true;
  }
  destroy() {
    this.destroyed = true;
    this.emit("close");
    return this;
  }
  send(value: object | Uint8Array) {
    const kind = value instanceof Uint8Array ? 1 : 0;
    const payload = kind ? (value as Uint8Array) : Buffer.from(JSON.stringify(value));
    const header = Buffer.alloc(5);
    header[0] = kind;
    header.writeUInt32BE(payload.length, 1);
    this.emit("data", Buffer.concat([header, payload]));
  }
  controls() {
    return this.output.filter((frame) => frame[0] === 0).map((frame) => JSON.parse(frame.subarray(5).toString()));
  }
}
const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};
function setup() {
  const channel = new Channel();
  let revoked = 0,
    connected = 0,
    disconnected = 0,
    jobsStopped = 0,
    host: any;
  const fakeHost = () => ({
    lease: () => {
      const lease = {
        revoke: () => {
          revoked++;
        },
        valid: () => true,
        onRevoke: () => () => {},
        context: () => ({ source: "test", activeJobs: [] }),
        subscribe: () => () => {},
        send: async () => ({ queued: true }),
        steer: async () => ({ queued: true }),
        stop: async () => {
          jobsStopped++;
          return { stopped: true };
        },
        list: async () => [],
        inspect: async () => null,
      };
      return lease;
    },
  });
  host = fakeHost();
  const bridge = attachWebVoiceIpc({
    channel: channel as any,
    host: () => host,
    key: async () => "fake-key",
    factory: () => (callbacks: any) =>
      ({
        state: "idle",
        generation: 0,
        async connect(key: string) {
          expect(key).toBe("fake-key");
          connected++;
          this.state = "ready";
        },
        sendContext() {},
        sendAudio() {},
        close() {
          disconnected++;
          this.state = "closed";
        },
      }) as any,
  });
  return {
    channel,
    bridge,
    clearHost: () => {
      host = undefined;
    },
    counters: () => ({ revoked, connected, disconnected, jobsStopped }),
  };
}
for (const provider of ["gemini", "openai"] as const) {
  test(provider + " starts only with owning host, revokes on replacement/end, leaves jobs intact", async () => {
    const s = setup();
    expect(s.channel.controls()[0]).toEqual({ type: "ready", protocol: 1 });
    s.channel.send({ type: "start", provider });
    await tick();
    expect(s.channel.controls()).toContainEqual({ type: "status", state: "ready" });
    expect(s.counters().connected).toBe(1);
    s.channel.send({ type: "start", provider });
    await tick();
    expect(s.counters().revoked).toBeGreaterThanOrEqual(1);
    s.channel.send({ type: "stop" });
    await tick();
    expect(s.counters().disconnected).toBe(2);
    expect(s.counters().jobsStopped).toBe(0);
    s.clearHost();
    s.channel.send({ type: "start", provider });
    await tick();
    expect(s.channel.controls()).toContainEqual({ type: "error", code: "no_owner" });
    s.bridge.close();
  });
}
test("malformed and oversized frames fail closed before provider start", () => {
  const s = setup();
  const bad = Buffer.alloc(5);
  bad[0] = 1;
  bad.writeUInt32BE(65537, 1);
  s.channel.emit("data", bad);
  expect(s.channel.destroyed).toBe(true);
  expect(s.counters().connected).toBe(0);
});

test("stop while credential resolution pending denies stale owner/provider", async () => {
  const channel = new Channel();
  let release!: (key: string) => void;
  let starts = 0,
    revoked = 0;
  const bridge = attachWebVoiceIpc({
    channel: channel as any,
    host: () => ({ lease: () => ({ revoke: () => revoked++ }) }) as any,
    key: async () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
    factory: () => () => {
      starts++;
      return {} as any;
    },
  });
  channel.send({ type: "start", provider: "gemini" });
  await tick();
  channel.send({ type: "stop" });
  release("fake-key");
  await tick();
  expect(starts).toBe(0);
  expect(revoked).toBe(1);
  bridge.close();
});
test("disconnect revokes the owning voice, but not coding jobs", async () => {
  const s = setup();
  s.channel.send({ type: "start", provider: "openai" });
  await tick();
  s.channel.emit("close");
  await tick();
  expect(s.counters().revoked).toBe(1);
  expect(s.counters().disconnected).toBe(1);
  expect(s.counters().jobsStopped).toBe(0);
});

test("stop waits for provider shutdown and cancels a replacement queued behind it", async () => {
  const channel = new Channel();
  let release!: () => void,
    connects = 0;
  const host = {
    lease: () => ({
      revoke() {},
      valid: () => true,
      onRevoke: () => () => {},
      context: () => ({}),
      subscribe: () => () => {},
    }),
  } as any;
  const bridge = attachWebVoiceIpc({
    channel: channel as any,
    host: () => host,
    key: async () => "fake-key",
    factory: () => () =>
      ({
        state: "ready",
        generation: 0,
        connect: async () => {
          connects++;
        },
        sendContext() {},
        close() {},
        shutdown: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      }) as any,
  });
  channel.send({ type: "start", provider: "gemini" });
  await tick();
  channel.send({ type: "start", provider: "openai" });
  await tick();
  let completed = false;
  const stopped = bridge.stop().then((result) => {
    completed = true;
    return result;
  });
  await tick();
  expect(completed).toBe(false);
  expect(connects).toBe(1);
  release();
  expect(await stopped).toEqual({ stopped: true });
  await tick();
  expect(connects).toBe(1);
  expect(channel.destroyed).toBe(false);
  await bridge.close();
});

for (const provider of ["gemini", "openai"])
  test(provider + " missing credentials are visible without leaking secret exception text", async () => {
    const channel = new Channel();
    let factories = 0;
    const host = { lease: () => ({ revoke() {} }) } as any;
    const bridge = attachWebVoiceIpc({
      channel: channel as any,
      host: () => host,
      key: async () => {
        throw new Error("secret credential path");
      },
      factory: () => {
        factories++;
        return undefined as any;
      },
    });
    channel.send({ type: "start", provider });
    await tick();
    const error = channel.controls().find((value) => value.code === "credentials_unavailable");
    expect(error?.message).toContain(provider === "gemini" ? "Gemini" : "OpenAI");
    expect(JSON.stringify(channel.controls())).not.toContain("secret credential path");
    expect(factories).toBe(0);
    await bridge.close();
  });
