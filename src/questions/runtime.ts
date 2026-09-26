import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { currentMainToolOwner } from "../live/main-owner";
import { QuestionService, type Question } from "./service";

/** A reply starts a new parent turn. It never holds or revives an execute stack. */
export function registerQuestionRuntime(pi: ExtensionAPI, options: { supported: () => boolean }) {
  const service = new QuestionService();
  let context: ExtensionContext | undefined;
  let epoch = 0;
  let stopped = false;
  const queued = new Map<string, { question: Question; manager: object; leaf: string | null; epoch: number }>();
  const delivered = new Set<string>();
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of [...listeners]) listener(); };
  const replyKey = (q: Question) => q.id + ":" + q.version;
  const pause = () => { stopped = true; epoch++; queued.clear(); changed(); };
  const flush = () => {
    const ctx = context;
    if (!ctx || stopped || !options.supported() || !ctx.isIdle() || currentMainToolOwner(ctx.sessionManager)) return;
    for (const [key, item] of queued) {
      const branch = ctx.sessionManager.getBranch();
      if (item.epoch !== epoch || item.manager !== ctx.sessionManager ||
          item.question.owner.sessionId !== ctx.sessionManager.getSessionId() ||
          (item.leaf && !branch.some(entry => entry.id === item.leaf))) {
        queued.delete(key);
        continue;
      }
      queued.delete(key);
      // Claim before dispatch. A failed/uncertain dispatch needs explicit user resume,
      // not an automatic replay of possibly accepted work.
      delivered.add(key);
      try {
        pi.sendMessage({ customType: "question-answer", display: true,
          content: "Saved answer for " + item.question.id + ":\n" + JSON.stringify(item.question) +
            "\nUse this saved reply in a new parent turn. Do not replay prior tool calls or resume a native child in place.",
          details: { questionId: item.question.id, replyKey: key, owner: item.question.owner } },
          { triggerTurn: true, deliverAs: "followUp" });
      } catch {
        // The answer remains durable and can be read with /questions detail.
      }
      changed();
      return;
    }
  };
  service.onAnswered = (question, raw) => {
    const ctx = raw as ExtensionContext;
    const key = replyKey(question);
    if (!stopped && options.supported() && !delivered.has(key)) {
      queued.set(key, { question, manager: ctx.sessionManager, leaf: ctx.sessionManager.getLeafId(), epoch });
      if (context?.sessionManager === ctx.sessionManager) queueMicrotask(flush);
    }
    changed();
  };
  const attach = (ctx: ExtensionContext) => {
    if (context && context.sessionManager !== ctx.sessionManager) { epoch++; queued.clear(); delivered.clear(); stopped = false; }
    context = ctx;
  };
  pi.on("session_start", (_event, ctx) => { attach(ctx); changed(); });
  pi.on("session_switch", (_event, ctx) => { pause(); attach(ctx); stopped = false; changed(); });
  pi.on("session_tree", (_event, ctx) => { pause(); attach(ctx); stopped = false; changed(); });
  pi.on("before_agent_start", (_event, ctx) => { attach(ctx); });
  pi.on("agent_end", (event, ctx) => {
    attach(ctx);
    const last = [...event.messages].reverse().find(message => message.role === "assistant");
    if (ctx.signal?.aborted || last?.stopReason === "aborted" || last?.stopReason === "error") pause();
  });
  pi.on("agent_settled", (_event, ctx) => { attach(ctx); flush(); });
  pi.on("session_shutdown", () => { pause(); context = undefined; delivered.clear(); listeners.clear(); });
  return {
    service, pause,
    hasBlockingQuestions() {
      if (!context || !options.supported()) return false;
      try { return service.list(context).some(q => q.status === "pending" && (q as any).blocking?.foreground === true); }
      catch { return false; }
    },
    async handle(ctx: ExtensionContext, method: string, params: unknown) {
      attach(ctx);
      if (!options.supported()) throw new Error("Persistent questions need the parent CLI session. Web projection and child in-place replies are not supported; ask the parent to record the question.");
      if (method === "questions.answer") throw new Error("Answer in /questions answer <id> <text>. Tool or voice transcript text is not a targeted user reply.");
      const result = await service.handle(method, params, ctx);
      changed();
      return result;
    },
    commands(ctx: ExtensionContext) {
      attach(ctx);
      return {
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        async handle(method: string, params: Record<string, unknown> = {}) {
          if (!options.supported()) throw new Error("Questions are supported in the parent CLI session only.");
          if (method === "questions.answer" || method === "questions.cancel" || method === "questions.resume") {
            const q = service.get(ctx, String(params.id));
            if (method === "questions.resume") {
              if (q.status !== "answered") throw new Error("Only a saved answer can be resumed.");
              stopped = false;
              const key = replyKey(q);
              delivered.delete(key);
              queued.set(key, { question: q, manager: ctx.sessionManager, leaf: ctx.sessionManager.getLeafId(), epoch });
              queueMicrotask(flush);
              return q;
            }
            const input = { id: q.id, owner: q.owner, version: q.version };
            const result = method === "questions.answer"
              ? await service.answer(ctx, { ...input, text: String(params.answer ?? "") })
              : await service.cancel(ctx, input);
            changed();
            return result;
          }
          return service.handle(method, params, ctx);
        },
      };
    },
  };
}
