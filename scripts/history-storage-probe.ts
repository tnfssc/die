/**
 * Probe saved-history retention in isolation. Create and remove only temporary
 * sessions. Run with: bun scripts/history-storage-probe.ts
 */

import { heapStats } from "bun:jsc";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

const MIB = 1024 * 1024;
const BODY_BYTES = MIB;
const BATCHES = 17;
const BODIES_PER_BATCH = 8;
const ORIGINAL_BYTES_MIN = 128 * MIB;
const CACHE_LIMIT_BYTES = 4 * MIB;

type Mode = "native" | "adapted";
interface ProbeEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  message?: { content?: unknown };
}
interface Snapshot {
  label: string;
  entries: number;
  metadataBytes: number;
  retainedFullTextBytes: number;
  configuredCacheLimitBytes: number | null;
  contextBytes: number;
  heapMiB: number;
  jscHeapMiB: number;
  rssMiB: number;
}

function textBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value);
  if (!Array.isArray(value)) return 0;
  let bytes = 0;
  for (const part of value)
    if (part && typeof part === "object" && typeof part.text === "string") bytes += Buffer.byteLength(part.text);
  return bytes;
}

async function collectGc(): Promise<void> {
  await Bun.sleep(30);
  Bun.gc(true);
  await Bun.sleep(30);
  Bun.gc(true);
}

async function child(mode: Mode): Promise<void> {
  if (mode === "adapted") {
    const { installDiskBackedSessionManager } = await import("../src/history/session-manager");
    installDiskBackedSessionManager();
  }
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const root = mkdtempSync(join(tmpdir(), `die-history-storage-${mode}-`));
  const sessions = join(root, "sessions");
  let manager: SessionManager | undefined = SessionManager.create(root, sessions);
  let originalBytes = 0;
  let firstId = "";
  let firstHash = "";
  const snapshots: Snapshot[] = [];

  const snapshot = async (label: string) => {
    await collectGc();
    const entries = (manager as unknown as { fileEntries: ProbeEntry[] } | undefined)?.fileEntries;
    let retainedFullTextBytes = 0;
    if (entries)
      for (const entry of entries)
        if (entry?.type === "message") retainedFullTextBytes += textBytes(entry.message?.content);
    const metadataBytes = entries
      ? Buffer.byteLength(
          JSON.stringify(
            entries.map((entry) => {
              if (entry?.type === "session") return entry;
              const { type, id, parentId, timestamp } = entry;
              return { type, id, parentId, timestamp };
            }),
          ),
        )
      : 0;
    const usage = process.memoryUsage();
    const heap = heapStats();
    const context = manager ? manager.buildSessionContext() : undefined;
    snapshots.push({
      label,
      entries: entries?.length ?? 0,
      metadataBytes,
      retainedFullTextBytes,
      configuredCacheLimitBytes: mode === "adapted" ? CACHE_LIMIT_BYTES : null,
      contextBytes: context ? Buffer.byteLength(JSON.stringify(context)) : 0,
      heapMiB: +(usage.heapUsed / MIB).toFixed(2),
      jscHeapMiB: +(heap.heapSize / MIB).toFixed(2),
      rssMiB: +(usage.rss / MIB).toFixed(2),
    });
  };

  try {
    await snapshot("baseline");
    for (let batch = 0; batch < BATCHES; batch++) {
      for (let index = 0; index < BODIES_PER_BATCH; index++) {
        const prefix = `batch=${batch};entry=${index};`;
        const body =
          prefix +
          randomBytes(Math.ceil(((BODY_BYTES - prefix.length) * 3) / 4))
            .toString("base64")
            .slice(0, BODY_BYTES - prefix.length);
        originalBytes += Buffer.byteLength(body);
        const id = manager.appendMessage({ role: "user", content: body, timestamp: batch * 100 + index });
        if (!firstId) {
          firstId = id;
          firstHash = createHash("sha256").update(body).digest("hex");
          manager.appendMessage({
            role: "assistant",
            content: [{ type: "text", text: "initial flush" }],
            api: "openai-responses",
            provider: "probe",
            model: "probe",
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: 1,
          });
        }
      }
      const kept = manager.appendMessage({ role: "user", content: `kept tail ${batch}`, timestamp: batch * 100 + 90 });
      manager.appendCompaction(`small summary ${batch}`, kept, 1_000_000);
      if (batch === 0 || batch === 7 || batch === BATCHES - 1) await snapshot(`after-compaction-${batch + 1}`);
    }
    if (originalBytes < ORIGINAL_BYTES_MIN) throw new Error(`probe generated only ${originalBytes} original bytes`);
    const file = manager.getSessionFile();
    if (!file) throw new Error("persistent manager has no session file");
    const fileBytes = statSync(file).size;
    const contextBeforeReopen = Buffer.byteLength(JSON.stringify(manager.buildSessionContext()));
    manager = undefined;
    await collectGc();
    manager = SessionManager.open(file, sessions);
    await snapshot("reopened");
    const reopenedOriginal = (manager.getEntry(firstId) as { message?: { content?: unknown } } | undefined)?.message
      ?.content;
    const originalSurvived =
      typeof reopenedOriginal === "string" && createHash("sha256").update(reopenedOriginal).digest("hex") === firstHash;
    await snapshot("after-original-read");
    const baseline = snapshots[0];
    const reopened = snapshots.at(-2);
    if (!baseline || !reopened) throw new Error("missing heap snapshots");
    const heapGrowthMiB = +(reopened.heapMiB - baseline.heapMiB).toFixed(2);
    const result = {
      mode,
      originalMiB: +(originalBytes / MIB).toFixed(2),
      fileMiB: +(fileBytes / MIB).toFixed(2),
      compactions: BATCHES,
      contextKiB: +(contextBeforeReopen / 1024).toFixed(2),
      originalSurvived,
      heapGrowthMiB,
      snapshots,
    };
    if (mode === "adapted") {
      if (!originalSurvived) throw new Error("original text did not survive reopen");
      if (contextBeforeReopen >= MIB) throw new Error("compacted context is unexpectedly large");
      if (reopened.retainedFullTextBytes !== 0) throw new Error("adapted manager retained full history bodies");
      if (heapGrowthMiB >= 64) throw new Error(`adapted heap grew ${heapGrowthMiB} MiB`);
    }
    console.log(JSON.stringify(result));
  } finally {
    manager = undefined;
    rmSync(root, { recursive: true, force: true });
  }
}

async function run(mode: Mode) {
  const proc = Bun.spawn([process.execPath, import.meta.path, "--child", mode], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${mode} probe failed (${exitCode}): ${stderr}`);
  const line = stdout.trim().split("\n").at(-1);
  if (!line) throw new Error(`${mode} probe produced no JSON`);
  return JSON.parse(line);
}

if (process.argv[2] === "--child") await child(process.argv[3] as Mode);
else {
  const native = await run("native");
  const adapted = await run("adapted");
  console.log(
    JSON.stringify(
      {
        native,
        adapted,
        comparison: {
          reopenedHeapReductionMiB: +(native.heapGrowthMiB - adapted.heapGrowthMiB).toFixed(2),
          originalMiB: adapted.originalMiB,
          adaptedRetainedFullTextBytes: adapted.snapshots.at(-2).retainedFullTextBytes,
          contextKiB: adapted.contextKiB,
        },
      },
      null,
      2,
    ),
  );
}
