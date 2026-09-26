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
};
export type QuestionContext = {
  sessionManager: {
    getSessionId(): string;
    getSessionFile(): string | undefined;
    getLeafId(): string | null;
    getBranch(): Array<{ id: string }>;
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
  list(ctx: QuestionContext): Question[] {
    const current = activeOwner(ctx);
    const ancestors = new Set(ctx.sessionManager.getBranch().map((e) => e.id));
    ancestors.add(current.branchId);
    return read(path(ctx)).filter((q) => q.owner.sessionId === current.sessionId && ancestors.has(q.owner.branchId));
  }
  get(ctx: QuestionContext, id: string): Question {
    const q = this.list(ctx).find((q) => q.id === id);
    if (!q) throw new Error("Question not found on current branch");
    return q;
  }
  ask(ctx: QuestionContext, input: { text: string; blocked: true; dedupKey?: string }): Promise<Question> {
    if (input?.blocked !== true) throw new Error("questions.ask requires blocked: true");
    const question = text(input.text, 4000, "text");
    const key = input.dedupKey === undefined ? undefined : text(input.dedupKey, 128, "dedupKey");
    const owner = activeOwner(ctx);
    const ancestors = new Set(ctx.sessionManager.getBranch().map((e) => e.id));
    ancestors.add(owner.branchId);
    return this.change(path(ctx), (records) => {
      if (key) {
        const existing = records.find(
          (q) => q.owner.sessionId === owner.sessionId && ancestors.has(q.owner.branchId) && q.dedupKey === key,
        );
        if (existing) {
          if (existing.text !== question) throw new Error("dedupKey already used with different text");
          return { result: existing, changed: false };
        }
      }
      if (records.filter((q) => q.status === "pending").length >= maxPending)
        throw new Error("Too many active questions");
      const now = new Date().toISOString();
      const result: Question = {
        id: "q_" + randomUUID(),
        owner,
        text: question,
        status: "pending",
        version: 1,
        createdAt: now,
        updatedAt: now,
        ...(key ? { dedupKey: key } : {}),
      };
      records.push(result);
      const terminal = records.filter((q) => q.status !== "pending");
      if (terminal.length > maxHistory) {
        const excess = new Set(terminal.slice(0, terminal.length - maxHistory).map((q) => q.id));
        for (let i = records.length - 1; i >= 0; i--) if (excess.has(records[i]!.id)) records.splice(i, 1);
      }
      return { result, changed: true };
    });
  }
  private mutate(
    ctx: QuestionContext,
    input: QuestionMutation,
    status: "answered" | "cancelled",
    answer?: string,
  ): Promise<Question> {
    if (!input || !/^q_[0-9a-f-]{36}$/.test(input.id) || !Number.isSafeInteger(input.version))
      throw new Error("Invalid question ID or version");
    const owner = activeOwner(ctx, input.owner?.branchId);
    if (input.owner?.sessionId !== owner.sessionId) throw new Error("Owner session mismatch");
    return this.change(path(ctx), (records) => {
      const q = records.find(
        (q) => q.id === input.id && q.owner.sessionId === owner.sessionId && q.owner.branchId === owner.branchId,
      );
      if (!q) throw new Error("Question not found for owner");
      if (q.version !== input.version) throw new Error("Stale question version: current " + q.version);
      if (q.status !== "pending") throw new Error("Question already " + q.status);
      q.status = status;
      q.version++;
      q.updatedAt = new Date().toISOString();
      if (answer !== undefined) q.answer = answer;
      return { result: q, changed: true };
    });
  }
  async answer(ctx: QuestionContext, input: QuestionMutation & { text: string }): Promise<Question> {
    const result = await this.mutate(ctx, input, "answered", text(input?.text, 8000, "answer"));
    this.onAnswered?.(result, ctx);
    return result;
  }
  cancel(ctx: QuestionContext, input: QuestionMutation): Promise<Question> {
    return this.mutate(ctx, input, "cancelled");
  }
  handle(method: string, params: unknown, ctx: QuestionContext): Promise<Question | Question[]> {
    const p = params as Record<string, unknown> | undefined;
    switch (method) {
      case "questions.ask":
        return this.ask(ctx, p as Parameters<QuestionService["ask"]>[1]);
      case "questions.list":
        return Promise.resolve(this.list(ctx));
      case "questions.get":
        return Promise.resolve(this.get(ctx, p?.id as string));
      case "questions.answer":
        return this.answer(ctx, p as Parameters<QuestionService["answer"]>[1]);
      case "questions.cancel":
        return this.cancel(ctx, p as Parameters<QuestionService["cancel"]>[1]);
      default:
        throw new Error("Unknown questions method");
    }
  }
}
export const questionService = new QuestionService();
