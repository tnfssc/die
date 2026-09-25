/** Synthetic wire probe. No mic, generated-code evaluation, or user jobs.
 * bun wisdom/live/main-orchestrator-openai-probe.ts realtime --offline
 * bun wisdom/live/main-orchestrator-openai-probe.ts realtime --paid
 * Other paid modes: live-tools, live-delegation. Each socket is limited to 12s.
 */
import WebSocket from "ws";
import { createDefaultLiveCredentialService } from "../../src/live/credentials";
import { createPromptPreview } from "../../src/prompt-preview";

const mode = process.argv[2];
const paid = process.argv.includes("--paid");
if (!["realtime", "live-tools", "live-delegation"].includes(mode) || (!paid && !process.argv.includes("--offline"))) {
  throw new Error("Choose realtime|live-tools|live-delegation and --offline or --paid");
}
const preview = await createPromptPreview({ rootMode: "orchestrator", message: "Synthetic diagnostic only." });
const execute = preview.tools.find((tool) => tool.name === "execute");
if (preview.tools.length !== 1 || !execute) throw new Error("Expected production execute-only tool frame");
const tool = { type: "function", name: execute.name, description: execute.description, parameters: execute.parameters };
console.log(
  JSON.stringify({
    event: "offline_preview",
    mode,
    rootMode: preview.preview.rootMode,
    promptChars: preview.systemPrompt.length,
    toolNames: preview.tools.map((tool) => tool.name),
    parameterKeys: Object.keys((execute.parameters as any).properties),
    networkRequests: 0,
  }),
);
if (!paid) process.exit(0);
let key: string;
try {
  key = await (await createDefaultLiveCredentialService(undefined, "openai")).loadKey();
} catch {
  console.log(
    JSON.stringify({ event: "credential_unavailable", provider: "openai", source: "existing app credential loader" }),
  );
  process.exit(0);
}
const live = mode !== "realtime";
const url = live ? "wss://api.openai.com/v1/live/sessions" : "wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1";
const socket = new WebSocket(url, { headers: { Authorization: "Bearer " + key } });
let ended = false;
let configured = false,
  calls = 0,
  responseActive = false,
  continuationPending = false;
let consumedMarker = false,
  outputChars = 0;
const log = (event: string, detail: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, ...detail }));
const send = (event: Record<string, unknown>) => socket.send(JSON.stringify(event));
const finish = (reason: string) => {
  if (ended) return;
  ended = true;
  clearTimeout(timer);
  log("final", { reason, configured, calls, consumedMarker, outputChars });
  socket.terminate();
};
const timer = setTimeout(() => finish("deadline"), 12000);
const createResponse = () => {
  responseActive = true;
  send({ type: "response.create", response: { output_modalities: ["text"] } });
};
socket.on("open", () => {
  log("socket_open");
  if (live)
    send({
      type: "session.start",
      event_id: "probe_start",
      session: {
        model: "gpt-live-1",
        instructions: preview.systemPrompt,
        audio: { format: { type: "audio/pcm", rate: 24000 }, output: { voice: "marin" } },
        delegation: { type: "client" },
        ...(mode === "live-tools" ? { tools: [tool], tool_choice: "auto" } : {}),
      },
    });
  else
    send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: preview.systemPrompt,
        audio: {
          input: { format: { type: "audio/pcm", rate: 24000 }, turn_detection: null },
          output: { format: { type: "audio/pcm", rate: 24000 }, voice: "marin" },
        },
        output_modalities: ["text"],
        tools: [tool],
        tool_choice: "auto",
      },
    });
});
socket.on("message", (raw) => {
  if (raw.length > 1_000_000) {
    finish("event_limit");
    return;
  }
  let message: any;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }
  const type = message.type;
  if (type === "error") {
    log("provider_error", {
      code: message.error?.code,
      param: message.error?.param,
      message:
        typeof message.error?.message === "string"
          ? message.error.message.replaceAll(key, "[redacted]").slice(0, 240)
          : undefined,
    });
    finish("provider_error");
    return;
  }
  if ((type === "session.updated" && !live) || (type === "session.started" && live)) {
    log(type, { model: message.session?.model, toolNames: message.session?.tools?.map((t: any) => t.name) });
    if (configured) return;
    configured = true;
    if (!live) {
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Synthetic probe: call execute with console.log(2 + 3), then report the result returned. The fixture will not actually run code; say so. Do not delegate or use other helpers.",
            },
          ],
        },
      });
      createResponse();
    }
    // GPT-Live has audio input, not a documented synthetic text input event.
    // A silent accepted session proves setup only, never usable client execution.
  }
  if (type === "response.output_item.done" && message.item?.type === "function_call") {
    calls++;
    log("function_call", { name: message.item.name, callIdPresent: !!message.item.call_id });
    if (calls > 1 || message.item.name !== "execute") {
      finish("call_limit_or_unknown_tool");
      return;
    }
    // Do not parse/evaluate provider code. Match the ordinary tool text-content shape.
    send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: message.item.call_id,
        output: JSON.stringify({
          content: [{ type: "text", text: "Synthetic fixture ORBIT-17. No code was executed; no job exists." }],
        }),
      },
    });
    log("simulated_tool_result");
    continuationPending = true;
    if (!responseActive) {
      continuationPending = false;
      createResponse();
    }
  }
  if (type === "response.output_text.delta" || type === "response.text.delta") {
    outputChars += typeof message.delta === "string" ? message.delta.length : 0;
  }
  if (type === "response.done") {
    responseActive = false;
    const serialized = JSON.stringify(message.response?.output ?? []);
    consumedMarker ||= /ORBIT[ -]?17/i.test(serialized);
    log("response_done", { status: message.response?.status, consumedMarker });
    if (continuationPending) {
      continuationPending = false;
      createResponse();
    } else finish(calls ? "round_trip_done" : "no_tool_call");
  }
  if (type === "session.delegation.created")
    log(type, { idPresent: !!message.delegation?.id, target: message.delegation?.target });
  if (type === "session.closed") finish("session_closed");
});
socket.on("error", () => {
  log("socket_error");
  finish("socket_error");
});
socket.on("close", (code) => {
  clearTimeout(timer);
  log("socket_close", { code });
});
