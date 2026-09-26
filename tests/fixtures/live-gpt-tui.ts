/** Offline TUI fixture: real Live extension/owner and Pi renderer; only provider and devices are fake. */
import liveExtension from "../../src/live/extension";

export default function (pi: any) {
  pi.on("session_start", (_event: any, ctx: any) => ctx.ui.notify("GPT FIXTURE LOADED", "info"));
  const fakePi = new Proxy(pi, {
    get(target, key) {
      if (key === "registerCommand") return (_name: string, command: any) => pi.registerCommand("gptflood", command);
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  liveExtension(fakePi, {
    local: () => true,
    config: { load: async () => ({ provider: "openai", model: "gpt-live-1" }), save: async () => {} },
    key: async () => "offline-fixture",
    audio: async () => ({
      diagnostics: { queuedMs: 0, captureFrames: 0, capturedBytes: 0 },
      start: async () => {},
      play: async () => {},
      flush: async () => {},
      stop: async () => {},
      close: async () => {},
    }),
    gptSession: (callbacks: any) => ({
      state: "ready",
      connect: async () => {
        setTimeout(() => {
          for (let n = 0; n < 24; n++)
            callbacks.onInputTranscript({ delta: "delta" + n + " ", startMs: n * 20, endMs: n * 20 + 10 });
          callbacks.onOutputTranscript({ delta: "provisional voice reply", startMs: 600, endMs: 650 });
        }, 350);
      },
      appendMicrophone: () => true,
      observation: () => true,
      commentary: () => true,
      close: async () => {},
    }),
  } as any);
}
