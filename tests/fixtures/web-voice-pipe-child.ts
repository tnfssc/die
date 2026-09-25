import { spawnSync } from "node:child_process";
import { attachSpawnWebVoiceIpc } from "../../src/live/web-ipc-bridge";

const report = (value: object) => process.stdout.write(JSON.stringify(value) + "\n");
const markers = () => [process.env.DIE_WEB_VOICE_FD, process.env.DIE_WEB_VOICE_OUTPUT_FD];
let revoked = 0;
let jobStops = 0;
let work = 0;
const job = setInterval(() => work++, 10);
const host = {
  lease: () => ({
    revoke: () => { revoked++; report({ event: "revoke" }); },
    valid: () => true,
    onRevoke: () => () => {},
    context: () => ({ source: "test", activeJobs: [] }),
    subscribe: () => () => {},
    stop: async () => { jobStops++; return { stopped: true }; },
  }),
} as any;
const bridge = attachSpawnWebVoiceIpc(() => host, {
  key: async (provider) => { report({ event: "key", provider }); return "offline-key"; },
  factory: (provider, model) => (callbacks) => ({
    state: "idle",
    generation: 0,
    async connect(key: string) {
      report({ event: "connect", provider, model, key });
      this.state = "ready";
      setTimeout(() => callbacks.onAudio?.(Buffer.from([0, 1, 254, 255]).toString("base64"), 0), 20);
    },
    sendContext() {},
    sendAudio(base64: string) { report({ event: "audio", base64 }); },
    close() { report({ event: "close" }); },
    shutdown: async () => {
      report({ event: "shutdown_pending" });
      await new Promise<void>((resolve) => { release = resolve; });
      report({ event: "shutdown_done" });
    },
  } as any),
});
let release: (() => void) | undefined;
report({ event: "boot", attached: !!bridge, markers: markers(), grandchildMarkers: JSON.parse(spawnSync(process.execPath, ["-e", "console.log(JSON.stringify([process.env.DIE_WEB_VOICE_FD, process.env.DIE_WEB_VOICE_OUTPUT_FD]))"], { encoding: "utf8" }).stdout) });
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
  if (data.includes("release")) { release?.(); release = undefined; }
  if (data.includes("work")) report({ event: "work", work, jobStops, revoked });
  if (data.includes("exit")) { clearInterval(job); process.exit(0); }
});
