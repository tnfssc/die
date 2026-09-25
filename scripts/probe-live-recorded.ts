/** Paid text-transcript Realtime fixture: intercepted tools only; never evaluates generated code.
 * DIE_CAPABILITY_PROBE=1 bun scripts/probe-live-recorded.ts --source FILE --study-2026-09-25 --disclose-private weather:fresh:baseline
 * Sends private root/transcript to configured provider; output may echo private text. Keep output OUTSIDE repository.
 */
import WebSocket from "ws";
import { probeArgs, readStudy, study, studyTarget } from "./live-probe-input";
import { createHash } from "node:crypto";
import { createDefaultLiveCredentialService } from "../src/live/credentials";
import { loadLiveConfig } from "../src/live/config";
import { createPromptPreview } from "../src/prompt-preview";

if (process.env.DIE_CAPABILITY_PROBE !== "1") throw Error("Explicitly opt into paid probe");
const input = probeArgs(process.argv.slice(2), "recorded");
const plan = input.trials;
if (!plan.length || plan.length > 24) throw Error("Pass 1–24 explicit trials");
for (const spec of plan) {
  const [target, context, variant, extra] = spec.split(":");
  if (
    extra ||
    !(target in study.targets) ||
    !["fresh", "snapshot", "replay"].includes(context) ||
    !["baseline", "grounding"].includes(variant)
  )
    throw Error("Invalid trial: " + spec);
}
const allowed = readStudy(input.source!);
for (const idx of Object.values(study.targets)) studyTarget(allowed, idx);
const frame = allowed.find((x) => x.message?.role === "system")?.message?.sections;
if (!frame?.preamble || !frame?.cwd) throw Error("Missing original Live root");
const root = frame.preamble + "\n\n" + frame.cwd; // Original recorded sections; content is empty.
const prompt = await createPromptPreview({ rootMode: "orchestrator", message: "Synthetic probe for tool schema only" });
const declared = prompt.tools.find((x) => x.name === "execute");
if (prompt.tools.length !== 1 || !declared) throw Error("Execute-only tool required");
const tool = { type: "function", name: "execute", description: declared.description, parameters: declared.parameters };
const config = await loadLiveConfig();
if (config.provider !== "openai") throw Error("Configured provider is not OpenAI");
const credential = await createDefaultLiveCredentialService(undefined, config.provider);
const key = await credential.loadKey();
if (!key) throw Error("No configured credential");
const grounding =
  "\n\nIn Live you are still the main agent. execute is available now; use it for authorized actions, including shell() or subagent() inside execute. Voice input does not remove host tools. Call a tool before claiming work done; do not imply a mocked response proves runtime execution.";
