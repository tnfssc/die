import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertToLlm, type SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  buildShakePlan,
  isShakeRecord,
  latestShakeRecord,
  MANUAL_SHAKE_ENTRY,
  projectShakenContext,
  registerManualShake,
} from "../src/tasks/manual-shake";

const usage = {
  input: 100,
  output: 10,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 110,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const assistant = (content: any[], stopReason = "toolUse") =>
  ({
    role: "assistant",
    api: "anthropic-messages",
    provider: "test",
    model: "test",
    content,
    stopReason,
    usage,
    timestamp: Date.now(),
  }) as any;
const result = (id: string, text = "result") =>
  ({
    role: "toolResult",
    toolCallId: id,
    toolName: "execute",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  }) as any;

function completed(manager: SessionManager, id: string, prose = "") {
  manager.appendMessage(
    assistant([
      { type: "thinking", thinking: "private" },
      ...(prose ? [{ type: "text", text: prose }] : []),
      { type: "toolCall", id, name: "execute", arguments: { code: id } },
    ]),
  );
  manager.appendMessage(result(id));
}

describe("manual shake projection", () => {
  test("pairs completed protocol and retains user, mixed prose, finals, and attachments in order", () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage({
      role: "user",
      content: [
        { type: "text", text: "ask" },
        { type: "image", data: "AA==", mimeType: "image/png" },
      ],
      timestamp: 1,
    } as any);
    completed(manager, "call-1", "I will check; this prose is ambiguous.");
    manager.appendMessage(
      assistant(
        [
          { type: "thinking", thinking: "hidden final" },
          { type: "text", text: "Final answer" },
        ],
        "stop",
      ),
    );
    const entries = manager.buildContextEntries();
    const plan = buildShakePlan(entries, manager.getSessionId());
    expect(plan.unresolvedToolCallIds).toEqual([]);
    expect(plan.removedAssistantBlocks).toBe(3);
    expect(plan.removedToolResults).toBe(1);
    const projected = projectShakenContext(manager.buildSessionContext().messages, entries, plan.record);
    expect(projected.map((message: any) => message.role)).toEqual(["user", "assistant", "assistant"]);
    expect((projected[0] as any).content[1]).toMatchObject({ type: "image", data: "AA==" });
    expect((projected[1] as any).content).toEqual([{ type: "text", text: "I will check; this prose is ambiguous." }]);
    expect((projected[2] as any).content).toEqual([{ type: "text", text: "Final answer" }]);
    expect(JSON.stringify(projected)).not.toContain("private");
    expect(JSON.stringify(projected)).not.toContain("toolCall");
  });

  test("matches duplicate verbatim messages by occurrence without removing later dialogue", () => {
    const manager = SessionManager.inMemory();
    const duplicate = assistant([{ type: "text", text: "same" }], "stop");
    manager.appendMessage(duplicate);
    completed(manager, "dup");
    manager.appendMessage(structuredClone(duplicate));
    const entries = manager.buildContextEntries();
    const plan = buildShakePlan(entries, manager.getSessionId());
    const incoming = manager.buildSessionContext().messages;
    expect(
      projectShakenContext(incoming, entries, plan.record).filter((m: any) => m.content?.[0]?.text === "same"),
    ).toHaveLength(2);
  });

  test("preserves an entire tool batch when either transformed side no longer matches", () => {
    for (const changedSide of ["call", "result"] as const) {
      const manager = SessionManager.inMemory();
      completed(manager, "pair", "status");
      const entries = manager.buildContextEntries();
      const plan = buildShakePlan(entries, manager.getSessionId());
      const incoming = manager.buildSessionContext().messages.map((message: any) => {
        if (changedSide === "result" && message.role === "toolResult") {
          return { ...message, content: [{ type: "text", text: "[REDACTED]" }] };
        }
        if (changedSide === "call" && message.role === "assistant") {
          return {
            ...message,
            content: message.content.map((part: any) =>
              part.type === "toolCall" ? { ...part, arguments: { code: "[REDACTED]" } } : part,
            ),
          };
        }
        return message;
      });
      const projected = projectShakenContext(incoming, entries, plan.record);
      expect(projected.some((message: any) => message.role === "toolResult")).toBe(true);
      expect(JSON.stringify(projected)).toContain("toolCall");
      expect(JSON.stringify(projected)).not.toContain(changedSide === "result" ? '"text":"result"' : '"code":"pair"');
    }
  });

  test("preserves chronology-ambiguous duplicate content after an upstream exclusion", () => {
    const manager = SessionManager.inMemory();
    const duplicate = assistant([{ type: "thinking", thinking: "same" }], "stop");
    manager.appendMessage(duplicate);
    manager.appendMessage(structuredClone(duplicate));
    const entries = manager.buildContextEntries();
    const plan = buildShakePlan(entries, manager.getSessionId());
    const projected = projectShakenContext([structuredClone(duplicate)], entries, plan.record);
    expect(projected).toHaveLength(1);
    expect(JSON.stringify(projected)).toContain("same");
  });

  test("removes an exact group beside an ambiguous transformed group", () => {
    const manager = SessionManager.inMemory();
    completed(manager, "stable");
    completed(manager, "target");
    const entries = manager.buildContextEntries();
    const plan = buildShakePlan(entries, manager.getSessionId());
    const incoming = manager
      .buildSessionContext()
      .messages.map((message: any) =>
        message.role === "toolResult" && message.toolCallId === "target"
          ? { ...message, content: [{ type: "text", text: "[REDACTED]" }] }
          : message,
      );
    const wire = JSON.stringify(projectShakenContext(incoming, entries, plan.record));
    expect(wire).not.toContain('"id":"stable"');
    expect(wire).toContain('"id":"target"');
  });

  test("refuses unresolved, orphaned, and duplicate protocol IDs", () => {
    const unresolved = SessionManager.inMemory();
    unresolved.appendMessage(assistant([{ type: "toolCall", id: "active", name: "execute", arguments: {} }]));
    expect(buildShakePlan(unresolved.buildContextEntries(), unresolved.getSessionId()).unresolvedToolCallIds).toEqual([
      "active",
    ]);
    const orphan = SessionManager.inMemory();
    orphan.appendMessage(result("missing"));
    expect(buildShakePlan(orphan.buildContextEntries(), orphan.getSessionId()).orphanToolResultIds).toEqual([
      "missing",
    ]);
  });

  test("repeated shake is a no-op until a new completed trace exists", () => {
    const manager = SessionManager.inMemory();
    completed(manager, "one");
    const first = buildShakePlan(manager.buildContextEntries(), manager.getSessionId());
    manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, first.record);
    const second = buildShakePlan(manager.buildContextEntries(), manager.getSessionId());
    expect([second.removedAssistantBlocks, second.removedToolResults]).toEqual([0, 0]);
    completed(manager, "two");
    const third = buildShakePlan(manager.buildContextEntries(), manager.getSessionId());
    expect(third.removedAssistantBlocks).toBe(2);
    expect(third.removedToolResults).toBe(1);
  });

  test("preserves prior context exclusions instead of restoring filtered messages", () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage({ role: "user", content: "EXCLUDED", timestamp: 1 });
    completed(manager, "x");
    manager.appendMessage({ role: "user", content: "kept", timestamp: 2 });
    const entries = manager.buildContextEntries(),
      plan = buildShakePlan(entries, manager.getSessionId());
    const incoming = manager.buildSessionContext().messages.filter((m: any) => m.content !== "EXCLUDED");
    expect(projectShakenContext(incoming, entries, plan.record).map((m: any) => m.content)).toEqual(["kept"]);
  });
});

