import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consumePendingNotes,
  readConsolidatedNote,
  saveConsolidatedNote,
  snapshotPendingNotes,
  verifyConsolidatedSaveReceipt,
} from "../src/memory/store";
import { acquireMemoryLock } from "../src/memory/lock";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "die-memory-store-"));
  temporaryDirectories.push(path);
  return path;
}

async function pendingDirectory(cwd: string): Promise<string> {
  const path = join(cwd, ".agents", "notes", ".pending");
  await mkdir(path, { recursive: true });
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("pending memory notes", () => {
  test("snapshots direct markdown notes in stable path order", async () => {
    const cwd = await temporaryDirectory();
    const pending = await pendingDirectory(cwd);
    await writeFile(join(pending, "z.md"), "last\n");
    await writeFile(join(pending, "a.md"), "first\n");
    await writeFile(join(pending, "ignore.txt"), "no");
    await mkdir(join(pending, "nested"));
    await writeFile(join(pending, "nested", "hidden.md"), "no");

    const snapshot = await snapshotPendingNotes(cwd);
    expect(snapshot.map((note) => note.path)).toEqual([".agents/notes/.pending/a.md", ".agents/notes/.pending/z.md"]);
    expect(snapshot.map((note) => note.content)).toEqual(["first\n", "last\n"]);
    expect(snapshot.every((note) => /^[a-f0-9]{64}$/.test(note.hash))).toBe(true);
  });

  test("records immutable receipts and leaves changed source files retryable", async () => {
    const cwd = await temporaryDirectory();
    const pending = await pendingDirectory(cwd);
    await writeFile(join(pending, "same.md"), "same");
    await writeFile(join(pending, "changed.md"), "before");
    const snapshot = await snapshotPendingNotes(cwd);

    await writeFile(join(pending, "changed.md"), "after");
    await writeFile(join(pending, "new.md"), "new");
    const result = await consumePendingNotes(cwd, snapshot);

    expect(result).toEqual({
      consumed: [".agents/notes/.pending/changed.md", ".agents/notes/.pending/same.md"],
      retained: [],
    });
    // Mutable producer-owned files are never removed. Only the exact old path/content is filtered.
    expect(await readFile(join(pending, "same.md"), "utf8")).toBe("same");
    expect(await readFile(join(pending, "changed.md"), "utf8")).toBe("after");
    expect(await readFile(join(pending, "new.md"), "utf8")).toBe("new");
    expect(
      (await readdir(join(cwd, ".agents", "notes", ".consumed"))).filter((name) => name.endsWith(".json")),
    ).toHaveLength(2);
    expect((await snapshotPendingNotes(cwd)).map((note) => note.content)).toEqual(["after", "new"]);
  });

  test("does not lose a replacement written concurrently with consumption", async () => {
    const cwd = await temporaryDirectory();
    const pending = await pendingDirectory(cwd);
    const path = join(pending, "worker.md");
    await writeFile(path, "original");
    const snapshot = await snapshotPendingNotes(cwd);

    const consuming = consumePendingNotes(cwd, snapshot);
    await writeFile(path, "replacement");
    await consuming;

    expect(await readFile(path, "utf8")).toBe("replacement");
    expect(await snapshotPendingNotes(cwd)).toMatchObject([{ content: "replacement" }]);
  });

  test("consumption waits for the project writer lease and does not publish early", async () => {
    const cwd = await temporaryDirectory();
    const pending = await pendingDirectory(cwd);
    await writeFile(join(pending, "note.md"), "note");
    const snapshot = await snapshotPendingNotes(cwd);
    const lease = await acquireMemoryLock(cwd);
    try {
      await expect(consumePendingNotes(cwd, snapshot)).rejects.toThrow("locked");
      expect(await Bun.file(join(cwd, ".agents", "notes", ".consumed")).exists()).toBe(false);
      expect(await consumePendingNotes(cwd, snapshot, () => true, lease)).toEqual({
        consumed: [snapshot[0]!.path],
        retained: [],
      });
    } finally {
      await lease();
    }
  });

  test("never follows a pre-existing symlink at a receipt path", async () => {
    const cwd = await temporaryDirectory();
    const pending = await pendingDirectory(cwd);
    await writeFile(join(pending, "note.md"), "note");
    const [record] = await snapshotPendingNotes(cwd);
    if (!record) throw new Error("expected pending note");

    const consumed = join(cwd, ".agents", "notes", ".consumed");
    await mkdir(consumed);
    const marker = createHash("sha256").update(`${record.path}\0${record.content}`, "utf8").digest("hex") + ".json";
    const outside = join(cwd, "outside-receipt");
    await writeFile(outside, "untouched");
    await symlink(outside, join(consumed, marker));

    await expect(consumePendingNotes(cwd, [record])).rejects.toThrow("symlink");
    expect(await readFile(outside, "utf8")).toBe("untouched");
    expect(await readFile(join(pending, "note.md"), "utf8")).toBe("note");
  });

  test("rejects pending symlinks instead of reading outside managed storage", async () => {
    const cwd = await temporaryDirectory();
    const pending = await pendingDirectory(cwd);
    const outside = join(cwd, "outside.md");
    await writeFile(outside, "secret");
    await symlink(outside, join(pending, "linked.md"));
    await expect(snapshotPendingNotes(cwd)).rejects.toThrow("symlink");
  });
});

describe("consolidated topic indexes", () => {
  test("creates nested indexes and returns a verifiable receipt", async () => {
    const cwd = await temporaryDirectory();
    const receipt = await saveConsolidatedNote(cwd, "architecture/runtime", "# Runtime\n", null);

    expect(receipt.path).toBe(".agents/notes/architecture/runtime/index.md");
    expect(await verifyConsolidatedSaveReceipt(cwd, receipt)).toBe(true);
    expect(await readConsolidatedNote(cwd, "architecture/runtime")).toMatchObject({
      path: receipt.path,
      content: "# Runtime\n",
      hash: receipt.hash,
    });

    await writeFile(join(cwd, receipt.path), "changed after save");
    expect(await verifyConsolidatedSaveReceipt(cwd, receipt)).toBe(false);
  });

  test("uses cooperative hash guards and does not overwrite unknown content", async () => {
    const cwd = await temporaryDirectory();
    const directory = join(cwd, ".agents", "notes", "decisions");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.md"), "user content");

    await expect(saveConsolidatedNote(cwd, "decisions", "replacement", null)).rejects.toThrow("already exists");
    expect(await readFile(join(directory, "index.md"), "utf8")).toBe("user content");

    const current = await readConsolidatedNote(cwd, "decisions");
    if (!current) throw new Error("expected existing note");
    const receipt = await saveConsolidatedNote(cwd, "decisions", "replacement", current.hash);
    expect(await verifyConsolidatedSaveReceipt(cwd, receipt)).toBe(true);
    await expect(saveConsolidatedNote(cwd, "decisions", "stale write", current.hash)).rejects.toThrow("changed");
    expect(await readFile(join(directory, "index.md"), "utf8")).toBe("replacement");
  });

  test("serializes built-in saves with the project lease and accepts an owned lease", async () => {
    const cwd = await temporaryDirectory();
    const lease = await acquireMemoryLock(cwd);
    try {
      await expect(saveConsolidatedNote(cwd, "blocked", "no", null)).rejects.toThrow("locked");
      const receipt = await saveConsolidatedNote(cwd, "owned", "saved", null, lease);
      expect(await verifyConsolidatedSaveReceipt(cwd, receipt)).toBe(true);
    } finally {
      await lease();
    }
  });

  test("releases the project lease when a guarded save fails", async () => {
    const cwd = await temporaryDirectory();
    await saveConsolidatedNote(cwd, "topic", "first", null);
    await expect(saveConsolidatedNote(cwd, "topic", "stale", null)).rejects.toThrow("already exists");
    const lease = await acquireMemoryLock(cwd);
    await lease();
  });

  test("supports the root index", async () => {
    const cwd = await temporaryDirectory();
    const receipt = await saveConsolidatedNote(cwd, "", "# Memory\n", null);
    expect(receipt.path).toBe(".agents/notes/index.md");
    expect(await verifyConsolidatedSaveReceipt(cwd, receipt)).toBe(true);
  });

  test("rejects traversal and symlinked managed directories", async () => {
    const cwd = await temporaryDirectory();
    await expect(saveConsolidatedNote(cwd, "../outside", "bad", null)).rejects.toThrow("Invalid memory topic");

    const outside = join(cwd, "outside");
    await mkdir(outside);
    await mkdir(join(cwd, ".agents"));
    await symlink(outside, join(cwd, ".agents", "notes"));
    await expect(snapshotPendingNotes(cwd)).rejects.toThrow("symlink");
    await expect(saveConsolidatedNote(cwd, "topic", "bad", null)).rejects.toThrow("symlink");
    expect(await readFile(join(cwd, ".agents", "notes"), "utf8").catch(() => "untouched")).toBe("untouched");
  });
});

test("invalidated consumption leaves the source snapshot unconsumed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "die-memory-invalidated-"));
  try {
    await mkdir(join(cwd, ".agents/notes/.pending"), { recursive: true });
    await writeFile(join(cwd, ".agents/notes/.pending/a.md"), "retry");
    const snapshot = await snapshotPendingNotes(cwd);
    expect(await consumePendingNotes(cwd, snapshot, () => false)).toEqual({
      consumed: [],
      retained: [snapshot[0]!.path],
    });
    expect(await snapshotPendingNotes(cwd)).toEqual(snapshot);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
