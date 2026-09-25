import { expect, test } from "bun:test";
import { createServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { createWebProviderFactory } from "../src/live/web-providers";
import { upgradeSocket } from "../src/live/openai-upgrade-socket";
import type { VoiceOrchestration } from "../src/live/types";

const orchestration: VoiceOrchestration = {
  tools: [],
  userTranscript() {},
  beginUserTurn() {},
  execute: async () => ({}),
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("web OpenAI shutdown waits for real peer close after connected session", async () => {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  let peer!: WebSocket;
  let closed = false;
  server.on("connection", (ws) => {
    peer = ws;
    ws.on("close", () => {
      closed = true;
    });
    ws.on("message", () => ws.send(JSON.stringify({ type: "session.updated" })));
  });
  try {
    const provider = createWebProviderFactory("openai", "gpt-realtime-2.1", (_url, headers) =>
      upgradeSocket("ws://127.0.0.1:" + port, headers),
    )({}, orchestration) as ReturnType<ReturnType<typeof createWebProviderFactory>> & { shutdown(): Promise<void> };
    await provider.connect("local-only");
    await provider.shutdown();
    for (let i = 0; i < 100 && !closed; i++) await wait(10);
    expect(peer.readyState).toBe(WebSocket.CLOSED);
    expect(closed).toBe(true);
  } finally {
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("web OpenAI shutdown terminates pending upgrade and waits for actual close", async () => {
  const server = createServer();
  let requestSocket: import("node:net").Socket | undefined;
  let peerClosed = false;
  server.on("upgrade", (req) => {
    requestSocket = req.socket;
    req.socket.on("close", () => {
      peerClosed = true;
    });
    // Deliberately never send the upgrade response.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const provider = createWebProviderFactory("openai", "gpt-realtime-2.1", (_url, headers) =>
      upgradeSocket("ws://127.0.0.1:" + port, headers),
    )({}, orchestration) as ReturnType<ReturnType<typeof createWebProviderFactory>> & { shutdown(): Promise<void> };
    const connecting = provider.connect("local-only");
    for (let i = 0; i < 100 && !requestSocket; i++) await wait(10);
    expect(requestSocket).toBeDefined();
    await provider.shutdown();
    await connecting;
    for (let i = 0; i < 100 && !peerClosed; i++) await wait(10);
    expect(peerClosed).toBe(true);
  } finally {
    requestSocket?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("injected socket does not verify shutdown from synchronous close alone", async () => {
  let closeObserved = false;
  let closeListener: ((event: unknown) => void) | undefined;
  const socket = {
    readyState: 1,
    send() {},
    close() {
      setTimeout(() => {
        socket.readyState = 3;
        closeObserved = true;
        closeListener?.({});
      }, 30);
    },
    addEventListener(type: string, listener: (event: unknown) => void) {
      if (type === "close") closeListener = listener;
    },
  };
  const provider = createWebProviderFactory(
    "openai",
    "gpt-realtime-2.1",
    () => socket,
  )({}, orchestration) as ReturnType<ReturnType<typeof createWebProviderFactory>> & { shutdown(): Promise<void> };
  const connecting = provider.connect("local-only");
  const shutdown = provider.shutdown();
  expect(closeObserved).toBe(false);
  await shutdown;
  await connecting;
  expect(closeObserved).toBe(true);
});
