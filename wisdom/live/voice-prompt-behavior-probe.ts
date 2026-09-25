/** Paid, device-free diagnostic. Run from repo root:
 * bun wisdom/live/voice-prompt-behavior-probe.ts --paid manual weather|correction|save
 * Requires macOS say/afconvert; no installs, physical audio, or real host jobs.
 */
import { GoogleGenAI } from "@google/genai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import liveSystemInstruction from "../../src/prompts/live.md" with { type: "text" };
import { VoiceSession } from "../../src/live/session";
import { createOrchestration, boundedHostContext } from "../../src/live/orchestration";
import { createDefaultLiveCredentialService } from "../../src/live/credentials";
import { VOICE_MODEL, type LiveConnection, type LiveAdapter } from "../../src/live/types";
if (process.argv[2] !== "--paid" || !["manual", "automatic"].includes(process.argv[3]))
  throw new Error("Explicit --paid manual|automatic required");
const mode = process.argv[3];
const scenario = process.argv[4];
const phrases: Record<string, string> = {
  weather: "Can you check weather in Bengaluru today?",
  correction: "You said you only help with coding. Can you research something noncoding for me instead?",
  save: "Please save this conversation for me.",
};
if (!Object.hasOwn(phrases, scenario)) throw new Error("scenario weather|correction|save required");
const phrase = phrases[scenario];
const start = performance.now();
const log = (event: string, data: object = {}) =>
  console.log(JSON.stringify({ ms: Math.round(performance.now() - start), event, ...data }));
