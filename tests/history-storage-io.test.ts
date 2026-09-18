import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import { DiskEntryStore, scanJsonl } from "../src/history/disk-entry-store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryFile(name = "session.jsonl"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "die-history-io-"));
  roots.push(root);
  return join(root, name);
}

function header(): SessionHeader {
  return {
    type: "session",
    version: 3,
    id: "session-io",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/tmp/io",
  } as SessionHeader;
}

function message(id: string, content: string, parentId: string | null = null): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content, timestamp: 1 },
  } as SessionEntry;
}

function assistant(id: string, parentId: string | null): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:01.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "published" }],
      api: "openai-responses",
      provider: "test",
      model: "test",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
      stopReason: "stop",
      timestamp: 2,
    },
  } as unknown as SessionEntry;
}

function content(entry: SessionEntry): string {
  return (entry as SessionEntry & { message: { content: string } }).message.content;
}

describe("disk entry store I/O correctness", () => {
  test("scanJsonl propagates visitor exceptions rather than treating them as malformed JSON", async () => {
    const path = await temporaryFile();
    await writeFile(path, JSON.stringify(header()) + "\n");
    const sentinel = new Error("visitor storage failure");

    expect(() =>
      scanJsonl(path, () => {
        throw sentinel;
      }),
    ).toThrow(sentinel);
  });

  test("scans Unicode, CRLF, records larger than the scan buffer, and repairs a valid unterminated tail before append", async () => {
    const path = await temporaryFile();
    const unicode = "🙂漢字e\u0301".repeat(12_000);
    const first = message("large", unicode);
    const tail = message("tail", "unterminated ✅", "large");
    await writeFile(
      path,
      [JSON.stringify(header()), JSON.stringify(first), "{not json", JSON.stringify(tail)].join("\r\n"),
    );

    const store = DiskEntryStore.open(path, 256);
    expect(store.entries.map(({ id }) => id)).toEqual(["large", "tail"]);
    expect(content(store.materialize(store.entries[0]!))).toBe(unicode);
    expect(content(store.materialize(store.entries[1]!))).toBe("unterminated ✅");

    store.append(message("after", "after tail", "tail"));
    const bytes = await readFile(path);
    expect(
      bytes.includes(Buffer.from(JSON.stringify(tail) + "\n" + JSON.stringify(message("after", "after tail", "tail")))),
    ).toBe(true);

    const reopened = DiskEntryStore.open(path, 256);
    expect(reopened.entries.map(({ id }) => id)).toEqual(["large", "tail", "after"]);
    expect(content(reopened.materialize("after"))).toBe("after tail");
  });

  test("retries short writes and rolls back failed partial appends in an isolated subprocess", async () => {
    const path = await temporaryFile("short-write.jsonl");
    const script = join(path, "..", "short-write.test.ts");
    const moduleUrl = pathToFileURL(join(import.meta.dir, "..", "src", "history", "disk-entry-store.ts")).href;
    await writeFile(
      script,
      `
import { expect, mock, test } from "bun:test";
import * as fs from "node:fs";
const realWriteSync = fs.writeSync.bind(fs);
let calls = 0;
let failOn = Infinity;
function shortWrite(fd: number, buffer: string | NodeJS.ArrayBufferView, offset?: number, length?: number, position?: number | null): number {
  if (typeof buffer === "string") return (realWriteSync as any)(fd, buffer, offset);
  calls++;
  if (calls === failOn) throw new Error("simulated disk full");
  const start = typeof offset === "number" ? offset : 0;
  const requested = typeof length === "number" ? length : buffer.byteLength - start;
  const shortLength = Math.max(1, Math.min(requested, Math.ceil(requested / 3)));
  return (realWriteSync as any)(fd, buffer, start, shortLength, position ?? null);
}
mock.module("node:fs", () => ({ ...fs, default: { ...(fs as any).default, writeSync: shortWrite }, writeSync: shortWrite }));
const { DiskEntryStore } = await import(${JSON.stringify(moduleUrl)});
test("short writes", () => {
  const header = { type: "session", version: 3, id: "short", timestamp: "x", cwd: "/" };
  const entry = { type: "message", id: "entry", parentId: null, timestamp: "x", message: { role: "user", content: "🙂".repeat(1000), timestamp: 1 } };
  const store = DiskEntryStore.fromEntries(process.env.SHORT_WRITE_PATH!, header, [entry], true);
  expect(store.materialize("entry").message.content).toBe(entry.message.content);
  expect(calls).toBeGreaterThan(2);
  const before = fs.readFileSync(process.env.SHORT_WRITE_PATH!);
  failOn = calls + 2;
  expect(() => store.append({ ...entry, id: "failed" })).toThrow("simulated disk full");
  expect(fs.readFileSync(process.env.SHORT_WRITE_PATH!)).toEqual(before);
  failOn = Infinity;
  store.append({ ...entry, id: "after", parentId: "entry" });
  const reopened = DiskEntryStore.open(process.env.SHORT_WRITE_PATH!);
  expect(reopened.entries.map((entry: any) => entry.id)).toEqual(["entry", "after"]);
  expect(reopened.materialize("entry").message.content).toBe(entry.message.content);
});
`,
    );
    const child = Bun.spawn([Bun.which("bun")!, "test", script], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, SHORT_WRITE_PATH: path },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode, `short-write subprocess failed:\n${stdout}\n${stderr}`).toBe(0);
  });
  test("failed first-assistant publication rolls back the pending append and can be retried", async () => {
    const path = await temporaryFile();
    const store = DiskEntryStore.pending(path, header(), 1024);
    store.append(message("before", "must survive"));
    store.materialize("before");
    const internals = store as unknown as {
      cache: Map<string, Buffer>;
      cacheBytes: number;
      hasAssistant: boolean;
    };
    const cachedBefore = [...internals.cache].map(([key, bytes]) => [key, Buffer.from(bytes)] as const);
    const cacheBytesBefore = internals.cacheBytes;
    await writeFile(path, "collision sentinel\n");

    expect(() => store.append(assistant("failed", "before"))).toThrow();

    expect(await readFile(path, "utf8")).toBe("collision sentinel\n");
    expect(store.entries.map(({ id }) => id)).toEqual(["before"]);
    expect(store.byId.has("failed")).toBe(false);
    expect(() => store.materialize("failed")).toThrow("not found");
    expect(internals.hasAssistant).toBe(false);
    expect(internals.cacheBytes).toBe(cacheBytesBefore);
    expect([...internals.cache].map(([key, bytes]) => [key, bytes] as const)).toEqual(cachedBefore);

    await rm(path);
    store.append(assistant("recovered", "before"));
    expect(store.flushed).toBe(true);
    expect(store.entries.map(({ id }) => id)).toEqual(["before", "recovered"]);
    expect(DiskEntryStore.open(path).entries.map(({ id }) => id)).toEqual(["before", "recovered"]);
  });

  test("a failed spool unlink does not undo successful publication", async () => {
    const path = await temporaryFile("cleanup-failure.jsonl");
    const script = join(path, "..", "cleanup-failure.test.ts");
    const moduleUrl = pathToFileURL(join(import.meta.dir, "..", "src", "history", "disk-entry-store.ts")).href;
    await writeFile(
      script,
      `
import { expect, mock, test } from "bun:test";
import * as fs from "node:fs";
const realUnlinkSync = fs.unlinkSync.bind(fs);
let failCleanup = true;
function unlinkSync(path: fs.PathLike): void {
  if (failCleanup && String(path).includes(".pending-")) {
    failCleanup = false;
    throw new Error("simulated cleanup failure");
  }
  realUnlinkSync(path);
}
mock.module("node:fs", () => ({ ...fs, default: { ...(fs as any).default, unlinkSync }, unlinkSync }));
const { DiskEntryStore } = await import(${JSON.stringify(moduleUrl)});
test("cleanup failure", () => {
  const header = { type: "session", version: 3, id: "cleanup", timestamp: "x", cwd: "/" };
  const user = { type: "message", id: "user", parentId: null, timestamp: "x", message: { role: "user", content: "before", timestamp: 1 } };
  const assistant = { type: "message", id: "assistant", parentId: "user", timestamp: "x", message: { role: "assistant", content: [], timestamp: 2 } };
  const store = DiskEntryStore.pending(process.env.CLEANUP_FAILURE_PATH!, header);
  store.append(user);
  expect(() => store.append(assistant)).not.toThrow();
  expect(store.flushed).toBe(true);
  expect(DiskEntryStore.open(process.env.CLEANUP_FAILURE_PATH!).entries.map((entry: any) => entry.id)).toEqual(["user", "assistant"]);
});
`,
    );
    const child = Bun.spawn([Bun.which("bun")!, "test", script], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CLEANUP_FAILURE_PATH: path },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode, `cleanup-failure subprocess failed:\n${stdout}\n${stderr}`).toBe(0);
  });

  test("failed atomic replacement leaves a pending journal usable and publishable", async () => {
    const path = await temporaryFile();
    const store = DiskEntryStore.pending(path, header());
    store.append(message("before", "must survive"));
    const invalid = { ...message("bad", "never written"), cannotSerialize: 1n } as unknown as SessionEntry;

    expect(() => DiskEntryStore.fromEntries(path, header(), [invalid], true)).toThrow();
    store.append(assistant("after", "before"));

    const records: Array<Record<string, unknown>> = [];
    scanJsonl(path, ({ entry }) => records.push(entry as unknown as Record<string, unknown>));
    expect(records.map(({ type }) => type)).toEqual(["session", "message", "message"]);
    expect(records.map(({ id }) => id)).toEqual(["session-io", "before", "after"]);
    expect(content(DiskEntryStore.open(path).materialize("before"))).toBe("must survive");
  });

  test("duplicate IDs retain distinct physical records while ID lookup resolves to the last record", async () => {
    const path = await temporaryFile();
    const first = message("duplicate", "first physical body");
    const second = message("duplicate", "second physical body", "duplicate");
    const store = DiskEntryStore.fromEntries(path, header(), [first, second], true, 1024 * 1024);

    expect(store.entries).toHaveLength(2);
    expect(content(store.materialize(store.entries[0]!))).toBe("first physical body");
    expect(content(store.materialize(store.entries[1]!))).toBe("second physical body");
    expect(content(store.materialize("duplicate"))).toBe("second physical body");
    expect(store.materializeAll().map(content)).toEqual(["first physical body", "second physical body"]);
  });
  test("cache retains exact bounded serialized buffers rather than parsed graphs", async () => {
    const path = await temporaryFile();
    const store = DiskEntryStore.fromEntries(path, header(), [], true, 1024);
    for (let i = 0; i < 20; i++) store.append(message(String(i), "body".repeat(50)));
    const cache = store as unknown as { cache: Map<string, Buffer>; cacheBytes: number };
    expect([...cache.cache.values()].every(Buffer.isBuffer)).toBe(true);
    expect([...cache.cache.values()].reduce((total, bytes) => total + bytes.length, 0)).toBe(cache.cacheBytes);
    expect(cache.cacheBytes).toBeLessThanOrEqual(1024);
    store.append(message("oversized", "x".repeat(2048)));
    expect(cache.cacheBytes).toBeLessThanOrEqual(1024);
    expect(content(store.materialize("0"))).toBe("body".repeat(50));
  });
});
