/** Hidden CLI diagnostic: exercises the production default OpenAI socket on loopback only.
 * Deliberately does not instantiate the voice session (its production URL is fixed to
 * api.openai.com); no factory override, microphone, credentials, or provider access.
 */
import { defaultSocket, type RealtimeSocket } from "./openai-session";
import { connectionFailure } from "./openai-connect-error";
import { OPENAI_REALTIME_MODELS } from "./providers";

const KEY = "fake-offline-only";
const AUTH = "Bearer " + KEY;
const SECRET = "private-body-should-never-appear";
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function exercise(model: (typeof OPENAI_REALTIME_MODELS)[number], reject: boolean): Promise<void> {
  let received = false;
  let handshakes = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      handshakes++;
      const url = new URL(request.url);
      if (
        url.pathname !== "/v1/realtime" ||
        url.searchParams.get("model") !== model ||
        request.headers.get("authorization") !== AUTH ||
        request.headers.get("upgrade")?.toLowerCase() !== "websocket"
      ) {
        return new Response("bad fixture request", { status: 400 });
      }
      if (reject)
        return new Response(JSON.stringify({ error: { code: "invalid_api_key", message: SECRET } }), {
          status: 401,
          headers: { "content-type": "application/json", "x-private": SECRET },
        });
      if (server.upgrade(request)) return;
      return new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      message(ws, data) {
        const event = JSON.parse(String(data));
        if (
          event.type !== "session.update" ||
          event.session?.type !== "realtime" ||
          event.session?.audio?.input?.format?.rate !== 24000
        )
          throw new Error("Invalid session setup");
        received = true;
        ws.send(JSON.stringify({ type: "session.updated" }));
      },
    },
  });
  let socket: RealtimeSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The sole endpoint passed to the production transport is constructed from
    // Bun's loopback listener, never from argv, environment, or real API config.
    const url = "ws://127.0.0.1:" + server.port + "/v1/realtime?model=" + encodeURIComponent(model);
    socket = defaultSocket(url, { Authorization: AUTH });
    const result = await Promise.race([
      new Promise<string>((resolve, fail) => {
        socket!.addEventListener("open", () => {
          if (reject) return fail(new Error("401 unexpectedly upgraded"));
          socket!.send(
            JSON.stringify({
              type: "session.update",
              session: {
                type: "realtime",
                audio: { input: { format: { type: "audio/pcm", rate: 24000 } } },
              },
            }),
          );
        });
        socket!.addEventListener("message", (event) => {
          if (JSON.parse(event.data).type === "session.updated") resolve("ready");
          else fail(new Error("Unexpected session response"));
        });
        socket!.addEventListener("error", (event) => {
          if (!reject) return fail(new Error("Successful upgrade emitted an error"));
          const message = connectionFailure(event);
          if (
            !message.includes("HTTP 401") ||
            message.includes(SECRET) ||
            message.includes(KEY) ||
            message.includes("status unavailable")
          )
            return fail(new Error("Unsafe or missing 401 classification"));
          resolve("rejected");
        });
        socket!.addEventListener("close", () => fail(new Error("Socket closed before probe result")));
      }),
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => fail(new Error("Loopback transport timed out")), 4000);
      }),
    ]);
    assert(
      result === (reject ? "rejected" : "ready") && handshakes === 1 && received === !reject,
      "Handshake/session assertion failed",
    );
  } finally {
    if (timer) clearTimeout(timer);
    socket?.close();
    server.stop(true);
  }
}

export async function probeOpenAITransport(): Promise<void> {
  for (const model of OPENAI_REALTIME_MODELS) {
    await exercise(model, false);
    await exercise(model, true);
  }
  console.log("Offline OpenAI default transport: full/mini session.updated and HTTP 401 passed (loopback only)");
}
