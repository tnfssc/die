import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertToLlm, SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  buildShakePlan,
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
      expect(latestShakeRecord(inherited.buildContextEntries(), inherited.getSessionId())).toBeDefined();
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

  test("plain compaction summary stays intact and a carried marker filters only its retained tail", () => {
    const manager = SessionManager.inMemory();
    const old = manager.appendMessage({ role: "user", content: "old", timestamp: 1 });
    completed(manager, "tail", "tail prose");
    const plan = buildShakePlan(manager.buildContextEntries(), manager.getSessionId());
    manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, plan.record);
    const tailStart = (
      manager.getEntries().find((e: any) => e.type === "message" && e.message.role === "assistant") as SessionEntry
    ).id;
    manager.appendCompaction("PLAIN SUMMARY", tailStart, 100, { strategy: "cache-affine-plaintext" }, true);
    manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, plan.record);
    const entries = manager.buildContextEntries(),
      record = latestShakeRecord(entries, manager.getSessionId())!;
    const projected = projectShakenContext(manager.buildSessionContext().messages, entries, record);
    expect((projected[0] as any).summary).toBe("PLAIN SUMMARY");
    expect(JSON.stringify(projected)).toContain("tail prose");
    expect(JSON.stringify(projected)).not.toContain("toolCall");
    expect(old).toBeTruthy();
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
