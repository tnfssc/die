import { describe, expect, test } from "bun:test";
import type { RealtimeSocket } from "../src/live/openai-session";
import type { VoiceOrchestration } from "../src/live/types";
import { createWebProviderFactory } from "../src/live/web-providers";

class Socket implements RealtimeSocket {
  readyState = 1;
  bufferedAmount = 0;
  private listeners = new Map<string, ((event: any) => void)[]>();
  send(_data: string): void {}
  close(): void {
    this.readyState = 3;
  }
  addEventListener(type: "open" | "message" | "error" | "close", fn: (event: any) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, value: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(value) });
  }
  ready(): void {
    for (const fn of this.listeners.get("open") ?? []) fn({});
    this.emit("message", { type: "session.updated" });
  }
}

describe("web provider selection", () => {
  test("rejects GPT-Live, unknown models and Gemini while upstream queue is unbounded", () => {
    expect(() => createWebProviderFactory("openai", "gpt-live-1")).toThrow();
    expect(() => createWebProviderFactory("openai", "gpt-realtime-fake")).toThrow();
    expect(() => createWebProviderFactory("google", "gemini-3.8-live")).toThrow(/upstream audio buffering/);
  });

  test("OpenAI GA authorizes once by input item, never via relay display accumulator", async () => {
    for (const model of ["gpt-realtime-2.1", "gpt-realtime-2.1-mini"]) {
      const socket = new Socket();
      const authoritative: string[] = [];
      const relayed: string[] = [];
      const orchestration: VoiceOrchestration = {
        tools: [],
        userTranscript: (text) => authoritative.push(text),
        beginUserTurn: () => {},
        execute: async () => ({}),
      };
      let url = "";
      const factory = createWebProviderFactory("openai", model, (u) => {
        url = u;
        return socket;
      });
      const provider = factory({ onInputTranscript: (t) => relayed.push(t.text) }, orchestration);
      const connecting = provider.connect("fake-only");
      socket.ready();
      await connecting;
      expect(new URL(url).searchParams.get("model")).toBe(model);
      socket.emit("message", {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "stale",
        transcript: "stale",
      });
      expect(authoritative).toEqual([]);
      socket.emit("message", { type: "input_audio_buffer.committed", item_id: "current" });
      socket.emit("message", {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "current",
        transcript: "Please help",
      });
      socket.emit("message", {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "current",
        transcript: "Please help",
      });
      expect(authoritative).toEqual(["Please help"]);
      expect(relayed).toEqual([]);
      provider.close();
    }
  });
});
