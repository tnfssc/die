import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerQuestionRuntime } from "../src/questions/runtime";

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "die-question-runtime-"));
  const handlers = new Map<string, (event: any, ctx: any) => void>();
  const sent: Array<{ message: any; options: any }> = [];
  let idle = false,
    owner = false,
    supported = true,
    leaf = "root",
    session = "session";
  const manager = {
    getSessionFile: () => join(dir, "session.jsonl"),
    getSessionId: () => session,
    getLeafId: () => leaf,
    getBranch: () => [{ id: "root" }, ...(leaf === "root" ? [] : [{ id: leaf }])],
  };
  const ctx: any = { sessionManager: manager, isIdle: () => idle, signal: undefined };
  const pi = {
    on: (name: string, fn: (event: any, ctx: any) => void) => {
      handlers.set(name, fn);
    },
    sendMessage: (message: any, options: any) => {
      sent.push({ message, options });
    },
  };
  const runtime = registerQuestionRuntime(pi as any, {
    supported: () => supported,
    hasMainToolOwner: () => owner,
  });
  const emit = (name: string, context = ctx, event: any = {}) => handlers.get(name)!(event, context);
  emit("session_start");
  const tick = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return {
    runtime,
    ctx,
    manager,
    sent,
    emit,
    tick,
    cleanup,
    idle: (v: boolean) => {
      idle = v;
    },
    owner: (v: boolean) => {
      owner = v;
    },
    supported: (v: boolean) => {
      supported = v;
    },
    leaf: (v: string) => {
      leaf = v;
    },
    session: (v: string) => {
      session = v;
    },
  };
}

test("saved answer queues until idle settlement, unrelated turns do not erase pending", async () => {
  const h = harness();
  try {
    const q = await h.runtime.service.ask(h.ctx, { text: "Which?" });
    h.emit("agent_settled"); // unrelated progress before an answer
    expect(h.runtime.service.get(h.ctx, q.id).status).toBe("pending");
    const answer = await h.runtime.commands(h.ctx).handle("questions.answer", { id: q.id, answer: "This" });
    expect((answer as any).status).toBe("answered");
    await h.tick();
    expect(h.sent).toHaveLength(0);
    h.emit("agent_end", h.ctx, { messages: [{ role: "assistant", stopReason: "stop" }] });
    h.emit("agent_settled");
    expect(h.sent).toHaveLength(0); // still busy
    h.idle(true);
    h.owner(true);
    h.emit("agent_settled");
    expect(h.sent).toHaveLength(0); // Live owns the parent turn
    h.owner(false);
    h.emit("agent_settled");
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.options).toMatchObject({ triggerTurn: true, deliverAs: "followUp" });
    expect(h.sent[0]!.message.details.questionId).toBe(q.id);
    h.emit("agent_settled");
    expect(h.sent).toHaveLength(1);
    await expect(h.runtime.commands(h.ctx).handle("questions.answer", { id: q.id, answer: "Again" })).rejects.toThrow();
    expect(h.sent).toHaveLength(1);
  } finally {
    h.cleanup();
  }
});

test("restart keeps durable answers but does not replay; explicit resume dispatches once", async () => {
  const h = harness();
  try {
    const q = await h.runtime.service.ask(h.ctx, { text: "Which?" });
    await h.runtime.commands(h.ctx).handle("questions.answer", { id: q.id, answer: "Saved" });
    h.runtime.pause();
    h.idle(true);
    const pi: any = { on: () => {}, sendMessage: (message: any) => h.sent.push({ message, options: {} }) };
    const fresh = registerQuestionRuntime(pi, { supported: () => true, hasMainToolOwner: () => false });
    expect(fresh.service.get(h.ctx, q.id).answer).toBe("Saved");
    await h.tick();
    expect(h.sent).toHaveLength(0);
    await fresh.commands(h.ctx).handle("questions.resume", { id: q.id });
    await h.tick();
    expect(h.sent).toHaveLength(1);
  } finally {
    h.cleanup();
  }
});

test("navigation and stopWork pause discard queued wake; pending background result is not a question answer", async () => {
  const h = harness();
  try {
    const q = await h.runtime.service.ask(h.ctx, { text: "Wait?" });
    h.emit("agent_settled", h.ctx, { task: "background completion" });
    expect(h.runtime.service.get(h.ctx, q.id).status).toBe("pending");
    await h.runtime.commands(h.ctx).handle("questions.answer", { id: q.id, answer: "yes" });
    h.leaf("sibling");
    h.emit("session_tree");
    h.idle(true);
    h.emit("agent_settled");
    await h.tick();
    expect(h.sent).toHaveLength(0);
    h.leaf("root");
    h.idle(false);
    const second = await h.runtime.service.ask(h.ctx, { text: "Stop?" });
    await h.runtime.commands(h.ctx).handle("questions.answer", { id: second.id, answer: "yes" });
    h.runtime.pause(); // stopWork
    h.emit("agent_settled");
    await h.tick();
    expect(h.sent).toHaveLength(0);
    expect(h.runtime.service.get(h.ctx, second.id).status).toBe("answered");
  } finally {
    h.cleanup();
  }
});

test("tool answers and unsupported child/web operations fail closed", async () => {
  const h = harness();
  try {
    await expect(h.runtime.handle(h.ctx, "questions.answer", {})).rejects.toThrow("targeted user reply");
    h.supported(false);
    await expect(h.runtime.handle(h.ctx, "questions.ask", { text: "no" })).rejects.toThrow("not supported");
    await expect(h.runtime.commands(h.ctx).handle("questions.list")).rejects.toThrow("parent CLI");
    expect(h.runtime.hasBlockingQuestions()).toBe(false);
  } finally {
    h.cleanup();
  }
});

test("late old-session callbacks cannot replace the navigated manager", async () => {
  const h = harness();
  try {
    const oldCommands = h.runtime.commands(h.ctx);
    const next = {
      ...h.ctx,
      sessionManager: {
        getSessionFile: () => join(h.manager.getSessionFile(), "other"),
        getSessionId: () => "other",
        getLeafId: () => "root",
        getBranch: () => [{ id: "root" }],
      },
    };
    h.emit("session_start", next);
    h.idle(true);
    h.emit("agent_settled", h.ctx); // stale callback
    await expect(oldCommands.handle("questions.ask", { text: "stale" })).rejects.toThrow("no longer active");
    await expect(h.runtime.handle(h.ctx, "questions.list", {})).rejects.toThrow("no longer active");
    expect(h.sent).toHaveLength(0);
  } finally {
    h.cleanup();
  }
});

test("explicit resume queue is bounded by pending-question capacity", async () => {
  const h = harness();
  try {
    const saved = [];
    for (let i = 0; i < 21; i++) {
      const q = await h.runtime.service.ask(h.ctx, { text: "Q" + i });
      saved.push(
        await h.runtime.service.answer(h.ctx, { id: q.id, owner: q.owner, version: q.version, text: "A" + i }),
      );
    }
    h.runtime.pause();
    for (const q of saved.slice(0, 20)) await h.runtime.commands(h.ctx).handle("questions.resume", { id: q.id });
    await expect(h.runtime.commands(h.ctx).handle("questions.resume", { id: saved[20]!.id })).rejects.toThrow(
      "Too many queued",
    );
    expect(h.sent).toHaveLength(0);
  } finally {
    h.cleanup();
  }
});
