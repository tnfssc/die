import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuestionService } from "../src/questions/service";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "die-questions-"));
  let leaf = "root";
  let entries: Array<{ id: string; parentId: string | null }> = [{ id: "root", parentId: null }];
  const file = join(dir, "s.jsonl");
  const ctx = {
    sessionManager: {
      getSessionId: () => "s",
      getSessionFile: () => file,
      getLeafId: () => leaf,
      getBranch: () => {
        const branch = [];
        let id: string | null = leaf;
        while (id) {
          const e = entries.find((e) => e.id === id);
          if (!e) break;
          branch.unshift(e);
          id = e.parentId;
        }
        return branch;
      },
      getEntries: () => entries,
    },
  };
  return {
    ctx,
    file,
    move(id: string, parent: string) {
      entries.push({ id, parentId: parent });
      leaf = id;
    },
    navigate(id: string) {
      leaf = id;
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("nonblocking, context, choices, explicit block and resolution survive reload", async () => {
  const f = fixture();
  try {
    const s = new QuestionService();
    const q = await s.ask(f.ctx, {
      text: "Pick",
      choices: ["A", "B"],
      allowFreeText: false,
      requester: "analyst",
      taskIds: ["t1"],
      reason: "Need input",
      dedupKey: "k",
    });
    expect(q.blocked).toBeUndefined();
    expect(new QuestionService().get(f.ctx, q.id).requester).toBe("analyst");
    const b = await s.block(f.ctx, {
      id: q.id,
      owner: q.owner,
      version: q.version,
      checkpoint: "Await selection",
      foreground: true,
      taskIds: ["t1"],
    });
    expect(b.blocked?.checkpoint).toBe("Await selection");
    await expect(s.answer(f.ctx, { id: q.id, owner: q.owner, version: b.version, text: "wrong" })).rejects.toThrow(
      "choice",
    );
    const a = await s.answer(f.ctx, { id: q.id, owner: q.owner, version: b.version, text: "A", replyId: "ui-event-1" });
    expect(a.delivery).toBe("resume-needed");
    expect(a.replyId).toBe("ui-event-1");
    expect(
      await s.answer(f.ctx, { id: q.id, owner: q.owner, version: b.version, text: "A", replyId: "ui-event-1" }),
    ).toEqual(a);
    await expect(
      s.answer(f.ctx, { id: q.id, owner: q.owner, version: b.version, text: "B", replyId: "ui-event-1" }),
    ).rejects.toThrow("Stale");
    const delivered = await s.setDelivery(f.ctx, { id: q.id, owner: q.owner, version: a.version, delivery: "queued" });
    expect(new QuestionService().get(f.ctx, q.id).delivery).toBe("queued");
    expect(delivered.version).toBe(a.version + 1);
    expect(() => s.handle("questions.answer", { id: q.id }, f.ctx)).toThrow("UI reply only");
    const other = await s.ask(f.ctx, { text: "Optional", choices: ["Y"], allowFreeText: true });
    expect(
      (await s.resolve(f.ctx, { id: other.id, owner: other.owner, version: 1, reason: "No longer needed" }))
        .resolutionReason,
    ).toBe("No longer needed");
  } finally {
    f.cleanup();
  }
});
test("dedup after progress, sibling fork is read-only, navigation during lock wait", async () => {
  const f = fixture();
  try {
    const s = new QuestionService();
    const q = await s.ask(f.ctx, { text: "What?", dedupKey: "request" });
    f.move("original", "root");
    f.move("progress", "original");
    expect((await s.ask(f.ctx, { text: "What?", dedupKey: "request" })).id).toBe(q.id);
    f.move("sibling", "root");
    expect(s.get(f.ctx, q.id).id).toBe(q.id);
    await expect(s.answer(f.ctx, { id: q.id, owner: q.owner, version: 1, text: "no" })).rejects.toThrow("owner branch");
    expect((await s.ask(f.ctx, { text: "What?", dedupKey: "request" })).id).not.toBe(q.id);
    f.navigate("progress");
    const lock = f.file + ".questions.json.lock";
    writeFileSync(lock, "held");
    const pending = s.answer(f.ctx, { id: q.id, owner: q.owner, version: 1, text: "late" });
    await Bun.sleep(40);
    f.navigate("sibling");
    unlinkSync(lock);
    await expect(pending).rejects.toThrow("navigation changed");
    expect(s.get(f.ctx, q.id).status).toBe("pending");
  } finally {
    f.cleanup();
  }
});
test("bounded ledger and answer/cancel race without loss", async () => {
  const f = fixture();
  try {
    const s = new QuestionService();
    const first = await s.ask(f.ctx, { text: "First" });
    for (let i = 1; i < 20; i++) await s.ask(f.ctx, { text: "Question " + i });
    await expect(s.ask(f.ctx, { text: "overflow" })).rejects.toThrow("Too many");
    const outcomes = await Promise.allSettled([
      s.answer(f.ctx, { id: first.id, owner: first.owner, version: 1, text: "yes" }),
      s.cancel(f.ctx, { id: first.id, owner: first.owner, version: 1 }),
    ]);
    expect(outcomes.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(new QuestionService().list(f.ctx).length).toBe(20);
    const room = await s.ask(f.ctx, { text: "room" });
    await s.cancel(f.ctx, { id: room.id, owner: room.owner, version: 1 });
    for (let i = 0; i < 199; i++) {
      const q = await s.ask(f.ctx, { text: "terminal " + i });
      await s.cancel(f.ctx, { id: q.id, owner: q.owner, version: 1 });
    }
    await expect(s.ask(f.ctx, { text: "ledger full" })).rejects.toThrow("ledger full");
    expect(new QuestionService().list(f.ctx).length).toBe(220);
  } finally {
    f.cleanup();
  }
});

test("navigation to an ancestor is history only; deeper sibling forks cannot answer", async () => {
  const f = fixture();
  try {
    const s = new QuestionService();
    const q = await s.ask(f.ctx, { text: "Original?" });
    f.move("first", "root");
    f.move("original-tip", "first");
    f.navigate("root");
    expect(s.get(f.ctx, q.id).readOnly).toBe(true);
    await expect(s.answer(f.ctx, { id: q.id, owner: q.owner, version: 1, text: "wrong branch" })).rejects.toThrow(
      "owner branch",
    );
    await expect(s.ask(f.ctx, { text: "New?" })).rejects.toThrow("branch tip");
    f.move("deeper-fork", "first");
    expect(s.get(f.ctx, q.id).readOnly).toBe(true);
    await expect(s.answer(f.ctx, { id: q.id, owner: q.owner, version: 1, text: "wrong fork" })).rejects.toThrow(
      "owner branch",
    );
    f.navigate("original-tip");
    expect(s.get(f.ctx, q.id).readOnly).toBe(false);
    await s.answer(f.ctx, { id: q.id, owner: q.owner, version: 1, text: "original" });
  } finally {
    f.cleanup();
  }
});
