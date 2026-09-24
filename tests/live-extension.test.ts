import { OpenAIRealtimeSession, type RealtimeSocket } from "../src/live/openai-session";
import { describe, expect, test } from "bun:test";
import { VoiceSession } from "../src/live/session";
import type { LiveParams, LiveConnection } from "../src/live/types";
import liveExtension from "../src/live/extension";
import type { LiveDependencies } from "../src/live/extension";
import type { VoiceCallbacks, VoiceOrchestration } from "../src/live/types";
import type { AudioCallbacks } from "../src/live/audio";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(overrides: Partial<LiveDependencies> = {}) {
  let handler!: (args: string, ctx: any) => Promise<void>;
  let complete!: (prefix: string) => { value: string; label: string }[] | null;
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
  const deps: LiveDependencies = {
    local: () => true,
    config: { load: async () => ({ provider: "google", model: "gemini-3.8-live" }), save: async () => {} },
    speakerCheck: async () => "Test signal detected; compare mic/speaker route manually.",
    host: () => undefined,
    credentials: async () => ({
      status: async () => ({ state: "stored_api_key", canImport: false }),
      loadKey: async () => "fake-test-only",
      importLiveEnv: async () => {
        throw new Error("unexpected import");
      },
    }),
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
  const transcriptEntries: { type: string; data: any }[] = [];
  liveExtension(
    {
      appendEntry: (type: string, data: any) => transcriptEntries.push({ type, data }),
      registerCommand: (name: string, cmd: any) => {
        expect(name).toBe("live");
        handler = cmd.handler;
        complete = cmd.getArgumentCompletions;
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
      select: async (_title?: string, _options?: string[]): Promise<string | undefined> => "Done",
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
    complete: (prefix: string) => complete(prefix),
    contexts,
    transcriptEntries,
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
describe("Live voice", () => {
  test("full received voice text persists separately from the bounded viewport and stop flushes partial text", async () => {
    const t = setup();
    await t.run("start");
    const long = "A long received sentence. ".repeat(160);
    t.voice.onInputTranscript?.({ text: long, finished: true, finalitySource: "model_contract" });
    t.voice.onOutputTranscript?.({ text: "First half, " }, 0);
    t.voice.onOutputTranscript?.({ text: "second half." }, 0);
    t.voice.onTurnComplete?.(0);
    expect(t.transcriptEntries.map((e) => e.data)).toEqual([
      { speaker: "You", text: long.slice(0, 4096), status: "partial" },
      { speaker: "You", text: long.slice(4096), status: "final" },
      { speaker: "Voice", text: "First half, second half.", status: "turn-boundary" },
    ]);
    expect(t.transcriptEntries.every((e) => e.type === "die-live-transcript")).toBe(true);
    t.voice.onOutputTranscript?.({ text: "Unfinished reply" }, 0);
    await t.run("stop");
    expect(t.transcriptEntries.at(-1)?.data).toEqual({ speaker: "Voice", text: "Unfinished reply", status: "partial" });
    t.voice.onOutputTranscript?.({ text: "stale" }, 0);
    expect(t.transcriptEntries).toHaveLength(4);
  });

  test("autocomplete lists only Live actions and filters prefixes without side effects", () => {
    const t = setup();
    expect(t.complete("")?.map((item) => item.value)).toEqual([
      "start",
      "stop",
      "setup",
      "status",
      "provider",
      "model",
      "mic-check",
      "speaker-check",
    ]);
    expect(t.complete("st")?.map((item) => item.value)).toEqual(["start", "stop", "status"]);
    expect(t.complete("speaker")?.map((item) => item.value)).toEqual(["speaker-check"]);
    expect(t.complete("missing")).toBeNull();
    expect(t.complete("start extra")).toBeNull();
    expect(t.complete("")?.every((item) => item.label === item.value)).toBe(true);
    expect([t.keyCalls, t.launches, t.starts]).toEqual([0, 0, 0]);
  });
  test("bare Live toggles on and off while explicit start and stop stay idempotent", async () => {
    const t = setup();
    await t.run("");
    expect(t.starts).toBe(1);
    await t.run("start");
    expect([t.starts, t.closes]).toEqual([1, 0]);
    await t.run("  ");
    expect(t.status.at(-1)).toBeUndefined(); // Toggle takes effect before asynchronous device cleanup.
    await tick();
    expect(t.closes).toBe(1);
    await t.run("stop");
    expect([t.keyCalls, t.closes]).toEqual([1, 1]);
    await t.run("");
    expect(t.starts).toBe(2);
    await t.run("stop");
  });
  for (const stage of ["helper", "provider"]) {
    test("bare Live cancels pending " + stage + " without late activation", async () => {
      const t = setup();
      t.defer();
      const starting = t.run("");
      await tick();
      if (stage === "provider") {
        t.resolveLaunch();
        await tick();
      }
      await t.run("");
      if (stage === "helper") t.resolveLaunch();
      else t.resolveConnect();
      await starting;
      expect(t.starts).toBe(0);
      expect(t.closes).toBe(1);
      expect(t.status.at(-1)).toBeUndefined();
    });
  }
  test("bare Live cancels pending auth without stale setup or audio", async () => {
    let resolveKey!: (value: string) => void;
    const t = setup({
      key: async () =>
        new Promise<string>((resolve) => {
          resolveKey = resolve;
        }),
    });
    const starting = t.run("");
    await tick();
    await t.run("");
    resolveKey("test-key");
    await starting;
    expect([t.launches, t.starts]).toEqual([0, 0]);
  });

  test("bare /live starts directly without a picker or confirmation", async () => {
    const t = setup();
    t.ctx.ui.select = async () => {
      throw new Error("unexpected picker");
    };
    t.ctx.ui.confirm = async () => {
      throw new Error("unexpected confirmation");
    };
    await t.run("");
    expect([t.launches, t.keyCalls, t.starts]).toEqual([1, 1, 1]);
    expect(t.status.at(-1)).toStartWith("Live listening");
    await t.run("stop");
  });
  test("status does not inspect auth or open audio", async () => {
    const t = setup();
    await t.run("status");
    expect([t.launches, t.keyCalls, t.starts]).toEqual([0, 0, 0]);
    expect(t.notices).toEqual([
      "Live off · Google Gemini voice model gemini-3.8-live. Coding-agent model is configured separately.",
    ]);
  });
  test("status distinguishes the connected agent and six configured declarations", async () => {
    const unused = async () => {
      throw new Error("No tool execution in this status test");
    };
    const t = setup({
      host: () => ({
        context: () => ({ diagnosticFixture: true }),
        subscribe: () => () => {},
        send: unused,
        steer: unused,
        list: unused,
        inspect: unused,
        stop: unused,
      }),
    });
    await t.run("start");
    await t.run("status");
    expect(t.notices.at(-1)).toContain("agent connected · tools configured 6");
    await t.run("stop");
  });
  test("status distinguishes partial transcription from provider-marked completion", async () => {
    const t = setup();
    await t.run("start");
    t.voice.onInputTranscript?.({ text: "synthetic request" });
    await t.run("status");
    expect(t.notices.at(-1)).toContain("completed input transcripts 0");
    t.voice.onInputTranscript?.({ text: "", finished: true });
    await t.run("status");
    expect(t.notices.at(-1)).toContain("completed input transcripts 1");
    await t.run("stop");
  });
  test("status exposes missing agent tools instead of presenting voice as fully connected", async () => {
    const t = setup(); // No host supplied by this fixture.
    await t.run("start");
    await t.run("status");
    expect(t.notices.at(-1)).toContain("agent unavailable · tools configured 0");
    await t.run("stop");
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
    expect(t.status.at(-1)).toContain("Live");
    await t.run("status");
    expect(t.notices.at(-1)).toContain("provider interruptions unknown");
    expect(t.notices.at(-1)).toContain("native VP unknown");
    await t.run("stop");
    expect(t.status.at(-1)).toBeUndefined();
    expect(t.widgets.at(-1)).toBeUndefined();
  });
  test("stop while helper hello is pending disposes late helper without opening devices", async () => {
    const t = setup();
    t.defer();
    const starting = t.run("start");
    await tick();
    await t.run("stop");
    t.resolveLaunch();
    await starting;
    expect([t.keyCalls, t.starts, t.closes]).toEqual([1, 0, 1]);
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
      expect(t.played).toHaveLength(0); // No writes before native readiness.
      await originalStart();
    };
    await t.run("start");
    await tick();
    expect(t.played.map((p) => p.length)).toEqual([960, 960, 960, 960]); // Bounded 80ms reserve.
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
  test("stop invalidates pending auth and concurrent starts have one owner", async () => {
    let accept!: (value: string) => void;
    const t = setup({
      key: () =>
        new Promise((resolve) => {
          accept = resolve;
        }),
    });
    const first = t.run("start");
    await tick();
    await t.run("start");
    expect(t.launches).toBe(0);
    await t.run("stop");
    accept("fake-test-only");
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
  expect(t.status.at(-1)).toStartWith("Live listening");
  expect(t.contexts[0]).toContain("existing session");
  t.voice.onInputTranscript?.({ text: "work", finished: true });
  const pending = t.orchestration!.execute({ name: "agent_send", args: { requestId: "same" } });
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
  await t.orchestration!.execute({ name: "agent_send", args: { requestId: "same" } });
  expect(sent).toBe(1);
  t.voice.onError?.({ code: "disconnected", message: "socket gone" });
  expect(detached).toBe(2);
  expect(stopped).toBe(0);
});

describe("local speaker-check wiring", () => {
  test("consent and local gate precede runner; never calls key, provider, host or audio on decline", async () => {
    let runs = 0;
    const t = setup({
      speakerCheck: async () => {
        runs++;
        return "quiet";
      },
    });
    t.decline();
    await t.run("speaker-check");
    expect([runs, t.launches, t.keyCalls]).toEqual([0, 0, 0]);
    (t.ctx as any).mode = "rpc";
    await t.run("speaker-check");
    expect(runs).toBe(0);
  });
  test("summary is bounded and provider disconnected; no agent job or auth path", async () => {
    let runs = 0;
    const t = setup({
      speakerCheck: async ({ signal }) => {
        expect(signal.aborted).toBe(false);
        runs++;
        return "Residual high; check selected output and microphone";
      },
    });
    await t.run("speaker-check");
    expect(runs).toBe(1);
    expect([t.launches, t.keyCalls]).toEqual([0, 0]);
    expect(t.notices.at(-1)).toContain("Residual high");
    expect(t.notices.at(-1)).toContain("provider not connected");
    expect(t.notices.at(-1)).toContain("cannot prove barge-in or AEC");
  });
  test("stop aborts active measurement; prevents stale result and start/mic overlap", async () => {
    let release!: (value: string) => void;
    let signal!: AbortSignal;
    const t = setup({
      speakerCheck: ({ signal: s }) => {
        signal = s;
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
    });
    const pending = t.run("speaker-check");
    await tick();
    await t.run("start");
    await t.run("mic-check");
    await t.run("speaker-check");
    expect([t.launches, t.keyCalls]).toEqual([0, 0]);
    await t.run("stop");
    expect(signal.aborted).toBe(true);
    release("stale result");
    await pending;
    expect(t.notices.join(" ")).not.toContain("stale result");
  });
  test("shutdown invalidates pending consent and session change aborts active runner", async () => {
    const t = setup();
    let accept!: (v: boolean) => void;
    t.ctx.ui.confirm = () =>
      new Promise<boolean>((resolve) => {
        accept = resolve;
      });
    const pending = t.run("speaker-check");
    await tick();
    t.shutdown();
    accept(true);
    await pending;
    expect(t.launches).toBe(0);
    let seen!: AbortSignal;
    const x = setup({
      speakerCheck: async ({ signal }) => {
        seen = signal;
        x.sessionStart();
        return "late";
      },
    });
    await x.run("speaker-check");
    expect(seen.aborted).toBe(true);
    expect(x.notices.join(" ")).not.toContain("late");
  });
  test("runner exceptions are not leaked to UI", async () => {
    const t = setup({
      speakerCheck: async () => {
        throw new Error("secret waveform");
      },
    });
    await t.run("speaker-check");
    expect(t.notices.at(-1)).toContain("Speaker check failed");
    expect(t.notices.join(" ")).not.toContain("secret waveform");
  });
});

test("real local speaker runner uses only injected native audio, never auth/provider/host", async () => {
  let handler!: (args: string, ctx: any) => Promise<void>;
  let keyCalls = 0,
    providerCalls = 0,
    hostCalls = 0,
    plays = 0,
    closes = 0;
  const notices: string[] = [];
  liveExtension(
    {
      registerCommand: (_: string, command: any) => {
        handler = command.handler;
      },
      on: () => {},
    } as any,
    {
      config: { load: async () => ({ provider: "google", model: "gemini-3.8-live" }), save: async () => {} },
      local: () => true,
      key: async () => {
        keyCalls++;
        throw Error("no auth");
      },
      voice: () => {
        providerCalls++;
        throw Error("no provider");
      },
      host: () => {
        hostCalls++;
        throw Error("no host");
      },
      audio: async () => ({
        diagnostics: { queuedMs: 0, captureFrames: 0, capturedBytes: 0 },
        start: async () => {},
        play: async () => {
          plays++;
        },
        flush: async () => {},
        stop: async () => {},
        close: () => {
          closes++;
        },
      }),
    },
  );
  await handler("speaker-check", {
    mode: "interactive",
    ui: { confirm: async () => true, notify: (message: string) => notices.push(message) },
  });
  expect([keyCalls, providerCalls, hostCalls]).toEqual([0, 0, 0]);
  expect(plays).toBeGreaterThan(0);
  expect(closes).toBe(1);
  expect(notices.at(-1)).toContain("Inconclusive");
  expect(notices.at(-1)).toContain("provider not connected");
  expect(notices.at(-1)).toContain("native processing=unknown");
});

describe("direct entry and focused setup", () => {
  test("missing-key bare /live opens setup and cancelling never opens audio", async () => {
    const t = setup({
      key: async () => {
        throw new Error("SECRET");
      },
      credentials: async () => ({
        status: async () => ({ state: "missing", canImport: true }),
        loadKey: async () => {
          throw new Error("must not read key");
        },
        importLiveEnv: async () => {
          throw new Error("must not import");
        },
      }),
    });
    const titles: string[] = [];
    t.ctx.ui.select = async (title) => {
      titles.push(title!);
      return "Cancel";
    };
    t.ctx.ui.confirm = async () => {
      throw new Error("unexpected confirmation");
    };
    await t.run("");
    expect(titles).toEqual(["Google API key required"]);
    expect([t.launches, t.starts]).toEqual([0, 0]);
    expect(t.notices.join(" ")).not.toContain("SECRET");
    expect(t.notices.join(" ")).not.toContain("Could not read");
  });

  test("setup alone stays offline; only Start voice opens the session", async () => {
    const t = setup();
    await t.run("setup");
    expect([t.launches, t.keyCalls, t.starts]).toEqual([0, 0, 0]);
    t.ctx.ui.select = async () => "Start voice";
    t.ctx.ui.confirm = async () => {
      throw new Error("redundant confirmation");
    };
    await t.run("setup");
    expect([t.launches, t.starts]).toEqual([1, 1]);
    await t.run("stop");
  });

  for (const cancel of ["toggle", "stop", "shutdown", "sessionStart"] as const) {
    test(cancel + " invalidates a pending setup start choice", async () => {
      const t = setup();
      let choose!: (value: string) => void;
      t.ctx.ui.select = () =>
        new Promise((resolve) => {
          choose = resolve;
        });
      const opening = t.run("setup");
      await tick();
      await t.run("start"); // Explicit concurrent start must not acquire authority.
      expect(t.launches).toBe(0);
      if (cancel === "toggle") await t.run("");
      else if (cancel === "stop") await t.run("stop");
      else t[cancel]();
      choose("Start voice");
      await opening;
      expect([t.launches, t.starts]).toEqual([0, 0]);
      // Cancellation releases the owner; a fresh explicit command can start.
      await t.run("");
      expect([t.launches, t.starts]).toEqual([1, 1]);
      await t.run("stop");
    });
  }

  test("shutdown during credential inspection prevents stale setup UI", async () => {
    let finish!: (value: any) => void;
    const t = setup({
      credentials: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    t.ctx.ui.select = async () => {
      throw new Error("stale dialog");
    };
    const opening = t.run("setup");
    await tick();
    t.shutdown();
    finish({
      status: async () => {
        throw new Error("stale inspection");
      },
    });
    await opening;
    expect(t.notices).toEqual([]);
    expect(t.launches).toBe(0);
  });

  test("local restriction precedes direct auth and setup", async () => {
    const t = setup({
      local: () => false,
      credentials: async () => {
        throw new Error("must not inspect");
      },
    });
    await t.run("");
    await t.run("setup");
    expect([t.launches, t.keyCalls, t.starts]).toEqual([0, 0, 0]);
  });
});

test("missing auth can be configured then explicitly started from setup", async () => {
  let checks = 0;
  let keyLoads = 0;
  const t = setup({
    key: async () => {
      throw new Error("missing");
    },
    credentials: async () => ({
      status: async () =>
        ++checks === 1 ? { state: "missing", canImport: true } : { state: "configured_api_key", canImport: false },
      loadKey: async () => {
        keyLoads++;
        return "fake-test-only";
      },
      importLiveEnv: async () => {
        throw new Error("must not import automatically");
      },
    }),
  });
  const titles: string[] = [];
  t.ctx.ui.select = async (title) => {
    titles.push(title!);
    expect([t.launches, t.starts, keyLoads]).toEqual([0, 0, 0]);
    return title === "Live" ? "Start voice" : "Recheck";
  };
  await t.run("");
  expect(titles).toEqual(["Google API key required", "Live"]);
  expect([t.launches, t.starts, keyLoads]).toEqual([1, 1, 1]);
  await t.run("stop");
});

test("real Session/Run preserves finished authority across tool turns, revokes on input and interruption", async () => {
  let params!: LiveParams;
  let tools!: VoiceOrchestration;
  const sent: string[] = [];
  const responses: any[] = [];
  const t = setup({
    host: () => ({
      send: async (_id, text) => {
        sent.push(text);
        return { queued: true };
      },
      steer: async () => ({}),
      list: async () => ({ jobs: [] }),
      inspect: async () => ({ output: "fabricated" }),
      stop: async () => ({}),
      context: () => ({ text: "fabricated" }),
      subscribe: () => () => {},
    }),
    voice: (callbacks, orchestration) => {
      tools = orchestration!;
      return new VoiceSession(
        callbacks,
        () => ({
          live: {
            connect: async (p) => {
              params = p;
              return {
                sendRealtimeInput: () => {},
                sendClientContent: () => {},
                sendToolResponse: (r: unknown) => responses.push(r),
                close: () => {},
              } as unknown as LiveConnection;
            },
          },
        }),
        orchestration,
      );
    },
  });
  const receive = (v: object) => params.callbacks.onmessage(v as Parameters<LiveParams["callbacks"]["onmessage"]>[0]);
  const input = (text: string, finished = false) =>
    receive({ serverContent: { inputTranscription: { text, finished } } });
  const send = (text: string) => tools.execute({ name: "agent_send", args: { requestId: text } });
  await t.run("start");
  input("read README", true);
  receive({ toolCall: { functionCalls: [{ id: "list", name: "jobs_list" }] } });
  await tick();
  expect(responses).toHaveLength(1);
  for (let i = 0; i < 3; i++) {
    receive({ serverContent: { turnComplete: true } });
    await tick();
  }
  receive({
    toolCall: { functionCalls: [{ id: "send", name: "agent_send", args: { requestId: "r" } }] },
  });
  await tick();
  expect(sent).toEqual(["read README"]);
  await expect(send("read README")).rejects.toThrow("transcript");
  input("old", true);
  input("new");
  await expect(send("old")).rejects.toThrow("transcript");
  await expect(send("new")).rejects.toThrow("transcript");
  receive({ serverContent: { turnComplete: true } });
  await tick();
  await expect(send("new")).rejects.toThrow("transcript");
  input(" request", true);
  await send("new request"); // model completion did not erase partial input
  input("interrupted", true);
  receive({
    serverContent: { interrupted: true },
    toolCall: { functionCalls: [{ id: "denied", name: "agent_send", args: { requestId: "i" } }] },
  });
  await tick();
  expect(sent).toEqual(["read README", "new request"]);
  receive({
    serverContent: { interrupted: true, inputTranscription: { text: "fresh", finished: true }, turnComplete: true },
    toolCall: { functionCalls: [{ id: "fresh", name: "agent_send", args: { requestId: "f" } }] },
  });
  await tick();
  expect(sent).toEqual(["read README", "new request", "fresh"]);
  receive({ serverContent: { outputTranscription: { text: "fabricated", finished: true } } });
  await tools.execute({ name: "session_context" });
  await tools.execute({ name: "jobs_inspect", args: { id: "job" } });
  await expect(send("fabricated")).rejects.toThrow("transcript");
  input("unused", true);
  const previous = tools;
  await t.run("stop");
  await expect(previous.execute({ name: "agent_send", args: { requestId: "old" } })).rejects.toThrow("transcript");
  await t.run("start");
  expect(tools).not.toBe(previous);
  await expect(send("unused")).rejects.toThrow("transcript");
  await t.run("stop");
});

// Provider transport is fake; both the Session adapter and Run transcript gate are real.
for (const model of ["gemini-3.8-live", "unknown-live", "gemini-3.5-live-translate"]) {
  test("real Session/Run grounded input handoff: " + model, async () => {
    let params!: LiveParams;
    const sent: string[] = [];
    const replies: any[] = [];
    const transcripts: any[] = [];
    const t = setup({
      host: () => ({
        send: async (_id, text) => {
          sent.push(text);
          return { queued: true };
        },
        steer: async (_id, text) => {
          sent.push(text);
          return { queued: true };
        },
        list: async () => ({}),
        inspect: async () => ({}),
        stop: async () => ({}),
        context: () => ({}),
        subscribe: () => () => {},
      }),
      voice: (callbacks, orchestration) =>
        new VoiceSession(
          {
            ...callbacks,
            onInputTranscript: (value) => {
              transcripts.push(value);
              callbacks.onInputTranscript?.(value);
            },
          },
          () => ({
            live: {
              connect: async (p) => {
                params = p;
                return {
                  sendRealtimeInput: () => {},
                  sendClientContent: () => {},
                  close: () => {},
                  sendToolResponse: (r: unknown) => replies.push(r),
                } as unknown as LiveConnection;
              },
            },
          }),
          orchestration,
          model,
        ),
    });
    const receive = (value: object) => params.callbacks.onmessage(value as any);
    const input = (text: string, finished?: boolean) =>
      receive({ serverContent: { inputTranscription: { text, ...(finished === undefined ? {} : { finished }) } } });
    const call = (id: string, extra: object = {}) => ({
      toolCall: { functionCalls: [{ id, name: "agent_send", args: { requestId: id, ...extra } }] },
    });
    await t.run("start");
    input("captured");
    receive(call("absent"));
    await tick();
    if (model === "gemini-3.8-live") {
      expect(sent).toEqual(["captured"]);
      expect(transcripts[0]).toEqual({ text: "captured", finished: true, finalitySource: "model_contract" });
    } else {
      expect(sent).toEqual([]);
      expect(transcripts[0]).toEqual({ text: "captured" });
    }
    // Interrupt clears unknown partial input too; model turns do not prove finality.
    receive({ serverContent: { interrupted: true } });
    input("explicitly partial", false);
    for (let i = 0; i < 3; i++) receive({ serverContent: { turnComplete: true } });
    receive(call("false"));
    await tick();
    expect(transcripts.at(-1)).toMatchObject({ finished: false, rawFinished: false, finalitySource: "provider" });
    const count = sent.length;
    expect(count).toBe(model === "gemini-3.8-live" ? 1 : 0);
    receive({ serverContent: { interrupted: true } });
    // Before-transcript calls fail rather than waiting to steal newer input.
    receive(call("before"));
    await tick();
    expect(replies.at(-1).functionResponses.response).toEqual({
      code: "transcript_unavailable",
      error: "Handoff requires an eligible completed captured user transcript. This request was not sent.",
    });
    receive({ voiceActivity: { voiceActivityType: "ACTIVITY_START" } });
    input("later input", true);
    receive(call("before")); // duplicate failure cannot acquire new authority
    await tick();
    expect(sent).toHaveLength(count);
    receive(call("fresh-sdk-id", { requestId: "before" }));
    await tick();
    expect(replies.at(-1).functionResponses.response.code).toBe("request_already_used");
    expect(sent).toHaveLength(count);
    receive(call("after"));
    await tick();
    expect(sent.at(-1)).toBe("later input");
    receive(call("after"));
    receive(call("second-id"));
    await tick();
    expect(sent).toHaveLength(count + 1);
    // Same envelope is the only bounded call-before-input association we accept.
    receive({
      ...call("same-envelope"),
      serverContent: { inputTranscription: { text: "same message", finished: true } },
    });
    await tick();
    expect(sent.at(-1)).toBe("same message");
    // A scheduled call may not attach to newer input before its dispatch microtask.
    input("old", true);
    receive(call("stale"));
    input("new", true);
    await tick();
    expect(sent.at(-1)).toBe("same message");
    receive(call("fresh"));
    await tick();
    expect(sent.at(-1)).toBe("new");
    for (const activity of [
      { voiceActivity: { voiceActivityType: "ACTIVITY_START" } },
      { serverContent: { interimInputTranscription: { text: "unfinished new speech", finished: true } } },
    ]) {
      input("old before activity", true);
      receive(call("activity-" + replies.length));
      receive(activity);
      await tick();
      receive(call("activity-retry-" + replies.length));
      await tick();
      expect(sent.at(-1)).toBe("new");
    }
    input("cancel me", true);
    receive(call("cancelled"));
    receive({ toolCallCancellation: { ids: ["cancelled"] } });
    await tick();
    receive(call("cancel-retry"));
    await tick();
    expect(sent.at(-1)).toBe("new");
    input("not fabricated", true);
    receive(call("fabricated", { text: "model imperative" }));
    await tick();
    expect(replies.at(-1).functionResponses.response).toHaveProperty("error");
    receive(call("host-payload"));
    await tick();
    expect(sent.at(-1)).toBe("not fabricated");
    if (model === "gemini-3.8-live") {
      input("older segment");
      input("latest segment");
      receive(call("latest-segment"));
      await tick();
      expect(sent.at(-1)).toBe("latest segment");
      input("late segment");
      await tick();
      expect(sent.at(-1)).toBe("latest segment"); // never auto-steer late segments
      receive(call("late-fresh-call"));
      await tick();
      expect(sent.at(-1)).toBe("late segment");
    }
    input("pending delta", false);
    input(""); // absence plus empty text is not inferred finality
    receive(call("empty-unknown"));
    await tick();
    expect(replies.at(-1).functionResponses.response).toHaveProperty("error");
    input("", true); // explicit textless final marker can finish a bounded delta
    receive(call("empty-final"));
    await tick();
    expect(sent.at(-1)).toBe("pending delta");
    input("stop", true);
    receive(call("stop"));
    await t.run("stop");
    await tick();
    expect(sent.at(-1)).toBe("pending delta");
  });
}

test("Live waveform goes through setStatus, follows PCM, native drain, interruption and stop", async () => {
  const t = setup();
  await t.run("start");
  expect(t.status.at(-1)).toContain("Live listening");
  const loud = Buffer.alloc(960, 0x7f);
  t.capture.capture?.(loud);
  await new Promise((resolve) => setTimeout(resolve, 110));
  const listen = t.status.at(-1)!;
  expect(listen).toContain("Live listening  ");
  expect(listen).not.toContain("⠐".repeat(10));
  t.voice.onAudio?.(loud.toString("base64"), 0);
  t.capture.played?.(100);
  await new Promise((resolve) => setTimeout(resolve, 110));
  expect(t.status.at(-1)).toContain("Live speaking  ");
  t.voice.onTurnComplete?.(0);
  expect(t.status.at(-1)).toContain("Live speaking"); // native still has buffered sound
  t.voice.onInterrupted?.(1);
  expect(t.status.at(-1)).toContain("Live listening  " + "⠐".repeat(10));
  const count = t.status.length;
  await t.run("stop");
  await new Promise((resolve) => setTimeout(resolve, 190));
  expect(t.status.length).toBe(count + 1); // no leftover animation timer
  expect(t.status.at(-1)).toBeUndefined();
});

test("rejected Live startup leaves no animation updates", async () => {
  const t = setup();
  t.reject();
  await t.run("start");
  expect(t.status.some((value) => value?.startsWith("Live connecting  ·"))).toBe(true);
  expect(t.status.at(-1)).toBeUndefined();
  const count = t.status.length;
  await new Promise((resolve) => setTimeout(resolve, 180));
  expect(t.status.length).toBe(count);
});

describe("Live provider selection", () => {
  test("default Gemini and selected OpenAI are voice models separate from coding agent; busy switches blocked", async () => {
    const keys: string[] = [];
    const voices: string[] = [];
    const t = setup({
      key: async (_signal, provider) => {
        keys.push(provider ?? "google");
        return "fake-key";
      },
      voice: (callbacks, _orchestration, provider) => {
        voices.push(provider ?? "google");
        return {
          state: "ready",
          generation: 0,
          connect: async () => {
            callbacks.onReady?.();
          },
          sendAudio: () => {},
          close: () => {},
        };
      },
    });
    await t.run("status");
    expect(t.notices.at(-1)).toContain("Google Gemini voice model");
    await t.run("start");
    expect(keys).toEqual(["google"]);
    await t.run("provider openai");
    expect(t.notices.at(-1)).toContain("stop it");
    await t.run("stop");
    await t.run("provider openai");
    await t.run("status");
    expect(t.notices.at(-1)).toContain("OpenAI voice model");
    expect(t.notices.at(-1)).toContain("Coding-agent model is configured separately");
    await t.run("start");
    expect(keys).toEqual(["google", "openai"]);
    expect(voices).toEqual(["google", "openai"]);
    await t.run("status");
    expect(t.notices.at(-1)).toContain("OpenAI voice model");
    await t.run("stop");
  });

  test("model selection persists, restores OpenAI choice, and GPT-Live never starts or falls back", async () => {
    let saved: import("../src/live/config").LiveConfig = { provider: "google", model: "gemini-3.8-live" };
    const keys: string[] = [];
    const models: string[] = [];
    let audio = 0;
    const config = {
      load: async () => saved,
      save: async (next: typeof saved) => {
        saved = next;
      },
    };
    const overrides: Partial<LiveDependencies> = {
      config,
      key: async (_signal, provider) => {
        keys.push(provider!);
        return "fake";
      },
      voice: (callbacks, _tools, _provider, model) => {
        models.push(model!);
        return {
          state: "ready",
          generation: 0,
          connect: async () => {
            callbacks.onReady?.();
          },
          sendAudio: () => {},
          close: () => {},
        };
      },
      audio: async () => {
        audio++;
        throw new Error("fake no device");
      },
    };
    const t = setup(overrides);
    await t.run("provider openai");
    await t.run("model gpt-realtime-2.1-mini");
    expect(saved).toMatchObject({ provider: "openai", model: "gpt-realtime-2.1-mini" });
    await t.run("model unlisted");
    expect(saved.model).toBe("gpt-realtime-2.1-mini");
    await t.run("provider google");
    await t.run("provider openai");
    expect(saved.model).toBe("gpt-realtime-2.1-mini");
    const restarted = setup(overrides);
    await restarted.run("status");
    expect(restarted.notices.at(-1)).toContain("gpt-realtime-2.1-mini");
    const choices: string[][] = [];
    restarted.ctx.ui.select = async (_title?: string, options?: string[]) => {
      choices.push(options ?? []);
      return undefined;
    };
    await restarted.run("model");
    expect(choices[0]).toEqual([
      "gpt-realtime-2.1",
      "gpt-realtime-2.1-mini (selected)",
      "gpt-live-1 (transport unsupported)",
    ]);
    await restarted.run("model gpt-live-1");
    await restarted.run("start");
    expect(restarted.notices.at(-1)).toContain("transport is not supported yet");
    expect(saved.model).toBe("gpt-live-1");
    const persisted = setup(overrides);
    await persisted.run("status");
    expect(persisted.notices.at(-1)).toContain("transport is not supported yet");
    await persisted.run("start");
    expect(persisted.notices.at(-1)).toContain("gpt-live-1");
    expect(keys).toEqual([]);
    expect(models).toEqual([]);
    expect(audio).toBe(0);
    await restarted.run("status");
    expect(restarted.notices.at(-1)).toContain("gpt-live-1");
    await restarted.run("model gpt-realtime-2.1");
    await restarted.run("status");
    expect(restarted.notices.at(-1)).toContain("gpt-realtime-2.1");
  });

  test("failed settings writes leave the previous selection in force", async () => {
    const t = setup({
      config: {
        load: async () => ({ provider: "google", model: "gemini-3.8-live" }),
        save: async () => {
          throw new Error("disk test failure");
        },
      },
    });
    await t.run("provider openai");
    expect(t.notices.at(-1)).toContain("previous choice kept");
    await t.run("status");
    expect(t.notices.at(-1)).toContain("Google Gemini voice model gemini-3.8-live");
  });

  test("OpenAI setup only rechecks canonical API key; cancellation never opens devices", async () => {
    let loaded = 0;
    const t = setup({
      key: async () => {
        throw new Error("no key");
      },
      credentials: async (_signal, provider) => {
        expect(provider).toBe("openai");
        return {
          status: async () => ({ state: "missing", canImport: true }),
          loadKey: async () => {
            loaded++;
            throw new Error("unreachable");
          },
          importLiveEnv: async () => {
            throw new Error("must not import Gemini key");
          },
        };
      },
    });
    await t.run("provider openai");
    await t.run("start");
    expect(t.notices.join(" ")).toContain("openai-codex OAuth do not work");
    expect(loaded).toBe(0);
    expect(t.launches).toBe(0);
  });
});

test("newer provider selection invalidates an older open selection menu", async () => {
  const t = setup();
  let resolve!: (choice: string) => void;
  let choices: string[] = [];
  t.ctx.ui.select = async (_title, options) => {
    choices = options ?? [];
    return new Promise<string>((done) => {
      resolve = done;
    });
  };
  const pending = t.run("provider");
  await t.run("provider openai");
  resolve(choices[0]!);
  await pending;
  await t.run("status");
  expect(t.notices.at(-1)).toContain("OpenAI voice model");
});

test("OpenAI received transcript display alone cannot grant agent handoff authority", async () => {
  let sends = 0;
  const t = setup({
    host: () => ({
      context: () => ({}),
      subscribe: () => () => {},
      send: async () => {
        sends++;
        return {};
      },
      steer: async () => ({}),
      list: async () => ({}),
      inspect: async () => ({}),
      stop: async () => ({}),
    }),
  });
  await t.run("provider openai");
  await t.run("start");
  t.voice.onInputTranscript?.({ text: "stale completed ASR", finished: true, finalitySource: "provider" });
  expect(t.transcriptEntries.some((e) => e.data.text === "stale completed ASR")).toBe(true);
  await expect(
    t.orchestration!.execute({ id: "call-stale", name: "agent_send", args: { requestId: "stale" } }),
  ).rejects.toThrow();
  expect(sends).toBe(0);
  await t.run("stop");
});

test("real OpenAI Session/Run hands delayed completed speech to configured agent once", async () => {
  const listeners = new Map<string, ((event: any) => void)[]>();
  const wire: any[] = [];
  const sent: string[] = [];
  const socket: RealtimeSocket = {
    readyState: 1,
    send: (text) => {
      wire.push(JSON.parse(text));
    },
    close: () => {},
    addEventListener: (name, fn) => {
      listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    },
  };
  const event = (message: any) => {
    for (const fn of listeners.get("message") ?? []) fn({ data: JSON.stringify(message) });
  };
  const t = setup({
    voice: (callbacks, orchestration) =>
      new OpenAIRealtimeSession(
        callbacks,
        () => {
          queueMicrotask(() => {
            for (const fn of listeners.get("open") ?? []) fn({});
            event({ type: "session.created", session: { id: "session-offline" } });
            event({ type: "session.updated", session: { id: "session-offline" } });
          });
          return socket;
        },
        orchestration,
      ),
    host: () => ({
      context: () => ({ agent: "configured" }),
      subscribe: () => () => {},
      send: async (_id, text) => {
        sent.push(text);
        return { status: "queued" };
      },
      steer: async () => ({}),
      list: async () => [],
      inspect: async () => ({}),
      stop: async () => ({}),
    }),
  });
  await t.run("provider openai");
  await t.run("start");
  event({ type: "input_audio_buffer.speech_started", item_id: "user-1", audio_start_ms: 0 });
  event({ type: "input_audio_buffer.speech_stopped", item_id: "user-1", audio_end_ms: 800 });
  event({ type: "input_audio_buffer.committed", item_id: "user-1", previous_item_id: null });
  event({ type: "response.created", response: { id: "response-1", status: "in_progress" } });
  const call = {
    id: "item-call-1",
    type: "function_call",
    call_id: "call-1",
    name: "agent_send",
    arguments: JSON.stringify({ requestId: "request-1" }),
    status: "completed",
  };
  event({
    type: "response.output_item.added",
    response_id: "response-1",
    output_index: 0,
    item: { ...call, arguments: "", status: "in_progress" },
  });
  event({
    type: "response.function_call_arguments.done",
    response_id: "response-1",
    item_id: call.id,
    call_id: call.call_id,
    name: call.name,
    arguments: call.arguments,
    output_index: 0,
  });
  event({ type: "response.output_item.done", response_id: "response-1", output_index: 0, item: call });
  event({ type: "response.done", response: { id: "response-1", status: "completed", output: [call] } });
  await tick();
  expect(sent).toEqual([]);
  event({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "user-1",
    content_index: 0,
    transcript: "Please check today's weather in Bengaluru.",
  });
  await tick();
  expect(sent).toEqual(["Please check today's weather in Bengaluru."]);
  expect(wire.filter((m) => m.item?.type === "function_call_output")).toHaveLength(1);
  expect(wire.filter((m) => m.type === "response.create")).toHaveLength(1);
  expect(t.transcriptEntries.some((e) => e.data.text === "Please check today's weather in Bengaluru.")).toBe(true);
  await t.run("stop");
});

// Fake GA socket exercises the provider/extension boundary, not just extension callbacks.
test("OpenAI late completed response cannot finish the new transcript generation", async () => {
  const listeners = new Map<string, ((event: any) => void)[]>();
  const socket: RealtimeSocket = {
    readyState: 1,
    send: () => {},
    close: () => {},
    addEventListener: (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
  };
  const event = (message: any) => {
    for (const fn of listeners.get("message") ?? []) fn({ data: JSON.stringify(message) });
  };
  const t = setup({
    voice: (callbacks, orchestration) =>
      new OpenAIRealtimeSession(
        callbacks,
        () => {
          queueMicrotask(() => {
            for (const fn of listeners.get("open") ?? []) fn({});
            event({ type: "session.updated" });
          });
          return socket;
        },
        orchestration,
      ),
  });
  await t.run("provider openai");
  await t.run("start");
  event({ type: "response.created", response: { id: "old" } });
  event({ type: "input_audio_buffer.speech_started" });
  event({ type: "input_audio_buffer.committed", item_id: "new-input" });
  event({ type: "response.created", response: { id: "new" } });
  event({ type: "response.output_audio_transcript.delta", response_id: "new", delta: "New answer" });
  event({ type: "response.done", response: { id: "old", status: "completed" } });
  expect(t.transcriptEntries.some((e) => e.data.text === "New answer" && e.data.status === "turn-boundary")).toBe(
    false,
  );
  event({ type: "response.done", response: { id: "new", status: "completed" } });
  expect(
    t.transcriptEntries.filter((e) => e.data.text === "New answer" && e.data.status === "turn-boundary"),
  ).toHaveLength(1);
  await t.run("stop");
});
