/** Offline compiled-provider smoke. Loopback only, fake key, no devices or external API.
 * bun build --compile scripts/live-openai-offline-smoke.ts --outfile /tmp/die-openai-smoke
 */
import { OpenAIRealtimeSession, defaultSocket } from "../src/live/openai-session";
let configured = false,
  audio = false;
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
      if (m.type === "session.update") {
        if (m.session.type !== "realtime" || m.session.audio.input.format.rate !== 24000) throw Error("config");
        configured = true;
        ws.send(JSON.stringify({ type: "session.updated" }));
      }
      if (m.type === "input_audio_buffer.append") audio = true;
    },
  },
});
const voice = new OpenAIRealtimeSession({}, (_url, headers) => defaultSocket("ws://127.0.0.1:" + server.port, headers));
try {
  await voice.connect("fake-offline-only");
  if (voice.state !== "ready" || !configured) throw Error("not ready");
  voice.sendAudio(Buffer.alloc(640).toString("base64"));
  await Bun.sleep(10);
  if (!audio) throw Error("no audio");
  console.log("Compiled OpenAI GA loopback setup/PCM/header passed (no external provider)");
} finally {
  voice.close();
  server.stop(true);
}

// Compiled transport must preserve HTTP rejection metadata without exposing response secrets.
for (const [status, code] of [
  [401, "invalid_api_key"],
  [403, "model_not_found"],
  [404, "model_not_found"],
  [429, "insufficient_quota"],
] as const) {
  const rejector = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      if (request.headers.get("authorization") !== "Bearer fake-offline-only") throw Error("auth missing");
      return new Response(JSON.stringify({ error: { code, message: "private-body" } }), {
        status,
        headers: { "X-Private": "fake-offline-only" },
      });
    },
  });
  const errors: string[] = [];
  const failed = new OpenAIRealtimeSession({ onError: (e) => errors.push(e.message) }, (_url, headers) =>
    defaultSocket("ws://127.0.0.1:" + rejector.port + "/v1/realtime?model=gpt-realtime-2.1", headers),
  );
  try {
    await failed.connect("fake-offline-only");
    if (
      errors.length !== 1 ||
      !errors[0].includes("HTTP " + status) ||
      errors[0].includes("private-body") ||
      errors[0].includes("fake-offline-only")
    )
      throw Error("unsafe or missing HTTP " + status + ": " + errors);
    if (status === 429 && !errors[0].includes("insufficient quota")) throw Error("missing allowlisted code");
  } finally {
    failed.close();
    rejector.stop(true);
  }
}
console.log("Compiled OpenAI upgrade rejections 401/403/404/429 passed (loopback only)");
