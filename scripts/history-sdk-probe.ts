/** Isolated real AgentSession.compact() soak. No network, user sessions or installed binary. */

import { heapStats } from "bun:jsc";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { installDiskBackedSessionManager } from "../src/history/session-manager";

installDiskBackedSessionManager();
const dir = await mkdtemp(join(tmpdir(), "die-history-sdk-soak-"));
const model = getModel("anthropic", "claude-sonnet-4-5")!;
const usage = {
  input: 10,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 11,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
const manager = SessionManager.create(dir, dir);
let tail = "";
let compactions = 0;
let originals = 0;
const samples: Array<{
  label: string;
  heapMiB: number;
  rssMiB: number;
  fileMiB: number;
  contextMessages: number;
  compactions: number;
}> = [];
async function sample(label: string) {
  await Bun.sleep(20);
  Bun.gc(true);
  await Bun.sleep(20);
  Bun.gc(true);
  const memory = process.memoryUsage();
  const file = manager.getSessionFile();
  const value = {
    label,
    heapMiB: +(heapStats().heapSize / 1048576).toFixed(2),
    rssMiB: +(memory.rss / 1048576).toFixed(2),
    fileMiB: +(file ? (await stat(file).catch(() => ({ size: 0 }))).size / 1048576 : 0).toFixed(2),
    contextMessages: manager.buildSessionContext().messages.length,
    compactions,
  };
  samples.push(value);
  console.log(JSON.stringify(value));
}
try {
  const runtime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.hasConfiguredAuth = () => true;
  runtime.getAuth = (async () => ({ auth: { apiKey: "offline-history-soak" } })) as typeof runtime.getAuth;
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    extensionFactories: [
      {
        name: "offline-history-summary",
        factory: (pi) => {
          pi.on("session_before_compact", () => ({
            compaction: { summary: "Bounded offline summary", firstKeptEntryId: tail, tokensBefore: 2_000_000 },
          }));
          pi.on("session_compact", () => {
            compactions++;
          });
        },
      },
    ],
  });
  await loader.reload();
  ({ session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    resourceLoader: loader,
    model,
    modelRuntime: runtime,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false, keepRecentTokens: 128, reserveTokens: 8192 },
    }),
    thinkingLevel: "off",
  }));
  await sample("baseline");
  let first = "";
  for (let batch = 1; batch <= 16; batch++) {
    for (let i = 0; i < 32; i++) {
      const id = manager.appendMessage({
        role: "user",
        content: randomBytes(192 * 1024).toString("base64"),
        timestamp: Date.now(),
      });
      first ||= id;
      originals++;
    }
    manager.appendMessage({
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: [{ type: "text", text: "Stored original batch" }],
      stopReason: "stop",
      usage,
      timestamp: Date.now(),
    });
    tail = manager.appendMessage({ role: "user", content: "retained tail " + batch, timestamp: Date.now() });
    await session.compact();
    if (manager.buildSessionContext().messages.length !== 2) throw new Error("Compacted context changed");
    if (batch % 4 === 0) await sample("after real compaction " + batch);
  }
  if (compactions !== 16) throw new Error("SDK did not complete every compaction");
  const path = manager.getSessionFile()!;
  session.dispose();
  session = undefined;
  manager.newSession();
  await sample("reset");
  manager.setSessionFile(path);
  await sample("resume");
  const entry = manager.getEntry(first);
  if (
    entry?.type !== "message" ||
    entry.message.role !== "user" ||
    typeof entry.message.content !== "string" ||
    entry.message.content.length !== 256 * 1024
  )
    throw new Error("Original history lost on resume");
  manager.appendMessage({ role: "user", content: "post-resume append", timestamp: Date.now() });
  manager.setSessionFile(path);
  if (manager.buildSessionContext().messages.length !== 3) throw new Error("Resume append lost");
  await sample("resume append");
  const baseline = samples[0]!;
  const last = samples.at(-1)!;
  if (last.heapMiB - baseline.heapMiB > 32)
    throw new Error("Historical heap grew by more than 32 MiB for 128 MiB of original text");
  console.log(
    JSON.stringify({ ok: true, originals, compactions, heapGrowthMiB: +(last.heapMiB - baseline.heapMiB).toFixed(2) }),
  );
} finally {
  session?.dispose();
  manager.newSession();
  await rm(dir, { recursive: true, force: true });
}