const dir = await mkdtemp(join(tmpdir(), "die-spoken-probe-"));
let voice: VoiceSession | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
try {
  for (const command of [
    ["/usr/bin/say", "-r", "175", "-o", join(dir, "speech.aiff"), phrase],
    [
      "/usr/bin/afconvert",
      "-f",
      "WAVE",
      "-d",
      "LEI16@16000",
      "-c",
      "1",
      join(dir, "speech.aiff"),
      join(dir, "speech.wav"),
    ],
  ]) {
    const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
    if ((await child.exited) !== 0) throw new Error("Speech synthesis failed");
  }
  const wav = Buffer.from(await Bun.file(join(dir, "speech.wav")).arrayBuffer());
  let pcm: Buffer | undefined;
  for (let i = 12; i + 8 <= wav.length; ) {
    const n = wav.readUInt32LE(i + 4);
    if (wav.toString("ascii", i, i + 4) === "data") {
      pcm = wav.subarray(i + 8, i + 8 + n);
      break;
    }
    i += 8 + n + (n % 2);
  }
  if (!pcm || pcm.length > 16 * 32000) throw new Error("Invalid or oversized synthetic audio");
  log("fixture", { scenario, mode, model: VOICE_MODEL, phrase, pcmBytes: pcm.length, sampleRate: 16000 });
  const credentials = await createDefaultLiveCredentialService();
  const key = await credentials.loadKey(); // Never log key or credential object.
  let hostCalls = 0;
  const host = {
    async send(requestId: string, text: string) {
      hostCalls++;
      log("host_send", { requestId, text });
      return {
        status: "captured_only",
        noJobCreated: true,
        message: "Probe captured request; no export or research was performed.",
      };
    },
    async steer(requestId: string, text: string) {
      hostCalls++;
      log("host_steer", { requestId, text });
      return {
        status: "captured_only",
        noJobCreated: true,
        message: "Probe captured request; no export or research was performed.",
      };
    },
    async list() {
      log("host_list");
      return { jobs: [] };
    },
    async inspect() {
      return { error: "No probe jobs" };
    },
    async stop() {
      return { error: "Disabled in probe" };
    },
    context() {
      return {
        configuredAgent: {
          name: "die",
          status: "connected",
          role: "general-purpose agent for research, files, and tools",
          permissions: "current user and host permissions",
        },
        jobs: [],
        ...(scenario === "save"
          ? { conversationRecord: "User: Please remember my planning notes. Assistant: I can help plan." }
          : {}),
      };
    },
    subscribe() {
      return () => {};
    },
  };
  const orchestration = createOrchestration(host);
  let connection: LiveConnection | undefined;
  let envelope = 0;
  const adapter: LiveAdapter = (apiKey) => ({
    live: {
      connect: async (params) => {
        const config = params.config!;
        log("setup", {
          instructionSha256: createHash("sha256").update(String(config.systemInstruction)).digest("hex"),
          sourceInstructionSha256: createHash("sha256").update(liveSystemInstruction).digest("hex"),
          toolNames: config.tools?.flatMap((t: any) => t.functionDeclarations?.map((d: any) => d.name) ?? []),
        });
        const sdk = new GoogleGenAI({ apiKey });
        const original = params.callbacks.onmessage;
        if (mode === "manual") params.config!.realtimeInputConfig = { automaticActivityDetection: { disabled: true } };
        params.callbacks.onmessage = (message) => {
          envelope++;
          const c = message.serverContent;
          if (c?.inputTranscription)
            log("wire_input", {
              envelope,
              text: c.inputTranscription.text,
              rawFinished: c.inputTranscription.finished ?? "absent",
            });
          if (message.toolCall) log("wire_tools", { envelope, calls: message.toolCall.functionCalls });
          if (c?.outputTranscription?.text) log("wire_output", { envelope, text: c.outputTranscription.text });
          if (c?.turnComplete || c?.interrupted)
            log("wire_boundary", { envelope, turnComplete: c.turnComplete, interrupted: c.interrupted });
          original(message);
        };
        connection = await sdk.live.connect(params);
        const send = connection.sendToolResponse.bind(connection);
        connection.sendToolResponse = (response) => {
          log("tool_response", { response });
          send(response);
        };
        return connection;
      },
    },
  });
  let input = "";
  voice = new VoiceSession(
    {
      onState: (state) => log("state", { state }),
      onError: (error) => log("error", { code: error.code }),
      onInputActivity: () => {
        orchestration.beginUserTurn?.();
        input = "";
        log("input_activity");
      },
      onInterrupted: () => {
        orchestration.beginUserTurn?.();
        input = "";
      },
      // Match production Run capture wiring; called ONLY by real VoiceSession/provider.
      onInputTranscript: (t) => {
        log("normalized_input", { ...t, rawFinished: t.rawFinished ?? "absent" });
        if (t.finalitySource === "model_contract") input = "";
        if (!input && t.text) orchestration.beginUserTurn?.();
        input = (input + t.text).slice(0, 4001);
        if (t.finished) {
          orchestration.userTranscript(input);
          log("capture_committed", { text: input });
          input = "";
        }
      },
      onTurnComplete: (turn) => log("turn_complete", { turn }),
      onOutputTranscript: (t) => log("normalized_output", { text: t.text, finished: t.finished ?? "absent" }),
      // Output audio deliberately discarded. No playback helper/devices.
    },
    adapter,
    orchestration,
  );
  const finished = new Promise<void>((resolve) => {
    deadline = setTimeout(() => {
      voice?.close();
      resolve();
    }, 30_000);
  });
  await voice.connect(key);
  if (voice.state === "ready") {
    voice.sendContext(boundedHostContext(host.context()));
    await Bun.sleep(400);
    if (mode === "manual") {
      connection!.sendRealtimeInput({ activityStart: {} });
      log("manual_activity_start");
    }
    const samples = Buffer.concat([Buffer.alloc(3200), pcm, Buffer.alloc(9600)]);
    for (let i = 0; i < samples.length && voice.state === "ready"; i += 640) {
      const frame = Buffer.alloc(640);
      samples.copy(frame, 0, i, Math.min(i + 640, samples.length));
      voice.sendAudio(frame.toString("base64"));
      await Bun.sleep(20);
    }
    if (voice.state === "ready") {
      if (mode === "manual") {
        connection!.sendRealtimeInput({ activityEnd: {} });
        log("manual_activity_end");
      } else {
        connection!.sendRealtimeInput({ audioStreamEnd: true });
        log("audio_stream_end");
      }
    }
  }
  await finished;
  log("summary", { hostCalls, diagnostics: voice.diagnostics });
} catch {
  log("probe_failed", { detail: "Error details suppressed to avoid credential/transport leakage" });
  process.exitCode = 1;
} finally {
  if (deadline) clearTimeout(deadline);
  voice?.close();
  await rm(dir, { recursive: true, force: true });
  log("temporary_audio_removed");
}
