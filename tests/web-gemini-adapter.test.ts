import { Modality } from "@google/genai";
import { expect, test } from "bun:test";
import WebSocket, { WebSocketServer } from "ws";
import { VoiceSession } from "../src/live/session";
import { webGeminiAdapter } from "../src/live/web-gemini-adapter";

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

test("loopback Live setup, server-only key, PCM16, context, tools, PCM24 and closure", async () => {
  const server = new WebSocketServer({ port: 0 });
  const port = (server.address() as { port: number }).port;
  const received: any[] = [];
  let url = "";
  let headers: unknown;
  let peer: WebSocket | undefined;
  server.on("connection", (socket, req) => {
    peer = socket;
    url = req.url!;
    headers = req.headers;
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      received.push(message);
      if (message.setup) socket.send(JSON.stringify({ setupComplete: {} }));
    });
  });
  const errors: string[] = [];
  const audio: string[] = [];
  const provider = new VoiceSession(
    { onAudio: (data) => audio.push(data), onError: (e) => errors.push(e.code) },
    webGeminiAdapter((u, opts) => new WebSocket(u, opts), "ws://127.0.0.1:" + port),
    {
      tools: [{ name: "session_context", description: "status" }],
      execute: async () => "ok",
      userTranscript: () => {},
      beginUserTurn: () => {},
    },
  );
  try {
    await provider.connect("secret-key");
    expect(provider.state).toBe("ready");
    expect(url).toContain("key=secret-key");
    expect(JSON.stringify(headers)).not.toContain("secret-key");
    expect(received[0].setup).toMatchObject({
      model: "models/gemini-3.8-live",
      generationConfig: { responseModalities: ["AUDIO"] },
      systemInstruction: { role: "user" },
      realtimeInputConfig: { automaticActivityDetection: { disabled: false } },
      tools: [{ functionDeclarations: [{ name: "session_context", behavior: "NON_BLOCKING" }] }],
    });
    provider.sendAudio(Buffer.alloc(3200).toString("base64"));
    provider.endAudio();
    provider.sendContext("test context");
    peer!.send(JSON.stringify({ toolCall: { functionCalls: [{ id: "tool-1", name: "session_context", args: {} }] } }));
    peer!.send(
      JSON.stringify({
        serverContent: {
          modelTurn: {
            parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: Buffer.alloc(480).toString("base64") } }],
          },
          turnComplete: true,
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(received[1].realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
    expect(received[2]).toEqual({ realtimeInput: { audioStreamEnd: true } });
    expect(
      received.some(
        (x) => x.clientContent?.turns?.[0].parts?.[0].text === "test context" && x.clientContent.turnComplete === false,
      ),
    ).toBe(true);
    expect(
      received.some(
        (x) =>
          x.toolResponse?.functionResponses?.[0]?.id === "tool-1" &&
          x.toolResponse.functionResponses[0].response.output === "ok",
      ),
    ).toBe(true);
    expect(audio).toHaveLength(1);
    peer!.close();
    await tick();
    expect(errors).toContain("disconnected");
    expect(provider.state).toBe("closed");
  } finally {
    provider.close();
    peer?.terminate();
    server.close();
  }
});

test("aggregate bufferedAmount gates audio, context and tool replies before send", async () => {
  const server = new WebSocketServer({ port: 0 });
  const port = (server.address() as { port: number }).port;
  let peer: WebSocket | undefined;
  server.on("connection", (socket) => {
    peer = socket;
    socket.on("message", (data) => {
      if (JSON.parse(data.toString()).setup) socket.send(JSON.stringify({ setupComplete: {} }));
    });
  });
  // Real loopback handshake, with a deliberately stalled transport accounting
  // value to deterministically test the boundary without depending on kernel speed.
  let upstream: WebSocket | undefined;
  const adapter = webGeminiAdapter((url, options) => {
    upstream = new WebSocket(url, options);
    return upstream;
  }, "ws://127.0.0.1:" + port);
  const errors: string[] = [];
  const provider = new VoiceSession({ onError: (e) => errors.push(e.code) }, adapter);
  try {
    await provider.connect("fake");
    Object.defineProperty(upstream!, "bufferedAmount", { configurable: true, get: () => 256 * 1024 });
    provider.sendAudio(Buffer.alloc(3200).toString("base64"));
    expect(errors).toContain("transport_error");
    expect(provider.state).toBe("closed");
  } finally {
    provider.close();
    peer?.terminate();
    server.close();
  }
});

test("context and tool traffic share the same hard upstream budget", async () => {
  const server = new WebSocketServer({ port: 0 });
  const port = (server.address() as { port: number }).port;
  let peer: WebSocket | undefined;
  server.on("connection", (socket) => {
    peer = socket;
    socket.on("message", (data) => {
      if (JSON.parse(data.toString()).setup) socket.send(JSON.stringify({ setupComplete: {} }));
    });
  });
  try {
    for (const kind of ["context", "tool"] as const) {
      let upstream: WebSocket | undefined;
      const adapter = webGeminiAdapter((url, opts) => (upstream = new WebSocket(url, opts)), "ws://127.0.0.1:" + port);
      const connection = await adapter("server-key").live.connect({
        model: "gemini-3.8-live",
        config: { systemInstruction: "test", responseModalities: [Modality.AUDIO] },
        callbacks: { onmessage: () => {} },
      });
      Object.defineProperty(upstream!, "bufferedAmount", { configurable: true, get: () => 256 * 1024 });
      expect(() =>
        kind === "context"
          ? connection.sendClientContent({ turns: [{ role: "user", parts: [{ text: "hello" }] }], turnComplete: false })
          : connection.sendToolResponse({ functionResponses: { id: "id", name: "test", response: {} } }),
      ).toThrow(/backpressure/);
      connection.close();
    }
  } finally {
    peer?.terminate();
    server.close();
  }
});

test("close before setup rejects without claiming readiness", async () => {
  const server = new WebSocketServer({ port: 0 });
  const port = (server.address() as { port: number }).port;
  server.on("connection", (socket) => socket.close());
  try {
    const provider = new VoiceSession(
      {},
      webGeminiAdapter((url, opts) => new WebSocket(url, opts), "ws://127.0.0.1:" + port),
    );
    await provider.connect("server-key");
    expect(provider.state).toBe("closed");
  } finally {
    server.close();
  }
});

test("pending Gemini setup is terminated and verified before shutdown returns", async () => {
  const server = new WebSocketServer({ port: 0 });
  const port = (server.address() as { port: number }).port;
  let peerClosed = false;
  server.on("connection", (socket) => {
    socket.on("close", () => {
      peerClosed = true;
    });
    // Deliberately never send setupComplete.
  });
  const adapter = webGeminiAdapter((url, opts) => new WebSocket(url, opts), "ws://127.0.0.1:" + port);
  try {
    const pending = adapter("offline").live.connect({
      model: "gemini-3.8-live",
      config: { systemInstruction: "test", responseModalities: [Modality.AUDIO] },
      callbacks: { onmessage() {} },
    });
    await new Promise<void>((resolve) => server.once("connection", () => resolve()));
    await adapter.shutdown();
    expect(
      await pending.then(
        () => "ready",
        () => "cancelled",
      ),
    ).toBe("cancelled");
    await tick();
    expect(peerClosed).toBe(true);
  } finally {
    await adapter.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
