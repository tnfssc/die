import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuestionService } from "../src/questions/service";

test("durable branch-owned questions, dedup, stale updates and answer/cancel race", async () => {
  const dir = mkdtempSync(join(tmpdir(), "die-questions-"));
  let leaf = "root";
  const ctx = {
    sessionManager: {
      getSessionId: () => "session",
      getSessionFile: () => join(dir, "session.jsonl"),
      getLeafId: () => leaf,
      getBranch: () => [{ id: "root" }, ...(leaf === "root" ? [] : [{ id: leaf }])],
    },
  };
  try {
    const service = new QuestionService();
    expect(() => service.list(ctx)).not.toThrow();
    expect(() => service.ask(ctx, { text: "No", blocked: false as true })).toThrow();
    const q = await service.ask(ctx, { text: "What?", blocked: true, dedupKey: "one" });
    expect((await service.ask(ctx, { text: "What?", blocked: true, dedupKey: "one" })).id).toBe(q.id);
    await expect(service.ask(ctx, { text: "Different", blocked: true, dedupKey: "one" })).rejects.toThrow();
    expect(new QuestionService().get(ctx, q.id).status).toBe("pending");
    leaf = "child";
    expect((await service.ask(ctx, { text: "What?", blocked: true, dedupKey: "one" })).id).toBe(q.id);
    const [answer, cancel] = await Promise.allSettled([
      service.answer(ctx, { id: q.id, owner: q.owner, version: 1, text: "Yes" }),
      service.cancel(ctx, { id: q.id, owner: q.owner, version: 1 }),
    ]);
    expect([answer.status, cancel.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(new QuestionService().get(ctx, q.id).version).toBe(2);
    await expect(service.answer(ctx, { id: q.id, owner: q.owner, version: 1, text: "Again" })).rejects.toThrow("Stale");
    expect(() => service.cancel(ctx, { id: q.id, owner: { ...q.owner, branchId: "other" }, version: 2 })).toThrow();
    const childOnly = await service.ask(ctx, { text: "Child?", blocked: true });
    leaf = "sibling";
    expect(() => service.get(ctx, q.id)).not.toThrow(); // root ancestor remains visible
    expect(() => service.get(ctx, childOnly.id)).toThrow();
    await expect(
      service.answer(ctx, { id: childOnly.id, owner: childOnly.owner, version: 1, text: "wrong branch" }),
    ).rejects.toThrow();
    expect(() => service.ask(ctx, { text: "x".repeat(4001), blocked: true })).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bounded active count and answer text without discarding pending records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "die-questions-cap-"));
  const ctx = {
    sessionManager: {
      getSessionId: () => "s",
      getSessionFile: () => join(dir, "s.jsonl"),
      getLeafId: () => "root",
      getBranch: () => [{ id: "root" }],
    },
  };
  try {
    const service = new QuestionService();
    const first = await service.ask(ctx, { text: "First", blocked: true });
    for (let i = 1; i < 20; i++) await service.ask(ctx, { text: "Question " + i, blocked: true });
    await expect(service.ask(ctx, { text: "Over cap", blocked: true })).rejects.toThrow("Too many");
    expect(() =>
      service.answer(ctx, { id: first.id, owner: first.owner, version: 1, text: "a".repeat(8001) }),
    ).toThrow();
    expect(service.list(ctx).length).toBe(20);
    await service.cancel(ctx, { id: first.id, owner: first.owner, version: 1 });
    expect((await service.ask(ctx, { text: "Room", blocked: true })).status).toBe("pending");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
