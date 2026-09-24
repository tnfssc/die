/** Explicit paid, single-session setup probe. Never import from ordinary tests. */
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { OpenAIRealtimeSession, defaultSocket } from "../src/live/openai-session";
import { orchestrationTools } from "../src/live/orchestration";

if (process.env.DIE_REALTIME_SETUP_PROBE !== "1") {
  console.error("Probe disabled; explicit DIE_REALTIME_SETUP_PROBE=1 required");
  process.exit(2);
}
const path = join(homedir(), ".die", "openai-test.env");
let session: OpenAIRealtimeSession | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
try {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0 ||
    stat.size > 4096
  )
    throw new Error("private regular owned file required");
  const contents = await readFile(path, "utf8");
  const entries = contents.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  const matches = entries.filter((line) => /^OPENAI_API_KEY=/.test(line));
  if (matches.length !== 1) throw new Error("one OPENAI_API_KEY assignment required");
  let key = matches[0]!.slice("OPENAI_API_KEY=".length).trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
  if (!/^sk-[A-Za-z0-9_-]{10,}$/.test(key)) throw new Error("invalid key format");
  let outcome = "no setup result";
  let handshake = "not confirmed";
  session = new OpenAIRealtimeSession(
    {
      onReady: () => {
        handshake = "upgraded";
        outcome = "session.updated accepted";
      },
      onError: ({ message }) => {
        const status = /HTTP (\d{3})/.exec(message)?.[1];
        if (status) {
          handshake = "HTTP " + status + " rejected";
          outcome = "setup not reached";
        } else {
          // The production transport open event independently records the handshake.
          const details = /\((code [a-z_]+|type [a-z_]+|field [a-zA-Z0-9_.\[\]]+)(?:, [^)]+)*\)/.exec(message)?.[0];
          outcome = "setup rejected" + (details ?? " (no safe provider identifiers)");
        }
      },
    },
    (url, headers) => {
      const socket = defaultSocket(url, headers);
      socket.addEventListener("open", () => {
        handshake = "upgraded";
      });
      return socket;
    },
    { tools: orchestrationTools, userTranscript: () => {}, execute: async () => ({}) },
    "gpt-realtime-2.1-mini",
  );
  await Promise.race([
    session.connect(key),
    new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error("deadline")), 28000);
    }),
  ]);
  console.log("handshake: " + handshake + "; setup: " + outcome);
} catch {
  console.log("probe: local validation or deadline failure; no raw details emitted");
} finally {
  if (deadline) clearTimeout(deadline);
  session?.close();
}