describe("manual shake marker validation and bounds", () => {
  test("rejects malformed newest markers instead of falling back to an older valid record", () => {
    const manager = SessionManager.inMemory();
    completed(manager, "valid");
    const valid = buildShakePlan(manager.buildContextEntries(), manager.getSessionId()).record;
    manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, valid);
    manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, { ...valid, version: 99 });
    expect(() => latestShakeRecord(manager.buildContextEntries(), manager.getSessionId())).toThrow(
      "unsupported version",
    );
    expect(isShakeRecord({ ...valid, assistantEntryIds: ["x", "x"] })).toBe(false);
    expect(isShakeRecord({ ...valid, shakenAt: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isShakeRecord({ ...valid, extra: true })).toBe(false);
  });

  test("bounds an oversized active projection and trims IDs no longer in the active window", () => {
    const manager = SessionManager.inMemory();
    for (let index = 0; index < 2049; index++)
      manager.appendMessage(assistant([{ type: "thinking", thinking: String(index) }], "stop"));
    const oversized = buildShakePlan(manager.buildContextEntries(), manager.getSessionId());
    expect(oversized.storageError).toContain("Compact or branch");
    const one = SessionManager.inMemory();
    completed(one, "old");
    const old = buildShakePlan(one.buildContextEntries(), one.getSessionId()).record;
    const user = one.appendMessage({ role: "user", content: "new window", timestamp: 3 });
    const trimmed = buildShakePlan(
      one.buildContextEntries().filter((entry) => entry.id === user),
      one.getSessionId(),
      old,
    );
    expect(trimmed.record.assistantEntryIds).toEqual([]);
    expect(trimmed.record.toolResultEntryIds).toEqual([]);
  });
});

