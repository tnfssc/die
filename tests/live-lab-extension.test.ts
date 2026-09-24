import { describe, expect, test } from "bun:test";
import liveLabExtension from "../src/live-lab/extension";
import type { LabDependencies } from "../src/live-lab/extension";
import type { VoiceCallbacks, VoiceOrchestration } from "../src/live-lab/types";
import type { AudioCallbacks } from "../src/live-lab/audio";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(overrides: Partial<LabDependencies> = {}) {
  let handler!: (args: string, ctx: any) => Promise<void>;
  let shutdown!: () => void;
  let sessionStart!: () => void;
  let voiceCallbacks!: VoiceCallbacks;
  let orchestration: VoiceOrchestration | undefined;
  const contexts: string[] = [];
  let audioCallbacks!: AudioCallbacks;
  let keyCalls = 0,
    launches = 0,
    starts = 0,
    closes = 0,
    sends = 0;
  const played: { length: number; generation: number }[] = [];
  const flushes: number[] = [];
  const status: (string | undefined)[] = [];
  const widgets: (string[] | undefined)[] = [];
  const notices: string[] = [];
  let consent = true;
  let accepted = true;
  let deferred = false;
  let resolveConnect!: () => void;
  let resolveLaunch!: (value: any) => void;
  const audio = {
    diagnostics: { queuedMs: 0, captureFrames: 0, capturedBytes: 0 },
    start: async () => {
      starts++;
    },
    play: async (pcm: Buffer, generation: number) => {
      played.push({ length: pcm.length, generation });
    },
    flush: async (generation: number) => {
      flushes.push(generation);
    },
    stop: async () => {},
    close: () => {
      closes++;
    },
  };
  const deps: LabDependencies = {
    local: () => true,
    host: () => undefined,
    key: async () => {
      keyCalls++;
      return "fake-test-only";
    },
    voice: (callbacks, tools) => {
      orchestration = tools;
      voiceCallbacks = callbacks;
      return {
        state: "ready",
        sendContext: (text: string) => {
          contexts.push(text);
        },
        generation: 0,
        sendAudio: (_: string) => {
          sends++;
        },
        close: () => {},
        connect: async () => {
          if (deferred)
            await new Promise<void>((resolve) => {
              resolveConnect = resolve;
            });
          if (!accepted) throw new Error("SECRET");
        },
      };
    },
    audio: async (callbacks) => {
      launches++;
      audioCallbacks = callbacks;
      if (deferred)
        return new Promise((resolve) => {
          resolveLaunch = resolve;
        });
      return audio;
    },
    ...overrides,
  };
  liveLabExtension(
    {
      registerCommand: (_: string, cmd: any) => {
        handler = cmd.handler;
      },
      on: (event: string, cb: any) => {
        if (event === "session_shutdown") shutdown = cb;
        if (event === "session_start") sessionStart = cb;
      },
    } as any,
    deps,
  );
  const ctx = {
    mode: "tui",
    ui: {
      confirm: async () => consent,
      select: async () => "Status",
      notify: (value: string) => {
        notices.push(value);
      },
      setStatus: (_: string, value?: string) => {
        status.push(value);
      },
      setWidget: (_: string, value?: string[]) => {
        widgets.push(value);
      },
    },
  };
  return {
    run: (arg: string) => handler(arg, ctx),
    contexts,
    get orchestration() {
      return orchestration;
    },
    ctx,
    audio,
    get voice() {
      return voiceCallbacks;
    },
    get capture() {
      return audioCallbacks;
    },
    get keyCalls() {
      return keyCalls;
    },
    get launches() {
      return launches;
    },
    get starts() {
      return starts;
    },
    get closes() {
      return closes;
    },
    get sends() {
      return sends;
    },
    status,
    widgets,
    notices,
    played,
    flushes,
    shutdown,
    sessionStart,
    decline: () => {
      consent = false;
    },
    reject: () => {
      accepted = false;
    },
    defer: () => {
      deferred = true;
    },
    resolveLaunch: () => resolveLaunch(audio),
    resolveConnect: () => resolveConnect(),
  };
}
describe("opt-in voice-only lab", () => {
  test("menu/status and declined consent do not open helper, auth, or network", async () => {
    const t = setup();
    await t.run("");
    await t.run("status");
    t.decline();
    await t.run("start");
    expect([t.launches, t.keyCalls, t.starts]).toEqual([0, 0, 0]);
    expect(t.notices.join(" ")).toContain("No key, network, microphone");
  });
  test("full duplex, bounded frames, interruption flushes but turnComplete does not", async () => {
    const t = setup();
    await t.run("start");
    expect([t.launches, t.keyCalls, t.starts]).toEqual([1, 1, 1]);
    t.voice.onInputTranscript?.({ text: "hello\x1b[2J\nworld" });
    t.voice.onOutputTranscript?.({ text: "reply\u202eok" }, 0);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(t.widgets.at(-1)?.join(" ")).toContain("You: hello world");
    expect(t.widgets.at(-1)?.join(" ")).not.toContain("\x1b");
    t.voice.onAudio?.(Buffer.alloc(2000).toString("base64"), 0);
    t.voice.onTurnComplete?.(0);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(t.played.map((p) => p.length)).toEqual([960, 960, 80]);
    t.capture.capture?.(Buffer.alloc(640));
    expect(t.sends).toBe(1);
    t.voice.onTurnComplete?.(0);
    expect(t.flushes).toEqual([]);
    t.voice.onInterrupted?.(1);
    expect(t.flushes).toEqual([1]);
    t.voice.onAudio?.(Buffer.alloc(960).toString("base64"), 0);
    t.voice.onAudio?.(Buffer.alloc(960).toString("base64"), 1);
    await tick();
    expect(t.played.at(-1)?.generation).toBe(1);
    expect(t.status.at(-1)).toContain("gemini-3.8-live");
    await t.run("stop");
    expect(t.status.at(-1)).toBeUndefined();
    expect(t.widgets.at(-1)).toBeUndefined();
  });
  test("stop while helper hello is pending disposes late helper without key or device", async () => {
    const t = setup();
    t.defer();
    const starting = t.run("start");
    await tick();
    await t.run("stop");
    t.resolveLaunch();
    await starting;
    expect([t.keyCalls, t.starts, t.closes]).toEqual([0, 0, 1]);
  });
  test("provider rejection and helper error tear down without exposing error text", async () => {
    const t = setup();
    t.reject();
    await t.run("start");
    expect(t.starts).toBe(0);
    expect(t.closes).toBe(1);
    expect(t.notices.join(" ")).not.toContain("SECRET");
    const running = setup();
    await running.run("start");
    running.capture.error?.("permission", "SECRET");
    expect(running.notices.join(" ")).toContain("Microphone access denied [permission]");
    expect(t.notices.join(" ")).not.toContain("SECRET");
    expect(t.status.at(-1)).toBeUndefined();
  });
  test("mic-check requires consent, never uses key/provider and discards capture", async () => {
    const declined = setup();
    declined.decline();
    await declined.run("mic-check");
    expect([declined.launches, declined.keyCalls, declined.starts]).toEqual([0, 0, 0]);
    const t = setup();
    await t.run("mic-check");
    expect([t.launches, t.keyCalls, t.starts, t.closes]).toEqual([1, 0, 1, 1]);
    expect(t.notices.join(" ")).toContain("Audio route ready [ready]");
    const denied = setup({
      audio: async () => {
        throw new Error("SECRET");
      },
    });
    await denied.run("mic-check");
    expect(denied.notices.join(" ")).toContain("[launch]");
    expect(denied.notices.join(" ")).not.toContain("SECRET");
  });
  test("mic-check reports safe native stage and NSError number without helper text", async () => {
    const t = setup();
    t.audio.start = async () => {
      t.capture.error?.("engine_start", "secret device name", { domain: "NSOSStatusErrorDomain", number: -10875 });
      throw new Error("secret device name");
    };
    await t.run("mic-check");
    expect(t.notices.join(" ")).toContain("[engine_start] (NSError NSOSStatusErrorDomain -10875)");
    expect(t.notices.join(" ")).not.toContain("secret");
  });
  test("session change aborts pending mic-check before devices open", async () => {
    const t = setup();
    t.defer();
    const checking = t.run("mic-check");
    await tick();
    t.sessionStart();
    t.resolveLaunch();
    await checking;
    expect([t.launches, t.starts, t.keyCalls, t.closes]).toEqual([1, 0, 0, 1]);
  });
  test("unknown helper code never reaches UI", async () => {
    const t = setup();
    await t.run("start");
    t.capture.error?.("SECRET", "SECRET");
    expect(t.notices.join(" ")).toContain("[unclassified]");
    expect(t.notices.join(" ")).not.toContain("SECRET");
  });
  test("provider output during setup is held until audio ready; overflow fails visibly", async () => {
    const t = setup();
    const originalStart = t.audio.start;
    t.audio.start = async () => {
      t.voice.onAudio?.(Buffer.alloc(9600).toString("base64"), 0);
      await originalStart();
    };
    await t.run("start");
    await tick();
    expect(t.played.map((p) => p.length)).toEqual([960]);
    t.voice.onAudio?.(Buffer.alloc(2_880_002).toString("base64"), 0);
    expect(t.status.at(-1)).toBeUndefined();
    expect(t.notices.join(" ")).toContain("bounded audio budget");
  });
  test("platform gate precedes consent, and session shutdown stops without touching agent", async () => {
    const t = setup({ local: () => false });
    await t.run("start");
    expect(t.launches).toBe(0);
    const x = setup();
    await x.run("start");
    x.shutdown();
    expect(x.status.at(-1)).toBeUndefined();
  });
  test("transcript deltas join without invented spaces and capture keeps running while speaking", async () => {
    const t = setup();
    await t.run("start");
    t.voice.onInputTranscript?.({ text: "Hel" });
    t.voice.onInputTranscript?.({ text: "lo world", finished: true });
    t.voice.onAudio?.(Buffer.alloc(1920).toString("base64"), 0);
    t.capture.played?.(40);
    for (let i = 0; i < 20; i++) t.capture.capture?.(Buffer.alloc(640));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(t.widgets.at(-1)?.join(" ")).toContain("You: Hello world");
    expect(t.sends).toBe(20);
    expect(t.status.at(-1)).toContain("speaking");
    t.voice.onTurnComplete?.(0);
    t.capture.played?.(0);
    expect(t.status.at(-1)).toContain("listening");
    await t.run("stop");
  });
  test("stop invalidates pending consent and concurrent starts have one owner", async () => {
    const t = setup();
    let accept!: (value: boolean) => void;
    t.ctx.ui.confirm = () =>
      new Promise<boolean>((resolve) => {
        accept = resolve;
      });
    const first = t.run("start");
    await tick();
    await t.run("start");
    expect(t.launches).toBe(0);
    await t.run("stop");
    accept(true);
    await first;
    expect(t.launches).toBe(0);
  });
});

