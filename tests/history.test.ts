import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { HistoryService } from "../src/history/service";
import { MANUAL_SHAKE_ENTRY, MANUAL_SHAKE_VERSION } from "../src/tasks/manual-shake";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
function user(text: string) {
  return { role: "user", content: text, timestamp: Date.now() } as any;
}
function assistant(parts: any[]) {
  return {
    role: "assistant",
    content: parts,
    provider: "test",
    model: "test",
    usage,
    stopReason: "stop",
    timestamp: Date.now(),
  } as any;
}
function toolResult(id: string, text: string) {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "execute",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  } as any;
}

async function persisted() {
  const dir = await mkdtemp(join(tmpdir(), "die-history-"));
  dirs.push(dir);
  return SessionManager.create(dir, dir);
}

describe("original history", () => {
  test("searches original active-branch dialogue after compaction with stable provenance", async () => {
    const manager = SessionManager.inMemory("/project");
    const old = manager.appendMessage(user("exact launch condition alpha-seven"));
    manager.appendMessage(
      assistant([
        { type: "thinking", thinking: "private alpha-seven" },
        { type: "text", text: "public answer alpha-seven" },
      ]),
    );
    const kept = manager.appendMessage(user("tail"));
    manager.appendCompaction("summary without the phrase", kept, 100);
    const service = new HistoryService();
    const result: any = await service.search({ query: "alpha-seven" }, { sessionManager: manager });
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].provenance).toMatchObject({
      source: "original-transcript",
      scope: "active-session-branch",
      sessionId: manager.getSessionId(),
      entryId: old,
      role: "user",
    });
    expect(result.matches.map((item: any) => item.excerpt).join(" ")).not.toContain("private");
    const read: any = await service.read({ ref: result.matches[0].ref }, { sessionManager: manager });
    expect(read.text).toBe("exact launch condition alpha-seven");
  });

  test("does not cross inactive branches", async () => {
    const manager = SessionManager.inMemory("/project");
    const root = manager.appendMessage(user("root-visible"));
    manager.appendMessage(user("abandoned-secret-needle"));
    manager.branch(root);
    manager.appendMessage(user("active branch"));
    const result: any = await new HistoryService().search(
      { query: "abandoned-secret-needle" },
      { sessionManager: manager },
    );
    expect(result.matches).toEqual([]);
  });

  test("preserves shake, hidden-context, and private-reasoning exclusions", async () => {
    const manager = SessionManager.inMemory("/project");
    const callEntry = manager.appendMessage(
      assistant([
        { type: "thinking", thinking: "reasoning-needle" },
        { type: "toolCall", id: "call-1", name: "execute", arguments: {} },
        { type: "text", text: "public-needle" },
      ]),
    );
    const resultEntry = manager.appendMessage(toolResult("call-1", "shaken-tool-needle"));
    manager.appendMessage({
      role: "bashExecution",
      command: "hidden-command-needle",
      output: "hidden-output-needle",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      excludeFromContext: true,
      timestamp: Date.now(),
    } as any);
    manager.appendCustomMessageEntry("private", "hidden-custom-needle", false);
    manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, {
      version: MANUAL_SHAKE_VERSION,
      sessionId: manager.getSessionId(),
      assistantEntryIds: [callEntry],
      toolResultEntryIds: [resultEntry],
      shakenAt: Date.now(),
    });
    const service = new HistoryService();
    for (const query of [
      "reasoning-needle",
      "shaken-tool-needle",
      "hidden-command-needle",
      "hidden-output-needle",
      "hidden-custom-needle",
    ]) {
      expect(((await service.search({ query }, { sessionManager: manager })) as any).matches).toEqual([]);
    }
    expect(
      ((await service.search({ query: "public-needle" }, { sessionManager: manager })) as any).matches,
    ).toHaveLength(1);
  });

  test("requires explicit opt-in and session file for cross-session access", async () => {
    const current = await persisted();
    current.appendMessage(user("current only"));
    const other = await persisted();
    other.appendMessage(user("cross-session-needle"));
    other.appendMessage(assistant([{ type: "text", text: "ack" }]));
    const service = new HistoryService((path) => SessionManager.open(path));
    const ctx = { sessionManager: current };
    expect(((await service.search({ query: "cross-session-needle" }, ctx)) as any).matches).toEqual([]);
    await expect(
      service.search({ query: "cross-session-needle", sessionFile: other.getSessionFile() }, ctx),
    ).rejects.toThrow("allowCrossSession");
    const found: any = await service.search(
      { query: "cross-session-needle", sessionFile: other.getSessionFile(), allowCrossSession: true },
      ctx,
    );
    expect(found.matches[0].provenance).toMatchObject({
      scope: "cross-session-branch",
      sessionId: other.getSessionId(),
      sessionFile: other.getSessionFile(),
    });
    await expect(service.read({ ref: found.matches[0].ref }, ctx)).rejects.toThrow("selected session");
    expect(
      (
        (await service.read(
          { ref: found.matches[0].ref, sessionFile: other.getSessionFile(), allowCrossSession: true },
          ctx,
        )) as any
      ).text,
    ).toBe("cross-session-needle");
  });

  test("bounds and pages search and reads, and rejects cursors after branch changes", async () => {
    const manager = SessionManager.inMemory("/project");
    const first = manager.appendMessage(user("paged " + "x".repeat(40)));
    manager.appendMessage(user("paged second"));
    const service = new HistoryService();
    const page1: any = await service.search({ query: "paged", limit: 1 }, { sessionManager: manager });
    expect(page1.matches).toHaveLength(1);
    expect(page1.nextCursor).toBeString();
    const page2: any = await service.search(
      { query: "paged", limit: 1, cursor: page1.nextCursor },
      { sessionManager: manager },
    );
    expect(page2.matches).toHaveLength(1);
    const target = [page1, page2]
      .flatMap((page: any) => page.matches)
      .find((item: any) => item.provenance.entryId === first);
    const read1: any = await service.read({ ref: target.ref, maxChars: 7 }, { sessionManager: manager });
    expect(read1.text.length).toBe(7);
    const read2: any = await service.read(
      { ref: target.ref, maxChars: 7, cursor: read1.nextCursor },
      { sessionManager: manager },
    );
    expect(read2.range.start).toBe(7);
    manager.appendMessage(user("later append"));
    expect(
      (
        (await service.search(
          { query: "paged", limit: 1, cursor: page1.nextCursor },
          { sessionManager: manager },
        )) as any
      ).matches,
    ).toHaveLength(1);
    manager.branch(first);
    await expect(
      service.search({ query: "paged", limit: 1, cursor: page1.nextCursor }, { sessionManager: manager }),
    ).rejects.toThrow("active branch");
  });
});
