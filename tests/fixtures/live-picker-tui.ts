/** Offline credentials and config around the real Live extension; no audio/provider use. */
import liveExtension from "../../src/live/extension";

export default function (pi: any) {
  let config: any = { provider: "google", model: "gemini-3.8-live" };
  pi.on("session_start", (_event: any, ctx: any) => ctx.ui.notify("PICKER FIXTURE LOADED", "info"));
  const fakePi = new Proxy(pi, {
    get(target, key) {
      if (key === "registerCommand") return (_name: string, command: any) => pi.registerCommand("livepicker", command);
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  liveExtension(fakePi, {
    local: () => true,
    config: {
      load: async () => config,
      save: async (next: any) => {
        config = next;
      },
    },
    credentials: async (_signal: AbortSignal, provider: string) => ({
      status: async () =>
        provider === "google" ? { state: "oauth", canImport: false } : { state: "stored_api_key", canImport: false },
      loadKey: async () => {
        throw new Error("Fixture forbids provider connection");
      },
    }),
    key: async () => {
      throw new Error("Fixture forbids provider connection");
    },
    audio: async () => {
      throw new Error("Fixture forbids microphone access");
    },
    gptSession: () => {
      throw new Error("Fixture forbids session");
    },
    geminiSession: () => {
      throw new Error("Fixture forbids session");
    },
  } as any);
}
