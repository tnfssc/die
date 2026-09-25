/** Input gate for paid Live transcript probes. Never selects a session implicitly. */
import { closeSync, openSync, readSync } from "node:fs";

export const study = {
  cutoff: "2026-09-25T17:32:53.000Z",
  targets: { weather: 44, audio: 63, delegate: 72, followup: 85 },
} as const;
export function probeArgs(args: string[], mode: "recorded" | "controlled") {
  const flags = new Set<string>();
  let source: string | undefined;
  const trials: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--source") {
      if (source || !args[i + 1] || args[i + 1].startsWith("--"))
        throw Error("--source requires one explicit JSONL file");
      source = args[++i];
    } else if (["--study-2026-09-25", "--disclose-private", "--synthetic"].includes(arg)) {
      if (flags.has(arg)) throw Error("Duplicate flag: " + arg);
      flags.add(arg);
    } else if (arg.startsWith("--")) throw Error("Unknown flag: " + arg);
    else trials.push(arg);
  }
  if (flags.has("--synthetic") && (mode !== "controlled" || source || flags.has("--study-2026-09-25")))
    throw Error("--synthetic is only for controlled trials without a source");
  if (!flags.has("--synthetic") && (!source || !flags.has("--study-2026-09-25")))
    throw Error("Select --source FILE --study-2026-09-25, or controlled --synthetic");
  if (!flags.has("--disclose-private"))
    throw Error(
      "--disclose-private required: root and transcript text will be sent to configured provider; output may echo private context",
    );
  return { source, synthetic: flags.has("--synthetic"), trials };
}

export function readStudy(source: string): any[] {
  const entries: any[] = [];
  const fd = openSync(source, "r");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const block = Buffer.alloc(4096);
  let carry = "",
    total = 0,
    stopped = false;
  const line = (text: string) => {
    if (!text) return;
    if (Buffer.byteLength(text) > 262144) throw Error("JSONL line exceeds 256 KiB");
    const entry = JSON.parse(text);
    if (typeof entry?.timestamp !== "string") throw Error("Missing timestamp");
    if (entry.timestamp >= study.cutoff) {
      stopped = true;
      return;
    }
    entries.push(entry);
    if (entries.length > 2048) throw Error("Too many entries");
  };
  try {
    while (!stopped) {
      const count = readSync(fd, block, 0, block.length, null);
      if (!count) break;
      total += count;
      if (total > 8 * 1024 * 1024) throw Error("Source prefix exceeds 8 MiB");
      carry += decoder.decode(block.subarray(0, count), { stream: true });
      let end: number;
      while (!stopped && (end = carry.indexOf("\n")) >= 0) {
        line(carry.slice(0, end));
        carry = carry.slice(end + 1);
      }
      if (Buffer.byteLength(carry) > 262144) throw Error("JSONL line exceeds 256 KiB");
    }
    if (!stopped) {
      carry += decoder.decode();
      line(carry);
    }
  } finally {
    closeSync(fd);
  }
  if (!entries.length) throw Error("Empty study prefix");
  return entries;
}

export function studyTarget(entries: any[], index: number) {
  const value = entries[index]?.message?.content;
  if (entries[index]?.message?.role !== "user" || !(typeof value === "string" || Array.isArray(value)))
    throw Error("Study target missing user turn at index " + index);
  return entries[index];
}