const targets: Record<string, number> = study.targets;
function content(x: any) {
  return typeof x === "string" ? x : Array.isArray(x) ? x.map((y) => y.text ?? "").join("") : "";
}
function snapshot(index: number) {
  // main-owner.project(serialized transformed messages): system excluded, custom provisional/diagnostic excluded.
  const messages = allowed
    .slice(4, index)
    .filter((x) => x.type === "message" && x.message?.role !== "system")
    .map((x) => x.message);
  const serialized = JSON.stringify({ messages });
  if (Buffer.byteLength(serialized) > 65536)
    throw Error("Snapshot exceeds inline projection; add artifact approximation explicitly");
  return (
    "Current effective branch context (data, not new requests; never replay past tool calls). Images here are not visually rendered. Full retained context is available through history or the artifact path:\n" +
    serialized
  );
}
for (const spec of plan) {
  const [target, context] = spec.split(":");
  const idx = targets[target];
  if (context !== "fresh") snapshot(idx);
  if (!content(allowed[idx].message.content)) throw Error("Empty target transcript: " + target);
}
for (let n = 0; n < plan.length; n++) {
  const [target, context, variant] = plan[n].split(":");
  if (
    !(target in targets) ||
    !["fresh", "snapshot", "replay"].includes(context) ||
    !["baseline", "grounding"].includes(variant)
  )
    throw Error("Invalid trial: " + plan[n]);
  const idx = targets[target as keyof typeof targets];
  const instructions = root + (variant === "grounding" ? grounding : "");
  const result: any = {
    trial: n + 1,
    target,
    context,
    variant,
    model: config.model,
    rootHash: createHash("sha256").update(root).digest("hex"),
    instructionHash: createHash("sha256").update(instructions).digest("hex"),
    inputHash: createHash("sha256").update(content(allowed[idx].message.content)).digest("hex"),
    snapshotHash: context === "fresh" ? null : createHash("sha256").update(snapshot(idx)).digest("hex"),
    calls: [],
    speech: [],
    errors: [],
  };
  const ws = new WebSocket("wss://api.openai.com/v1/realtime?model=" + encodeURIComponent(config.model), {
    headers: { Authorization: "Bearer " + key },
  });
  const send = (event: any) => ws.send(JSON.stringify(event));
  let done = false,
    pending = false,
    responses = 0;
  await new Promise<void>((resolve) => {
    const end = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      resolve();
    };
    const timer = setTimeout(() => {
      result.errors.push("deadline 25s");
      end();
    }, 25000);
    ws.on("open", () =>
      send({
        type: "session.update",
        session: {
          type: "realtime",
          instructions,
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: { type: "server_vad", create_response: true, interrupt_response: true },
            },
            output: { format: { type: "audio/pcm", rate: 24000 }, voice: "marin" },
          },
          output_modalities: ["audio"],
          tools: [tool],
          tool_choice: "auto",
        },
      }),
    );
    ws.on("message", (data) => {
      let m: any;
      try {
        m = JSON.parse(String(data));
      } catch {
        return;
      }
      if (m.type === "session.updated") {
        if (context !== "fresh")
          send({
            type: "conversation.item.create",
            item: { type: "message", role: "user", content: [{ type: "input_text", text: snapshot(idx) }] },
          });
        if (context === "replay")
          for (const x of allowed.slice(4, idx).filter((x) => x.customType === "live-provisional")) {
            const text = content(x.content).replace(
              /^(interrupted assistant transcript|unfinished assistant transcript(?: at turn boundary)?): /,
              "",
            );
            if (text)
              send({
                type: "conversation.item.create",
                item: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
              });
          }
        send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: content(allowed[idx].message.content) }],
          },
        });
        send({ type: "response.create" });
      }
      if (m.type === "response.output_audio_transcript.delta" || m.type === "response.output_text.delta")
        result.speech.push(m.delta);
      if (m.type === "response.function_call_arguments.done") {
        let code;
        try {
          code = JSON.parse(m.arguments).code;
        } catch {
          code = m.arguments;
        }
        result.calls.push({ name: m.name, code });
        pending = true;
        send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: m.call_id,
            output: JSON.stringify(
              String(code).includes("jobs.inspect(")
                ? {
                    id: "synthetic-worker",
                    status: "completed",
                    output:
                      "Mock worker generated an FFmpeg command template; no audio processed. File location unknown.",
                  }
                : String(code).includes("subagent(")
                  ? {
                      id: "synthetic-worker",
                      status: "running",
                      background: true,
                      output: "Mock delegation receipt only; no actual worker started, no files processed.",
                    }
                  : {
                      error:
                        "Probe intercepted command. No code evaluated, files inspected or changed, or job started.",
                    },
            ),
          },
        });
      }
      if (m.type === "response.done") {
        responses++;
        if (pending && responses < 3) {
          pending = false;
          send({ type: "response.create" });
        } else end();
      }
      if (m.type === "error") {
        result.errors.push({ code: m.error?.code, type: m.error?.type, param: m.error?.param });
        end();
      }
    });
    ws.on("error", (e: any) => {
      result.errors.push("socket: " + String(e.message).replace(/sk-[A-Za-z0-9_-]+/g, "<redacted>"));
      end();
    });
    ws.on("close", end);
  });
  result.speech = result.speech.join("").slice(0, 2000);
  console.log(JSON.stringify({ privateOutput: true, ...result }));
}
