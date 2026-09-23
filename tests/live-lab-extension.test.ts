import { describe, expect, test } from "bun:test";
import liveLabExtension from "../src/live-lab/extension";
import type { LabDependencies } from "../src/live-lab/extension";
import type { VoiceCallbacks } from "../src/live-lab/types";
import type { AudioCallbacks } from "../src/live-lab/audio";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(overrides: Partial<LabDependencies> = {}) {
  let handler!: (args: string, ctx: any) => Promise<void>;
  let shutdown!: () => void;
  let voiceCallbacks!: VoiceCallbacks;
  let audioCallbacks!: AudioCallbacks;
  let keyCalls = 0, launches = 0, starts = 0, closes = 0, sends = 0;
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
    start: async () => { starts++; },
    play: async (pcm: Buffer, generation: number) => { played.push({ length: pcm.length, generation }); },
    flush: async (generation: number) => { flushes.push(generation); },
    stop: async () => {}, close: () => { closes++; },
  };
  const deps: LabDependencies = {
    local: () => true,
    key: async () => { keyCalls++; return "fake-test-only"; },
    voice: (callbacks) => { voiceCallbacks = callbacks; return {
      state: "ready", generation: 0,
      sendAudio: (_: string) => { sends++; },
      close: () => {},
      connect: async () => { if (deferred) await new Promise<void>((resolve) => { resolveConnect = resolve; }); if (!accepted) throw new Error("SECRET"); },
    }; },
    audio: async (callbacks) => { launches++; audioCallbacks = callbacks; if (deferred) return new Promise((resolve) => { resolveLaunch = resolve; }); return audio; },
    ...overrides,
  };
  liveLabExtension({ registerCommand: (_: string, cmd: any) => { handler = cmd.handler; }, on: (_: string, cb: any) => { shutdown = cb; } } as any, deps);
  const ctx = { mode: "tui", ui: {
    confirm: async () => consent,
    select: async () => "Status",
    notify: (value: string) => { notices.push(value); },
    setStatus: (_: string, value?: string) => { status.push(value); },
    setWidget: (_: string, value?: string[]) => { widgets.push(value); },
  } };
  return { run: (arg: string) => handler(arg, ctx), ctx, audio, get voice() { return voiceCallbacks; }, get capture() { return audioCallbacks; }, get keyCalls() { return keyCalls; }, get launches() { return launches; }, get starts() { return starts; }, get closes() { return closes; }, get sends() { return sends; }, status, widgets, notices, played, flushes, shutdown, decline: () => { consent = false; }, reject: () => { accepted = false; }, defer: () => { deferred = true; }, resolveLaunch: () => resolveLaunch(audio), resolveConnect: () => resolveConnect() };
}
describe("opt-in voice-only lab", () => {
  test("menu/status and declined consent do not open helper, auth, or network", async () => {
    const t = setup(); await t.run(""); await t.run("status"); t.decline(); await t.run("start");
    expect([t.launches, t.keyCalls, t.starts]).toEqual([0, 0, 0]);
    expect(t.notices.join(" ")).toContain("No key, network, microphone");
  });
  test("full duplex, bounded frames, interruption flushes but turnComplete does not", async () => {
    const t = setup(); await t.run("start");
    expect([t.launches, t.keyCalls, t.starts]).toEqual([1, 1, 1]);
    t.voice.onInputTranscript?.({ text: "hello\x1b[2J\nworld" });
    t.voice.onOutputTranscript?.({ text: "reply\u202eok" }, 0);
    expect(t.widgets.at(-1)?.join(" ")).toContain("You: hello [2J world");
    expect(t.widgets.at(-1)?.join(" ")).not.toContain("\x1b");
    t.voice.onAudio?.(Buffer.alloc(20000).toString("base64"), 0); await tick();
    expect(t.played.map((p) => p.length)).toEqual([9600, 9600, 800]);
    t.capture.capture?.(Buffer.alloc(640)); expect(t.sends).toBe(1);
    t.voice.onTurnComplete?.(0); expect(t.flushes).toEqual([]);
    t.voice.onInterrupted?.(1); expect(t.flushes).toEqual([1]);
    t.voice.onAudio?.(Buffer.alloc(960).toString("base64"), 0);
    t.voice.onAudio?.(Buffer.alloc(960).toString("base64"), 1); await tick();
    expect(t.played.at(-1)?.generation).toBe(1);
    expect(t.status.at(-1)).toContain("gemini-3.8-live");
    await t.run("stop"); expect(t.status.at(-1)).toBeUndefined(); expect(t.widgets.at(-1)).toBeUndefined();
  });
  test("stop while helper hello is pending disposes late helper without key or device", async () => {
    const t = setup(); t.defer(); const starting = t.run("start"); await tick();
    await t.run("stop"); t.resolveLaunch(); await starting;
    expect([t.keyCalls, t.starts, t.closes]).toEqual([0, 0, 1]);
  });
  test("provider rejection and helper error tear down without exposing error text", async () => {
    const t = setup(); t.reject(); await t.run("start");
    expect(t.starts).toBe(0); expect(t.closes).toBe(1);
    expect(t.notices.join(" ")).not.toContain("SECRET");
    await t.run("start"); t.capture.error?.("bad", "SECRET");
    expect(t.notices.join(" ")).not.toContain("SECRET");
    expect(t.status.at(-1)).toBeUndefined();
  });
  test("provider output during setup is held until audio ready; overflow fails visibly", async () => {
    const t = setup();
    const originalStart = t.audio.start;
    t.audio.start = async () => { t.voice.onAudio?.(Buffer.alloc(9600).toString("base64"), 0); await originalStart(); };
    await t.run("start"); await tick();
    expect(t.played.map((p) => p.length)).toEqual([9600]);
    t.voice.onAudio?.(Buffer.alloc(96000).toString("base64"), 0);
    t.voice.onAudio?.(Buffer.alloc(96000).toString("base64"), 0);
    expect(t.status.at(-1)).toBeUndefined();
    expect(t.notices.join(" ")).toContain("backlog exceeded");
  });
  test("platform gate precedes consent, and session shutdown stops without touching agent", async () => {
    const t = setup({ local: () => false }); await t.run("start"); expect(t.launches).toBe(0);
    const x = setup(); await x.run("start"); x.shutdown(); expect(x.status.at(-1)).toBeUndefined();
  });
});
