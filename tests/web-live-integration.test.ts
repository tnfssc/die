import { expect, test } from "bun:test";
import { BrowserLiveController, type TransportMessage } from "../web/live/controller";
import { decodeRelayMessage } from "../web/live/protocol";
import { createWebLiveRelay } from "../src/live/web-relay";
import type { VoiceCallbacks, VoiceOrchestration } from "../src/live/types";

test("binary browser/relay loop: speech, concurrent host updates, interrupt, mute, end", async () => {
  let capture!: (frame: Uint8Array) => void;
  let browser!: (message: TransportMessage) => void;
  let receive!: (data: unknown) => void;
  let disconnect!: () => void;
  let update!: (data: any) => void;
  let callbacks!: VoiceCallbacks;
  let orchestration!: VoiceOrchestration;
  let ready = false,
    closed = 0,
    tracks = 0,
    audio = 0,
    unsubscribed = 0,
    clears = 0;
  const inputs: string[] = [],
    contexts: string[] = [],
    delegated: string[] = [];
  const relay = createWebLiveRelay({
    apiKey: "fake-key-not-a-credential",
    host: {
      context: () => ({ current: "same owning session" }),
      subscribe(fn) {
        update = fn;
        return () => {
          unsubscribed++;
        };
      },
      async send(_id, text) {
        delegated.push(text);
      },
      async steer() {},
      async list() {
        return [];
      },
      async inspect() {},
      async stop() {
        throw new Error("Speech/end must not stop work");
      },
    },
    transport: {
      bufferedAmount: 0,
      send(data) {
        browser(decodeRelayMessage(data));
      },
      close() {
        closed++;
      },
      onMessage(fn) {
        receive = fn;
        return () => {};
      },
      onClose(fn) {
        disconnect = fn;
        return () => {};
      },
    },
    providerFactory(cb, orch) {
      callbacks = cb;
      orchestration = orch;
      return {
        get state() {
          return ready ? "ready" : "idle";
        },
        generation: 0,
        turn: 0,
        async connect(key) {
          expect(key).toBe("fake-key-not-a-credential");
          ready = true;
        },
        sendAudio(data) {
          inputs.push(data);
        },
        endAudio() {},
        sendContext(data) {
          contexts.push(data);
        },
        close() {
          ready = false;
        },
      };
    },
  });
  const controller = new BrowserLiveController(
    {
      async acquire16k() {
        return {
          onPcm16(fn) {
            capture = fn;
            return () => {};
          },
          stop() {
            tracks++;
          },
        };
      },
    },
    {
      async connect() {
        return {
          queuedBytes: 0,
          onMessage(fn) {
            browser = fn;
            return () => {};
          },
          send16k(frame) {
            receive(frame);
          },
          sendControl(control) {
            receive(JSON.stringify(control));
          },
          close() {
            disconnect?.();
          },
        };
      },
    },
    () => ({
      queuedBytes: 0,
      enqueue24k() {
        audio++;
      },
      clear() {
        clears++;
      },
      stop() {},
    }),
  );
  await controller.start();
  await relay.start();
  expect(controller.state.phase).toBe("ready");
  capture(new Uint8Array([1, 0]));
  expect(inputs).toEqual(["AQA="]);
  callbacks.onInputTranscript?.({ text: "run ", finished: false });
  callbacks.onInputTranscript?.({ text: "tests", finished: true });
  await orchestration.execute({ name: "agent_send", args: { requestId: "speech-1" } });
  expect(delegated).toEqual(["run tests"]);
  update({ type: "assistant", text: "agent still running" });
  expect(contexts).toHaveLength(2);
  callbacks.onAudio?.("AQA=", 0);
  expect(audio).toBe(1);
  callbacks.onInterrupted?.(1);
  expect(clears).toBe(1);
  expect(controller.state.phase).toBe("ready");
  capture(new Uint8Array([2, 0]));
  expect(inputs).toHaveLength(2);
  callbacks.onAudio?.("AQA=", 0);
  expect(audio).toBe(1); // stale epoch dropped server-side
  callbacks.onAudio?.("AQA=", 1);
  expect(audio).toBe(2);
  controller.setMuted(true);
  capture(new Uint8Array([3, 0]));
  expect(inputs).toHaveLength(2);
  controller.end();
  expect(controller.state.phase).toBe("ended");
  expect([closed, tracks, unsubscribed]).toEqual([1, 1, 1]);
  await expect(orchestration.execute({ name: "jobs_list" })).rejects.toThrow("Voice session ended");
});

test("wire decoder rejects unbounded/malformed data and hides remote error text", () => {
  expect(() => decodeRelayMessage(new Uint8Array(9602))).toThrow();
  expect(() => decodeRelayMessage(new Uint8Array(3))).toThrow();
  expect(() => decodeRelayMessage("x".repeat(257))).toThrow();
  expect(() => decodeRelayMessage('{"type":"interrupted","epoch":0}')).toThrow();
  expect(decodeRelayMessage('{"type":"error","message":"secret"}')).toEqual({
    type: "error",
    reason: "Voice connection failed",
  });
});