describe("manual shake durability and SDK projection", () => {
  test("survives JSONL reload, is branch-scoped, and serializes through the real SDK converter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-shake-"));
    try {
      const manager = SessionManager.create(dir, dir);
      const before = manager.appendMessage({ role: "user", content: "before", timestamp: 1 });
      completed(manager, "persist", "status text");
      const plan = buildShakePlan(manager.buildContextEntries(), manager.getSessionId());
      manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, plan.record);
      manager.appendMessage(assistant([{ type: "text", text: "done" }], "stop"));
      const file = manager.getSessionFile()!;
      const original = await readFile(file, "utf8");
      const reopened = SessionManager.open(file);
      const record = latestShakeRecord(reopened.buildContextEntries(), reopened.getSessionId())!;
      const projected = projectShakenContext(
        reopened.buildSessionContext().messages,
        reopened.buildContextEntries(),
        record,
      );
      const wire = convertToLlm(projected);
      expect(JSON.stringify(wire)).toContain("status text");
      expect(JSON.stringify(wire)).toContain("done");
      expect(JSON.stringify(wire)).not.toContain("toolCall");
      expect(await readFile(file, "utf8")).toBe(original);
      const inheritedFile = reopened.createBranchedSession(reopened.getLeafId()!)!;
      const inherited = SessionManager.open(inheritedFile);
      expect(latestShakeRecord(inherited.buildContextEntries(), inherited.getSessionId())?.sessionId).toBe(
        inherited.getSessionId(),
      );
      const inheritedRecord = latestShakeRecord(inherited.buildContextEntries(), inherited.getSessionId())!;
      expect(
        JSON.stringify(
          projectShakenContext(
            inherited.buildSessionContext().messages,
            inherited.buildContextEntries(),
            inheritedRecord,
          ),
        ),
      ).not.toContain("toolCall");
      reopened.branch(before);
      expect(latestShakeRecord(reopened.buildContextEntries(), reopened.getSessionId())).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("plain summary and shaken retained tail survive SDK JSONL reload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "die-shake-compact-"));
    try {
      const manager = SessionManager.create(dir, dir);
      manager.appendMessage({ role: "user", content: "old", timestamp: 1 });
      completed(manager, "tail", "tail prose");
      const plan = buildShakePlan(manager.buildContextEntries(), manager.getSessionId());
      manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, plan.record);
      const tailStart = (
        manager.getEntries().find((e: any) => e.type === "message" && e.message.role === "assistant") as SessionEntry
      ).id;
      manager.appendCompaction("PLAIN SUMMARY", tailStart, 100, { strategy: "cache-affine-plaintext" }, true);
      const carried = buildShakePlan(manager.buildContextEntries(), manager.getSessionId(), plan.record);
      manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, carried.record);

      const reopened = SessionManager.open(manager.getSessionFile()!);
      const entries = reopened.buildContextEntries();
      const record = latestShakeRecord(entries, reopened.getSessionId())!;
      const projected = projectShakenContext(reopened.buildSessionContext().messages, entries, record);
      expect((projected[0] as any).summary).toBe("PLAIN SUMMARY");
      expect(JSON.stringify(projected)).toContain("tail prose");
      expect(JSON.stringify(projected)).not.toContain("toolCall");
      expect(record.assistantEntryIds).toHaveLength(1);
      expect(record.toolResultEntryIds).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("manual command safeguards", () => {
  function harness(manager: SessionManager, idle = true, pending = false) {
    const handlers = new Map<string, Function[]>(),
      commands = new Map<string, any>(),
      notices: Array<[string, string]> = [],
      appended: any[] = [];
    const pi: any = {
      on: (name: string, fn: Function) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
      registerCommand: (name: string, command: any) => commands.set(name, command),
      appendEntry: (type: string, data: any) => {
        appended.push({ type, data });
        manager.appendCustomEntry(type, data);
      },
    };
    registerManualShake(pi);
    const ctx: any = {
      sessionManager: manager,
      isIdle: () => idle,
      hasPendingMessages: () => pending,
      ui: { notify: (m: string, t: string) => notices.push([m, t]) },
    };
    return { handlers, command: commands.get("shake"), notices, appended, ctx };
  }
  test("persists before projection, keeps background ownership external, and carries state after compaction", async () => {
    const manager = SessionManager.inMemory();
    completed(manager, "ok", "handoff final text");
    const h = harness(manager);
    await h.command.handler("", h.ctx);
    expect(h.appended).toHaveLength(1);
    expect(h.notices[0]![0]).toContain("no provider request");
    const contextHandler = h.handlers.get("context")![0]!;
    const projected = contextHandler({ messages: manager.buildSessionContext().messages }, h.ctx).messages;
    expect(JSON.stringify(projected)).toContain("handoff final text");
    expect(JSON.stringify(projected)).not.toContain("toolCall");
    const beforeCarry = h.appended.length;
    h.handlers.get("session_compact")![0]!({}, h.ctx);
    expect(h.appended).toHaveLength(beforeCarry + 1);
  });

  test("repeated-shake estimates start from prior projection rather than original trace", async () => {
    const manager = SessionManager.inMemory();
    completed(manager, "huge", "");
    const hugeResult = manager
      .getEntries()
      .find((entry: any) => entry.type === "message" && entry.message.role === "toolResult") as any;
    hugeResult.message.content = [{ type: "text", text: "excluded ".repeat(4000) }];
    const first = harness(manager);
    await first.command.handler("", first.ctx);
    completed(manager, "small");
    const second = harness(manager);
    await second.command.handler("", second.ctx);
    const notice = second.notices.at(-1)?.[0] ?? "";
    const before = Number(notice.match(/~(\d+) →/)?.[1]);
    expect(before).toBeLessThan(100);
  });

  test("a malformed latest marker fails the context hook closed", () => {
    const manager = SessionManager.inMemory();
    completed(manager, "x");
    const record = buildShakePlan(manager.buildContextEntries(), manager.getSessionId()).record;
    manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, record);
    manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, { ...record, assistantEntryIds: ["duplicate", "duplicate"] });
    const h = harness(manager);
    expect(() => h.handlers.get("context")?.[0]?.({ messages: manager.buildSessionContext().messages }, h.ctx)).toThrow(
      "Refusing to expose unprojected context",
    );
  });

  test("refuses active batches and opaque native checkpoints without durable mutation", async () => {
    const active = SessionManager.inMemory();
    completed(active, "a");
    const h1 = harness(active, false);
    await h1.command.handler("", h1.ctx);
    expect(h1.appended).toEqual([]);
    expect(h1.notices[0]![0]).toContain("wait until");
    const native = SessionManager.inMemory();
    const first = native.appendMessage({ role: "user", content: "x", timestamp: 1 });
    native.appendCompaction("opaque", first, 1, { strategy: "codex-native", version: 1 }, true);
    const h2 = harness(native);
    await h2.command.handler("", h2.ctx);
    expect(h2.appended).toEqual([]);
    expect(h2.notices[0]![0]).toContain("opaque native Codex");
  });
});
