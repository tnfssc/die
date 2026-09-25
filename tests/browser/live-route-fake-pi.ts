// Offline provider seam inside the REAL owning root bridge, reached over real FD3/FD4.
import { writeFileSync } from "node:fs";
import { attachSpawnWebVoiceIpc } from "../../src/live/web-ipc-bridge";
import { SessionHost } from "../../src/session/host";
import type { VoiceProvider } from "../../src/live/types";
const state = { providers: [] as string[], paidCalls: 0, uploadBytes: 0, stops: 0, rootBridge: true, jobsStopped: 0 };
const save = () => writeFileSync(process.env.DIE_FAKE_EVIDENCE!, JSON.stringify(state));
save();
const manager = {
  getSessionId: () => "fixture-session",
  getSessionFile: () => undefined,
  getBranch: () => [],
  getLeafId: () => null,
};
const host = new SessionHost({
  context: { sessionManager: manager } as any,
  tasks: {
    list: async () => ({ jobs: [] }),
    inspect: async () => undefined,
    stop: async () => {
      state.jobsStopped++;
      save();
    },
    localJobs: () => [],
    subscribe: () => () => {},
  },
  sendUserMessage: () => {},
  confirmStop: async () => false,
});
const bridge = attachSpawnWebVoiceIpc(() => host, {
  key: async () => {
    if (process.env.DIE_FAKE_MISSING) throw new Error("Offline missing credentials");
    return "offline-key";
  },
  factory: (provider) => (callbacks) => {
    const name = provider === "google" ? "gemini" : "openai";
    let closed = false;
    let reported = false;
    const fake = {
      state: "idle",
      generation: 0,
      async connect() {
        fake.state = "ready";
        if (!state.providers.includes(name)) state.providers.push(name);
        save();
      },
      sendContext() {
        if (reported) return;
        reported = true;
        // No artificial provider-ready delay. Root sends ready before this microtask's PCM.
        queueMicrotask(() => {
          if (!closed) callbacks.onAudio?.(Buffer.alloc(960).toString("base64"), 0);
        });
      },
      sendAudio(base64: string) {
        state.uploadBytes += Buffer.from(base64, "base64").length;
        save();
      },
      close() {
        closed = true;
        fake.state = "closed";
      },
      async shutdown() {
        closed = true;
        fake.state = "closed";
        await Bun.sleep(100); // ACK must wait for verified provider teardown.
        state.stops++;
        save();
      },
    };
    return fake as unknown as VoiceProvider;
  },
});
if (!bridge) throw new Error("Private bridge did not attach");
