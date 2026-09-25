import WebSocket from "ws";
import type { LiveAdapter, LiveParams, LiveConnection } from "./types";

/** Gemini Developer API Live WebSocket (not Vertex). The pinned SDK 2.24.0
 * uses this endpoint and ?key= for API-key authentication. The key remains
 * server-side; never pass this URL to a browser or log it.
 * https://ai.google.dev/gemini-api/docs/live-api/websocket-api
 */
const ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const MAX_BUFFER = 256 * 1024;
const MAX_INBOUND = 1024 * 1024;
export type GeminiSocketFactory = (url: string, options: WebSocket.ClientOptions) => WebSocket;

export function webGeminiAdapter(
  socketFactory: GeminiSocketFactory = (url, options) => new WebSocket(url, options),
  endpoint = ENDPOINT,
): LiveAdapter & { shutdown(): Promise<void> } {
  const sockets = new Set<WebSocket>();
  const shutdown = async () => {
    const pending = [...sockets];
    for (const socket of pending) socket.terminate();
    await Promise.all(
      pending.map((socket) =>
        socket.readyState === WebSocket.CLOSED
          ? Promise.resolve()
          : new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("Gemini socket shutdown timed out")), 3000);
              socket.once("close", () => {
                clearTimeout(timer);
                resolve();
              });
            }),
      ),
    );
  };
  const adapter: LiveAdapter = (apiKey) =>
    ({
      live: {
        connect: (params: LiveParams): Promise<LiveConnection> => {
          const url = new URL(endpoint);
          url.searchParams.set("key", apiKey);
          const socket = socketFactory(url.toString(), { maxPayload: MAX_INBOUND, handshakeTimeout: 10000 });
          sockets.add(socket);
          socket.once("close", () => sockets.delete(socket));
          let active = true;
          let ready = false;
          let settled = false;
          const send = (message: unknown) => {
            if (!active || socket.readyState !== WebSocket.OPEN) throw new Error("Gemini socket closed");
            const data = JSON.stringify(message);
            const bytes = Buffer.byteLength(data);
            // Account for all queued traffic, not just microphone audio. Do not
            // drop tool replies or context silently: fail the session instead.
            if (bytes > MAX_BUFFER || socket.bufferedAmount > MAX_BUFFER - bytes) {
              throw new Error("Gemini upstream backpressure limit exceeded");
            }
            socket.send(data, (error) => {
              if (error && active) {
                socket.emit("error", error);
              }
            });
          };
          const connection = {
            sendRealtimeInput: (input: { audio?: { data?: string; mimeType?: string }; audioStreamEnd?: boolean }) =>
              send({ realtimeInput: input }),
            sendClientContent: (input: { turns?: unknown; turnComplete?: boolean }) =>
              send({ clientContent: { turns: input.turns, turnComplete: input.turnComplete ?? true } }),
            sendToolResponse: (input: { functionResponses: unknown }) =>
              send({
                toolResponse: {
                  functionResponses: Array.isArray(input.functionResponses)
                    ? input.functionResponses
                    : [input.functionResponses],
                },
              }),
            close: () => {
              active = false;
              socket.terminate();
            },
          } as LiveConnection;
          return new Promise<LiveConnection>((resolve, reject) => {
            const setupTimer = setTimeout(() => fail(new Error("Gemini setup timeout")), 14000);
            setupTimer.unref?.();
            const fail = (error: Error) => {
              if (!active) return;
              active = false;
              socket.terminate();
              if (!settled) {
                settled = true;
                clearTimeout(setupTimer);
                reject(error);
              } else params.callbacks.onerror?.({ error } as ErrorEvent);
            };
            socket.on("open", () => {
              try {
                const config = params.config;
                if (
                  !config ||
                  typeof config.systemInstruction !== "string" ||
                  config.responseModalities?.length !== 1 ||
                  config.responseModalities[0] !== "AUDIO"
                )
                  throw new Error("Unsupported Gemini Live setup");
                // Matches @google/genai 2.24.0 liveConnectConfigToMldev:
                // responseModalities under generationConfig, other used fields under setup.
                send({
                  setup: {
                    model: params.model.startsWith("models/") ? params.model : "models/" + params.model,
                    generationConfig: { responseModalities: config.responseModalities },
                    systemInstruction: { role: "user", parts: [{ text: config.systemInstruction }] },
                    ...(config.tools ? { tools: config.tools } : {}),
                    inputAudioTranscription: config.inputAudioTranscription,
                    outputAudioTranscription: config.outputAudioTranscription,
                    realtimeInputConfig: config.realtimeInputConfig,
                  },
                });
              } catch (error) {
                fail(error as Error);
              }
            });
            socket.on("message", (raw, binary) => {
              if (!active) return;
              if (binary) {
                fail(new Error("Unexpected Gemini binary response"));
                return;
              }
              try {
                const message = JSON.parse(raw.toString());
                if (!message || typeof message !== "object" || Array.isArray(message))
                  throw new Error("Invalid Gemini message");
                if (!ready) {
                  if (!message.setupComplete) throw new Error("Expected Gemini setupComplete");
                  ready = true;
                  settled = true;
                  clearTimeout(setupTimer);
                  resolve(connection);
                } else params.callbacks.onmessage(message);
              } catch (error) {
                fail(error as Error);
              }
            });
            socket.on("error", (error) => fail(error));
            socket.on("close", () => {
              if (!active) return;
              active = false;
              if (!settled) {
                settled = true;
                clearTimeout(setupTimer);
                reject(new Error("Gemini socket closed before setup"));
              } else params.callbacks.onclose?.({} as CloseEvent);
            });
          });
        },
      },
    }) as unknown as ReturnType<LiveAdapter>;
  return Object.assign(adapter, { shutdown });
}
