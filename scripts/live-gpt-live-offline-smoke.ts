/** Loopback only; fake key, no capture/playback devices or external services.
 * bun scripts/live-gpt-live-offline-smoke.ts
 * bun build --compile scripts/live-gpt-live-offline-smoke.ts --outfile /tmp/die-gpt-live-smoke
 */
import { GPTLiveSession } from "../src/live/gpt-live-session";
import { GptLivePlaybackRecovery } from "../src/live/gpt-live-playback";
import { GptLiveDelegationBridge } from "../src/live/gpt-live-delegation";
let configured = false,
  input = 0,
  commentary = false,
  dispatches = 0,
  played = 0,
  flushed = 0;
const playback = new GptLivePlaybackRecovery({
  send: async () => {
    played++;
  },
  flush: async () => {
    flushed++;
  },
  onError: (e) => {
    throw e;
  },
});
const bridge = new GptLiveDelegationBridge({
  context: () => ({ recent: [{ role: "user", text: "inspect project" }] }),
  submitContextual: async (_id, snapshot) => {
    if (!snapshot.uncertain || snapshot.fragments[0]?.text !== "inspect project") throw Error("bad snapshot");
    dispatches++;
    return { queued: true };
  },
});
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req, s) {
    if (req.headers.get("authorization") !== "Bearer fake-offline-only") throw Error("fake auth missing");
    if (s.upgrade(req)) return;
    return new Response("no", { status: 400 });
  },
  websocket: {
    message(ws, data) {
      const m = JSON.parse(String(data));
      if (m.type === "session.start") {
        if (
          m.session.model !== "gpt-live-1" ||
          m.session.audio.format.rate !== 24000 ||
          m.session.delegation.type !== "client"
        )
          throw Error("config");
        configured = true;
        ws.send(
          JSON.stringify({
            type: "session.started",
            session: { id: "smoke", model: "gpt-live-1", delegation: { type: "client" } },
          }),
        );
        ws.send(
          JSON.stringify({ type: "session.input_transcript.delta", delta: "inspect project", start_ms: 0, end_ms: 80 }),
        );
        ws.send(
          JSON.stringify({
            type: "session.delegation.created",
            delegation: { id: "d", target: "client", type: "delegation" },
            offset_ms: 100,
          }),
        );
        ws.send(JSON.stringify({ type: "session.output_audio.delta", delta: Buffer.alloc(960).toString("base64") }));
      }
      if (m.type === "session.input_audio.append") input++;
      if (m.type === "session.commentary.append") commentary = m.delegation_id === "d";
      if (m.type === "session.close") ws.send(JSON.stringify({ type: "session.closed", usage: {} }));
    },
  },
});
const errors: string[] = [];
const voice = new GPTLiveSession(
  {
    onInputTranscript: (f) => bridge.addFragment({ text: f.delta, startMs: f.startMs, endMs: f.endMs }),
    onDelegation: (d) => {
      void bridge.handleCreated(d).then((r) => {
        if (r.kind === "queued") voice.commentary(d.id, r.commentary);
      });
    },
    onAudio: (p) => {
      playback.output(Buffer.from(p));
    },
    onError: (e) => errors.push(e),
  },
  (_url, headers) => new WebSocket("ws://127.0.0.1:" + server.port, { headers } as unknown as string[]),
);
try {
  playback.start();
  await voice.connect("fake-offline-only");
  await Bun.sleep(30);
  const loud = Buffer.alloc(640);
  for (let i = 0; i < loud.length; i += 2) loud.writeInt16LE(2300, i);
  for (let i = 0; i < 4; i++) {
    playback.capture(loud);
    voice.appendMicrophone(loud);
  }
  await Bun.sleep(20);
  if (
    !configured ||
    input !== 4 ||
    !commentary ||
    dispatches !== 1 ||
    played !== 1 ||
    flushed !== 1 ||
    !playback.needsRetry ||
    errors.length
  )
    throw Error(
      "GPT-Live integration smoke failed: " +
        JSON.stringify({ configured, input, commentary, dispatches, played, flushed, errors }),
    );
  await voice.close();
  console.log("GPT-Live loopback handshake/PCM/delegation/local interruption/close passed; no external API or devices");
} finally {
  bridge.close();
  playback.close();
  await voice.close();
  server.stop(true);
}
