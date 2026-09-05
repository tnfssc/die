import { StringDecoder } from "node:string_decoder";
import { BoundedOutputBuffer } from "./output-buffer";

export interface AgentInfo {
  type: string;
  model: string;
  thinking?: string;
  depth: number;
  sessionFile: string;
  parentSessionFile?: string;
  phase?: string;
  lastActivityAt?: string;
  events?: number;
  currentTool?: string;
  lastError?: string;
}
const MAX_RECORD_BYTES = 1_000_000;
const text = (value: unknown, limit = 2000): string => typeof value === "string" ? value.slice(0, limit) : "";
function content(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.filter(p => p && p.type === "text" && typeof p.text === "string").map(p => text(p.text)).join("\n").slice(0, 5000);
}
/** Decode the public JSON event stream, never retaining partial messages/images/reasoning. */
export class AgentProgress {
  #decoder = new StringDecoder("utf8");
  #pending = "";
  #bytes = 0;
  #dropping = false;
  final = new BoundedOutputBuffer(5000);
  failed = false;
  constructor(readonly info: AgentInfo, private emit: (value: string) => void) {}
  push(chunk: Buffer) {
    const decoded = this.#decoder.write(chunk);
    for (const [index, part] of decoded.split("\n").entries()) {
      if (index > 0) { if (!this.#dropping && this.#pending) this.#record(this.#pending); this.#pending = ""; this.#bytes = 0; this.#dropping = false; }
      this.#bytes += Buffer.byteLength(part);
      if (this.#bytes > MAX_RECORD_BYTES) {
        if (!this.#dropping) this.emit("[diagnostic] Oversized event omitted; see session JSONL.\n");
        this.#pending = ""; this.#dropping = true;
      } else if (!this.#dropping) this.#pending += part;
    }
  }
  finish() { const tail = this.#decoder.end(); if (tail) this.#pending += tail; if (!this.#dropping && this.#pending) this.#record(this.#pending); this.#pending = ""; }
  #record(line: string) {
    let event: any;
    try { event = JSON.parse(line); }
    catch { this.emit("[stdout] " + text(line) + "\n"); return; }
    if (!event || typeof event.type !== "string") return;
    this.info.events = (this.info.events ?? 0) + 1;
    this.info.lastActivityAt = new Date().toISOString();
    const log = (message: string) => this.emit("[" + this.info.lastActivityAt + "] " + message + "\n");
    switch (event.type) {
      case "session": log("Session started"); this.info.phase = "starting"; break;
      case "agent_start": case "turn_start": this.info.phase = "waiting for model"; log(event.type); break;
      case "message_update": {
        this.info.phase = "receiving model response";
        const delta = event.assistantMessageEvent;
        if (delta?.type === "text_delta") this.emit(text(delta.delta) );
        // Thinking deltas update activity only, never copy their contents.
        break;
      }
      case "tool_execution_start":
        this.info.currentTool = text(event.toolName, 100);
        this.info.phase = "running tool";
        log("Tool started: " + this.info.currentTool);
        if (event.args && typeof event.args === "object") {
          for (const key of ["code", "command", "prompt", "path"]) {
            if (typeof event.args[key] === "string") log(key + ": " + text(event.args[key], 1000));
          }
        }
        break;
      case "tool_execution_end": {
        log("Tool " + (event.isError ? "failed: " : "finished: ") + text(event.toolName, 100));
        const output = content(event.result?.content);
        if (output) log(output);
        if (event.isError) this.info.lastError = output || "Tool failed";
        delete this.info.currentTool;
        const handoff = event.result?.details?.handoff;
        if (typeof handoff === "string" && !event.isError) {
          this.info.phase = "waiting for background work";
          this.final = new BoundedOutputBuffer(5000);
          this.final.append(handoff);
        } else this.info.phase = "waiting for model";
        break;
      }
      case "message_end": {
        const message = event.message;
        if (message?.role !== "assistant") break;
        const output = content(message.content);
        this.final = new BoundedOutputBuffer(5000);
        if (Array.isArray(message.content)) {
          for (const part of message.content) if (part?.type === "text" && typeof part.text === "string") this.final.append(part.text);
        }
        if (output) log("Assistant: " + output);
        this.failed = message.stopReason === "error" || message.stopReason === "aborted";
        // A final message is not process completion: print mode may still own
        // jobs. Report the observed boundary, not a fictitious ongoing stream.
        this.info.phase = this.failed ? "model failed" : message.stopReason === "toolUse" ? "preparing tool execution" : "assistant turn finished";
        if (message.stopReason === "error" || message.stopReason === "aborted") {
          this.failed = true;
          this.info.lastError = text(message.errorMessage) || message.stopReason;
          log("Model error: " + this.info.lastError);
        }
        break;
      }
      case "auto_retry_start": case "auto_retry_end": case "auto_compaction_start": case "auto_compaction_end":
        this.info.phase = event.type;
        log(event.type + (event.errorMessage ? ": " + text(event.errorMessage) : ""));
        break;
      case "agent_end": this.info.phase = this.failed ? "model failed" : "agent ended"; log(this.info.phase); break;
    }
  }
}
