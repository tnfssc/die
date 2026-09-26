import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type QuestionOwner = { sessionId: string; branchId: string };
export type Question = {
  id: string;
  owner: QuestionOwner;
  text: string;
  status: "pending" | "answered" | "cancelled";
  version: number;
  createdAt: string;
  updatedAt: string;
  answer?: string;
  dedupKey?: string;
  choices?: string[];
  allowFreeText?: boolean;
  requester?: string;
  taskIds?: string[];
  reason?: string;
  blocked?: { checkpoint: string; foreground?: boolean; taskIds?: string[] };
  delivery?: "resume-needed" | "queued" | "delivered";
  replyId?: string;
  replyVersion?: number;
};
export type QuestionContext = {
  sessionManager: {
    getSessionId(): string;
    getSessionFile(): string | undefined;
    getLeafId(): string | null;
    getBranch(): Array<{ id: string }>;
    getEntries?(): Array<{ id: string; parentId?: string | null }>;
  };
};
export type QuestionMutation = { id: string; owner: QuestionOwner; version: number };
const maxPending = 20,
  maxHistory = 200;
function text(value: unknown, limit: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new Error(label + " must be nonempty and at most " + limit + " characters");
  return value.trim();
}
function path(ctx: QuestionContext): string {
  const file = ctx.sessionManager.getSessionFile();
  if (!file) throw new Error("Questions require a persistent session file");
  return file + ".questions.json";
}
function activeOwner(ctx: QuestionContext, branchId?: string): QuestionOwner {
  const m = ctx.sessionManager,
    sessionId = m.getSessionId(),
    leaf = m.getLeafId();
  if (!sessionId || !leaf) throw new Error("Questions require a saved session branch");
  if (branchId && branchId !== leaf && !m.getBranch().some((e) => e.id === branchId))
    throw new Error("Owner branch is not active");
  return { sessionId, branchId: branchId ?? leaf };
}
function read(file: string): Question[] {
  try {
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      !Array.isArray(data) ||
      data.length > maxPending + maxHistory ||
      !data.every(
        (q) =>
          q &&
          typeof q.id === "string" &&
          typeof q.owner?.sessionId === "string" &&
          typeof q.owner?.branchId === "string" &&
          Number.isSafeInteger(q.version) &&
          ["pending", "answered", "cancelled"].includes(q.status),
      )
    )
      throw new Error("Invalid question ledger");
    return data as Question[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
function write(file: string, records: Question[]): void {
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temp, JSON.stringify(records), { flag: "wx", mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {}
    throw error;
  }
}
/** One durable ledger per session file, including sibling branches. Never derive answers from transcripts. */
export class QuestionService {
  onAnswered?: (question: Question, ctx: QuestionContext) => void;
  private async change<T>(file: string, edit: (records: Question[]) => { result: T; changed: boolean }): Promise<T> {
    mkdirSync(dirname(file), { recursive: true });
    const lock = file + ".lock";
    let fd: number | undefined;
    for (let i = 0; i < 100; i++) {
      try {
        fd = openSync(lock, "wx", 0o600);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    if (fd === undefined) throw new Error("Question ledger busy; inspect stale lock before retrying");
    try {
      const records = read(file);
      const { result, changed } = edit(records);
      if (changed) write(file, records);
      return result;
    } finally {
      closeSync(fd);
      unlinkSync(lock);
    }
  }
  // First child of an anchor owns its continuation; later siblings can inspect, not mutate.
  private owns(ctx: QuestionContext, q: Question): boolean {
    const m = ctx.sessionManager;
    if (m.getSessionId() !== q.owner.sessionId) return false;
    const branch = m.getBranch().map(e => e.id);
    const at = branch.indexOf(q.owner.branchId);
    if (at < 0) return false;
    if (at === branch.length - 1) return true;
    const children = m.getEntries?.().filter(e => e.parentId === q.owner.branchId);
    return !children?.length || children[0]?.id === branch[at + 1];
  }
  list(ctx: QuestionContext): Question[] {
    const current = activeOwner(ctx);
    const ancestors = new Set(ctx.sessionManager.getBranch().map(e => e.id));
    ancestors.add(current.branchId);
    return read(path(ctx)).filter(q => q.owner.sessionId === current.sessionId && ancestors.has(q.owner.branchId));
  }
  get(ctx: QuestionContext, id: string): Question {
    const q = this.list(ctx).find(q => q.id === id);
    if (!q) throw new Error("Question not found on current branch");
    return q;
  }
  ask(ctx: QuestionContext, input: { text: string; dedupKey?: string; choices?: string[]; allowFreeText?: boolean; requester?: string; taskIds?: string[]; reason?: string }): Promise<Question> {
    const question = text(input?.text, 4000, "text");
    const key = input.dedupKey === undefined ? undefined : text(input.dedupKey, 128, "dedupKey");
    const choices = input.choices?.map(c => text(c, 500, "choice"));
    if (choices && (choices.length < 1 || choices.length > 20 || new Set(choices).size !== choices.length)) throw new Error("Invalid choices");
    if (input.allowFreeText !== undefined && typeof input.allowFreeText !== "boolean") throw new Error("Invalid allowFreeText");
    const requester = input.requester === undefined ? undefined : text(input.requester, 200, "requester");
    const reason = input.reason === undefined ? undefined : text(input.reason, 2000, "reason");
    const taskIds = ids(input.taskIds);
    const owner = activeOwner(ctx);
    return this.change(path(ctx), records => {
      activeOwner(ctx, owner.branchId); // navigation may have changed while waiting for the lock
      if (ctx.sessionManager.getLeafId() !== owner.branchId) throw new Error("Session navigation changed");
      if (key) {
        const existing = records.find(q => q.dedupKey === key && this.owns(ctx, q));
        if (existing) {
          if (JSON.stringify([existing.text, existing.choices, existing.allowFreeText, existing.requester, existing.taskIds, existing.reason]) !==
              JSON.stringify([question, choices, input.allowFreeText, requester, taskIds, reason])) throw new Error("dedupKey already used with different request");
          return { result: existing, changed: false };
        }
      }
      if (records.filter(q => q.status === "pending").length >= maxPending) throw new Error("Too many active questions");
      if (records.length >= maxPending + maxHistory) throw new Error("Question ledger full; retain unconsumed history");
      const now = new Date().toISOString();
      const result: Question = { id: "q_" + randomUUID(), owner, text: question, status: "pending", version: 1,
        createdAt: now, updatedAt: now, ...(key ? { dedupKey: key } : {}), ...(choices ? { choices } : {}),
        ...(input.allowFreeText !== undefined ? { allowFreeText: input.allowFreeText } : {}),
        ...(requester ? { requester } : {}), ...(taskIds ? { taskIds } : {}), ...(reason ? { reason } : {}) };
      records.push(result);
      return { result, changed: true };
    });
  }
  private mutate(ctx: QuestionContext, input: QuestionMutation, edit: (q: Question) => boolean): Promise<Question> {
    if (!input || !/^q_[0-9a-f-]{36}$/.test(input.id) || !Number.isSafeInteger(input.version) || input.version < 1)
      throw new Error("Invalid question ID or version");
    const sessionId = ctx.sessionManager.getSessionId();
    if (input.owner?.sessionId !== sessionId) throw new Error("Owner session mismatch");
    return this.change(path(ctx), records => {
      if (ctx.sessionManager.getSessionId() !== sessionId) throw new Error("Session navigation changed");
      const q = records.find(q => q.id === input.id && q.owner.sessionId === sessionId && q.owner.branchId === input.owner.branchId);
      if (!q || !this.owns(ctx, q)) throw new Error("Question not found for owner branch");
      const changed = edit(q);
      if (changed) { q.version++; q.updatedAt = new Date().toISOString(); }
      return { result: q, changed };
    });
  }
  block(ctx: QuestionContext, input: QuestionMutation & { checkpoint: string; foreground?: boolean; taskIds?: string[] }): Promise<Question> {
    const checkpoint = text(input?.checkpoint, 4000, "checkpoint");
    if (input.foreground !== undefined && typeof input.foreground !== "boolean") throw new Error("Invalid foreground");
    const taskIds = ids(input.taskIds);
    if (!input.foreground && !taskIds?.length) throw new Error("Block requires foreground or task IDs");
    return this.mutate(ctx, input, q => {
      check(q, input.version);
      q.blocked = { checkpoint, ...(input.foreground ? { foreground: true } : {}), ...(taskIds ? { taskIds } : {}) };
      return true;
    });
  }
  resolve(ctx: QuestionContext, input: QuestionMutation & { reason: string }): Promise<Question> {
    const reason = text(input?.reason, 2000, "reason");
    return this.mutate(ctx, input, q => { check(q, input.version); q.status = "cancelled"; q.reason = reason; return true; });
  }
  async answer(ctx: QuestionContext, input: QuestionMutation & { text: string; replyId?: string }): Promise<Question> {
    const answer = text(input?.text, 8000, "answer");
    if (input.replyId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(input.replyId)) throw new Error("Invalid replyId");
    let accepted = false;
    const result = await this.mutate(ctx, input, q => {
      if (q.status === "answered" && q.replyVersion === input.version && q.answer === answer && (!input.replyId || q.replyId === input.replyId)) return false;
      check(q, input.version);
      if (q.choices && q.allowFreeText === false && !q.choices.includes(answer)) throw new Error("Answer must match a choice");
      q.status = "answered"; q.answer = answer; q.replyId = input.replyId ?? "reply_" + randomUUID();
      q.replyVersion = input.version; q.delivery = "resume-needed"; accepted = true;
      return true;
    });
    if (accepted) this.onAnswered?.(result, ctx);
    return result;
  }
  cancel(ctx: QuestionContext, input: QuestionMutation): Promise<Question> {
    return this.mutate(ctx, input, q => { check(q, input.version); q.status = "cancelled"; return true; });
  }
  setDelivery(ctx: QuestionContext, input: QuestionMutation & { delivery: "resume-needed" | "queued" | "delivered" }): Promise<Question> {
    if (!["resume-needed", "queued", "delivered"].includes(input.delivery)) throw new Error("Invalid delivery");
    return this.mutate(ctx, input, q => {
      if (q.version !== input.version) throw new Error("Stale question version: current " + q.version);
      if (q.status !== "answered") throw new Error("Question not answered");
      q.delivery = input.delivery; return true;
    });
  }
  handle(method: string, params: unknown, ctx: QuestionContext): Promise<Question | Question[]> {
    const p = params as Record<string, unknown> | undefined;
    switch (method) {
      case "questions.ask": return this.ask(ctx, p as Parameters<QuestionService["ask"]>[1]);
      case "questions.list": return Promise.resolve(this.list(ctx));
      case "questions.get": return Promise.resolve(this.get(ctx, p?.id as string));
      case "questions.block": return this.block(ctx, p as Parameters<QuestionService["block"]>[1]);
      case "questions.resolve": return this.resolve(ctx, p as Parameters<QuestionService["resolve"]>[1]);
      case "questions.cancel": return this.cancel(ctx, p as Parameters<QuestionService["cancel"]>[1]);
      case "questions.answer": throw new Error("UI reply only: call answer from trusted UI/service route");
      default: throw new Error("Unknown questions method");
    }
  }
}
function ids(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20 || !value.length) throw new Error("Invalid task IDs");
  const result = value.map(v => text(v, 200, "task ID"));
  if (new Set(result).size !== result.length) throw new Error("Duplicate task IDs");
  return result;
}
function check(q: Question, version: number): void {
  if (q.version !== version) throw new Error("Stale question version: current " + q.version);
  if (q.status !== "pending") throw new Error("Question already " + q.status);
}
export const questionService = new QuestionService();