test("live orchestration keeps capture/playback active, forwards actual completion, and disconnect only detaches voice", async () => {
  let finish!: () => void;
  let listener: ((event: unknown) => void) | undefined;
  let stopped = 0;
  let sent = 0;
  let subscribed = 0;
  let detached = 0;
  const request = new Map<string, Promise<unknown>>();
  const t = setup({
    host: () => ({
      send: (id) => {
        if (!request.has(id)) {
          sent++;
          request.set(
            id,
            new Promise((resolve) => {
              finish = () => resolve({ status: "queued" });
            }),
          );
        }
        return request.get(id)!;
      },
      steer: async () => ({ status: "queued" }),
      list: async () => ({ jobs: [] }),
      inspect: async () => ({ status: "completed", output: "actual output" }),
      stop: async () => {
        stopped++;
        return { status: "denied" };
      },
      context: () => ({ recentRequests: [...request.keys()], text: "existing session" }),
      subscribe: (cb) => {
        subscribed++;
        listener = cb;
        return () => {
          detached++;
          listener = undefined;
        };
      },
    }),
  });
  (t.ctx as any).model = { provider: "configured", id: "coding-model" };
  await t.run("start");
  expect(t.status.at(-1)).toContain("Agent configured/coding-model");
  expect(t.contexts[0]).toContain("existing session");
  t.voice.onInputTranscript?.({ text: "work", finished: true });
  const pending = t.orchestration!.execute({ name: "agent_send", args: { requestId: "same", text: "work" } });
  t.capture.capture?.(Buffer.alloc(640));
  t.voice.onAudio?.(Buffer.alloc(960).toString("base64"), 0);
  await tick();
  expect(t.sends).toBe(1);
  expect(t.played.length).toBe(1);
  t.voice.onInterrupted?.(1);
  expect(stopped).toBe(0);
  listener?.({ type: "completed", id: "owned", status: "completed" });
  expect(t.contexts.at(-1)).toContain('"type":"completed"');
  await t.run("stop");
  expect(detached).toBe(1);
  finish();
  expect(await pending).toEqual({ status: "queued" });
  expect(stopped).toBe(0);
  await t.run("start");
  expect(subscribed).toBe(2);
  expect(t.contexts.at(-1)).toContain("same");
  t.voice.onInputTranscript?.({ text: "work", finished: true });
  await t.orchestration!.execute({ name: "agent_send", args: { requestId: "same", text: "work" } });
  expect(sent).toBe(1);
  t.voice.onError?.({ code: "disconnected", message: "socket gone" });
  expect(detached).toBe(2);
  expect(stopped).toBe(0);
});
