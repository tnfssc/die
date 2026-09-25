import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { OpenAIRealtimeSession, type RealtimeSocket } from "../src/live/openai-session";
import { orchestrationTools } from "../src/live/orchestration";
import liveSystemInstruction from "../src/prompts/live.md" with { type: "text" };

// Deliberately strict contract for the subset die sends, not a claim to implement
// the entire GA API. Source: openai-node/src/resources/realtime/realtime.ts,
// RealtimeSessionCreateRequest / RealtimeAudioFormats (checked 2026-09-24).
// The SDK types mark rate optional, but the live mini endpoint rejected an omitted
// session.audio.output.format.rate with missing_required_parameter (2026-09-24).
const pcm = z.strictObject({ type: z.literal("audio/pcm"), rate: z.literal(24000).optional() });
const property: z.ZodType = z.lazy(() =>
  z.union([
    z.strictObject({ type: z.literal("string"), minLength: z.number().optional(), maxLength: z.number().optional() }),
    z.strictObject({ type: z.literal("integer"), minimum: z.number().optional(), maximum: z.number().optional() }),
    z.strictObject({ anyOf: z.array(property).min(1) }),
  ]),
);
const setup = z.strictObject({
  type: z.literal("session.update"),
  session: z.strictObject({
    type: z.literal("realtime"),
    instructions: z.string(),
    audio: z.strictObject({
      input: z.strictObject({
        format: pcm,
        transcription: z.strictObject({ model: z.literal("gpt-4o-mini-transcribe") }),
        turn_detection: z.strictObject({
          type: z.literal("server_vad"),
          create_response: z.boolean(),
          interrupt_response: z.boolean(),
        }),
      }),
      output: z.strictObject({
        format: z.strictObject({ type: z.literal("audio/pcm"), rate: z.literal(24000) }),
        voice: z.literal("marin"),
      }),
    }),
    output_modalities: z.tuple([z.literal("audio")]),
    tools: z.array(
      z.strictObject({
        type: z.literal("function"),
        name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
        description: z.string(),
        parameters: z.strictObject({
          type: z.literal("object"),
          properties: z.record(z.string(), property),
          required: z.array(z.string()),
          additionalProperties: z.literal(false),
        }),
      }),
    ),
    tool_choice: z.literal("auto"),
  }),
});

class SchemaSocket implements RealtimeSocket {
  readyState = 1;
  events: any[] = [];
  listeners = new Map<string, (event: any) => void>();
  constructor(private mutate: (value: any) => void = () => {}) {}
  addEventListener(type: string, handler: (event: any) => void) {
    this.listeners.set(type, handler);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.listeners.get("open")?.({});
  }
  send(data: string) {
    const value = JSON.parse(data);
    this.mutate(value);
    this.events.push(value);
    const result = setup.safeParse(value);
    // Deliver like a server event, not synchronously inside send().
    queueMicrotask(() =>
      this.listeners.get("message")?.({
        data: JSON.stringify(
          result.success
            ? { type: "session.updated", session: value.session }
            : {
                type: "error",
                error: {
                  type: "invalid_request_error",
                  code: "invalid_value",
                  param: result.error.issues[0].path.join("."),
                  message: "PRIVATE PROVIDER MESSAGE",
                },
              },
        ),
      }),
    );
  }
}
function connect(
  mutate?: (value: any) => void,
  model: "gpt-realtime-2.1" | "gpt-realtime-2.1-mini" = "gpt-realtime-2.1-mini",
) {
  const socket = new SchemaSocket(mutate);
  const errors: any[] = [];
  let ready = 0;
  const session = new OpenAIRealtimeSession(
    { onReady: () => ready++, onError: (error) => errors.push(error) },
    () => socket,
    { tools: orchestrationTools, userTranscript: () => {}, execute: async () => ({}) },
    model,
  );
  const pending = session.connect("offline-placeholder");
  socket.open();
  return {
    socket,
    session,
    errors,
    pending,
    get ready() {
      return ready;
    },
  };
}

describe("OpenAI GA setup schema contract (offline)", () => {
  for (const model of ["gpt-realtime-2.1", "gpt-realtime-2.1-mini"] as const) {
    test(model + " sends the complete supported setup with actual orchestration tools", async () => {
      const f = connect(undefined, model);
      await f.pending;
      expect(f.session.state).toBe("ready");
      expect(f.ready).toBe(1);
      expect(f.errors).toEqual([]);
      expect(f.socket.events[0].session.instructions).toBe(liveSystemInstruction);
      expect(f.socket.events[0].session.tools).toEqual(
        orchestrationTools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.parametersJsonSchema,
        })),
      );
      f.session.close();
    });
  }
  test("output PCM rate is present on the real setup payload", async () => {
    const f = connect();
    await f.pending;
    expect(f.socket.events[0].session.audio.output.format.rate).toBe(24000);
    f.session.close();
  });
  for (const [name, mutate] of [
    [
      "missing output PCM rate",
      (v: any) => {
        delete v.session.audio.output.format.rate;
      },
    ],
    [
      "wrong PCM rate",
      (v: any) => {
        v.session.audio.output.format.rate = 16000;
      },
    ],
    [
      "beta-era top-level field",
      (v: any) => {
        v.session.output_audio_format = "pcm16";
      },
    ],
    [
      "invalid tool name",
      (v: any) => {
        v.session.tools[0].name = "functions.bad name";
      },
    ],
    [
      "invalid tool schema",
      (v: any) => {
        v.session.tools[0].parameters.type = "OBJECT";
      },
    ],
    [
      "mixed output modalities",
      (v: any) => {
        v.session.output_modalities = ["text", "audio"];
      },
    ],
    [
      "invalid tool choice",
      (v: any) => {
        v.session.tool_choice = "any";
      },
    ],
    [
      "invalid transcription config",
      (v: any) => {
        v.session.audio.input.transcription = { model: "not-a-transcription-model" };
      },
    ],
  ] as const) {
    test("schema fixture rejects " + name + " rather than blindly acknowledging", async () => {
      const f = connect(mutate);
      await f.pending;
      expect(f.session.state).toBe("closed");
      expect(f.ready).toBe(0);
      expect(f.errors).toHaveLength(1);
      expect(f.errors[0].code).toBe("connect_failed");
      expect(f.errors[0].message).toContain("code invalid_value");
      expect(f.errors[0].message).toContain("type invalid_request_error");
      if (name === "wrong PCM rate") expect(f.errors[0].message).toContain("field session.audio.output.format.rate");
      if (name === "invalid tool name") expect(f.errors[0].message).toContain("field session.tools[0].name");
      expect(JSON.stringify(f.errors)).not.toContain("PRIVATE PROVIDER MESSAGE");
    });
  }
});
