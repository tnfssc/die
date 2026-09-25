import WebSocket from "ws";
import type { IncomingMessage } from "node:http";
import type { RealtimeSocket } from "./openai-session";

/** ws exposes the HTTP upgrade response; Bun's native WebSocket does not (Bun 1.4.2).
 * One authenticated Upgrade only, never a second REST probe. Nothing from the response
 * except its numeric status and an allowlisted error code reaches the caller.
 */
export function upgradeSocket(url: string, headers: Record<string, string>): RealtimeSocket {
  const ws = new WebSocket(url, { headers, handshakeTimeout: 15000, followRedirects: false });
  const listeners = new Map<string, Array<(event: any) => void>>();
  let rejection: IncomingMessage | undefined;
  let rejectionTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const emit = (type: string, event: unknown) => {
    for (const handler of listeners.get(type) ?? []) handler(event);
  };
  const reject = (status: number, code?: unknown) => {
    if (finished) return;
    finished = true;
    if (rejectionTimer) clearTimeout(rejectionTimer);
    emit("error", { status, providerCode: code, model: new URL(url).searchParams.get("model") });
    rejection?.destroy();
    ws.terminate();
  };
  ws.on("unexpected-response", (_request, response) => {
    rejection = response;
    const status = response.statusCode ?? 0;
    let bytes = 0;
    const chunks: Buffer[] = [];
    // Read at most 4 KiB; no raw response is logged or propagated.
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 4096) {
        reject(status);
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => {
      let code: unknown;
      try {
        code = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.error?.code;
      } catch {
        /* malformed */
      }
      reject(status, code);
    });
    response.on("error", () => reject(status));
    rejectionTimer = setTimeout(() => reject(status), 1000);
    rejectionTimer.unref?.();
  });
  ws.on("open", () => emit("open", {}));
  ws.on("message", (data, binary) => emit("message", { data: binary ? data : data.toString() }));
  ws.on("error", () => {
    if (!finished) emit("error", {});
  });
  ws.on("close", () => {
    if (!rejection && !finished) emit("close", {});
  });
  let shutdownPromise: Promise<void> | undefined;
  const close = () => {
    if (rejectionTimer) clearTimeout(rejectionTimer);
    rejection?.destroy();
    if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    else ws.close();
  };
  return {
    get readyState() {
      return ws.readyState;
    },
    get bufferedAmount() {
      return ws.bufferedAmount;
    },
    send(data) {
      ws.send(data);
    },
    close,
    shutdown() {
      if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        let finalTimer: ReturnType<typeof setTimeout>;
        const done = () => {
          clearTimeout(timer);
          clearTimeout(finalTimer);
          resolve();
        };
        ws.once("close", done);
        // A peer may never complete the closing handshake. Terminate and still wait
        // for the actual close event before reporting shutdown to the root bridge.
        timer = setTimeout(() => {
          ws.terminate();
          finalTimer = setTimeout(() => {
            ws.off("close", done);
            reject(new Error("OpenAI socket shutdown not observed"));
          }, 1000);
        }, 1500);
        try {
          close();
        } catch {
          ws.terminate();
        }
      });
      return shutdownPromise;
    },
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
  };
}
