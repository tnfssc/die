/** Chromium instrumentation for the canonical die web voice route.
 * This module never registers its own WebSocket endpoint or supplies fake media.
 * The acceptance runner must boot the shipped server with a fake owning Pi IPC peer.
 */
import { strict as assert } from "node:assert";

export type VoiceProbe = {
  mediaRequests: number;
  mediaTracks: number;
  tracksStopped: number;
  socketOpens: number;
  socketCloses: number;
  uploadFrames: number;
  uploadPayloadBytes: number;
  downloadFrames: number;
  downloadPayloadBytes: number;
};

export async function instrumentVoicePage(page: any, canonicalWsPath: string): Promise<VoiceProbe> {
  assert(canonicalWsPath.startsWith("/") && canonicalWsPath !== "/relay", "must target the shipped voice route");
  const probe: VoiceProbe = {
    mediaRequests: 0, mediaTracks: 0, tracksStopped: 0, socketOpens: 0, socketCloses: 0,
    uploadFrames: 0, uploadPayloadBytes: 0, downloadFrames: 0, downloadPayloadBytes: 0,
  };
  await page.exposeFunction("__dieVoiceObserveMedia", (kind: "request" | "track" | "stop") => {
    if (kind === "request") probe.mediaRequests++;
    else if (kind === "track") probe.mediaTracks++;
    else probe.tracksStopped++;
  });
  await page.addInitScript(() => {
    const devices = navigator.mediaDevices;
    const getUserMedia = devices.getUserMedia.bind(devices);
    Object.defineProperty(devices, "getUserMedia", {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        (window as any).__dieVoiceObserveMedia("request");
        const stream = await getUserMedia(constraints);
        for (const track of stream.getTracks()) {
          (window as any).__dieVoiceObserveMedia("track");
          const originalStop = track.stop.bind(track);
          track.stop = () => {
            if (track.readyState !== "ended") (window as any).__dieVoiceObserveMedia("stop");
            originalStop();
          };
        }
        return stream;
      },
    });
  });
  page.on("websocket", (socket: any) => {
    const url = new URL(socket.url());
    if (url.pathname !== canonicalWsPath) return;
    probe.socketOpens++;
    socket.on("close", () => probe.socketCloses++);
    for (const [event, frames, bytes] of [
      ["framesent", "uploadFrames", "uploadPayloadBytes"],
      ["framereceived", "downloadFrames", "downloadPayloadBytes"],
    ] as const) {
      socket.on(event, (frame: { payload: string | Buffer }) => {
        if (typeof frame.payload === "string") return; // Playwright frames omit opcode; text payloads are strings.
        probe[frames]++;
        const wireBytes = Buffer.byteLength(frame.payload);
        // The shipped uplink prefixes each 16kHz PCM frame with a one-byte kind tag.
        // Report PCM payload, not the wire header. Downlink is raw 24kHz PCM.
        if (event === "framesent") {
          assert(wireBytes > 1 && Buffer.from(frame.payload).at(0) === 1, "invalid canonical PCM uplink tag");
          probe[bytes] += wireBytes - 1;
        } else probe[bytes] += wireBytes;
      });
    }
  });
  return probe;
}

export function assertTeardown(probe: VoiceProbe): void {
  assert(probe.socketOpens > 0, "shipped voice route was never opened");
  assert.equal(probe.socketCloses, probe.socketOpens, "shipped voice sockets still open");
  assert(probe.mediaRequests > 0 && probe.mediaTracks > 0, "fake Chromium microphone never captured");
  assert.equal(probe.tracksStopped, probe.mediaTracks, "microphone track was not stopped");
  assert(probe.uploadFrames > 0 && probe.uploadPayloadBytes >= probe.uploadFrames * 5, "no binary microphone PCM sent");
}
