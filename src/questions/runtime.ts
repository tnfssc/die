import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { currentMainToolOwner } from "../live/main-owner";
import { QuestionService, type Question } from "./service";

/** A reply starts a new parent turn. It never holds or revives an execute stack. */
export function registerQuestionRuntime(pi: ExtensionAPI, options: { supported: () => boolean; hasMainToolOwner?: (manager: object) => boolean }) {
  const service = new QuestionService();
  let context: ExtensionContext | undefined;
  let epoch = 0;
  let stopped = false;
  let closed = false;
  const hasMainToolOwner = options.hasMainToolOwner ?? ((manager: object) => !!currentMainToolOwner(manager));
  const maxQueued = 20; // The ledger admits at most twenty pending questions.
  const queued = new Map<string, { question: Question; manager: object; leaf: string | null; epoch: number }>();
  const delivered = new Set<string>();
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of [...listeners]) listener(); };
  const replyKey = (q: Question) => q.id + ":" + q.version;
  const pause = () => { stopped = true; epoch++; queued.clear(); changed(); };
  const flush = () => {
    const ctx = context;
    if (!ctx || stopped || !options.supported() || !ctx.isIdle() || hasMainToolOwner(ctx.sessionManager)) return;
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
      if (delivered.size > 200) delivered.delete(delivered.values().next().value!);
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
    if (!stopped && options.supported() && context?.sessionManager === ctx.sessionManager && !delivered.has(key)) {
      if (!queued.has(key) && queued.size >= maxQueued) queued.delete(queued.keys().next().value!);
      queued.set(key, { question, manager: ctx.sessionManager, leaf: ctx.sessionManager.getLeafId(), epoch });
      if (context?.sessionManager === ctx.sessionManager) queueMicrotask(flush);
    }
    changed();
  };
  const attach = (ctx: ExtensionContext, navigation = false): boolean => {
    // Only navigation events can replace the active manager. A late callback from
    // an old session must never re-attach it and dispatch into the new session.
    if (closed && !navigation) return false;
    if (navigation) closed = false;
    if (context && context.sessionManager !== ctx.sessionManager) {
      if (!navigation) return false;
      epoch++; queued.clear(); delivered.clear(); stopped = false;
    }
    context = ctx;
    return true;
  };
  pi.on("session_start", (_event, ctx) => { attach(ctx, true); changed(); });
  // Some Pi SDK versions omit this lifecycle event from their type union.
  (pi.on as (event: string, handler: (_event: unknown, ctx: ExtensionContext) => void) => void)("session_switch", (_event, ctx) => { pause(); attach(ctx, true); stopped = false; changed(); });
  pi.on("session_tree", (_event, ctx) => { pause(); attach(ctx, true); stopped = false; changed(); });
  pi.on("before_agent_start", (_event, ctx) => { attach(ctx); });
  pi.on("agent_end", (event, ctx) => {
    if (!attach(ctx)) return;
    const last = [...event.messages].reverse().find(message => message.role === "assistant");
    if (ctx.signal?.aborted || last?.stopReason === "aborted" || last?.stopReason === "error") pause();
  });
  pi.on("agent_settled", (_event, ctx) => { if (attach(ctx)) flush(); });
  pi.on("session_shutdown", () => { pause(); closed = true; context = undefined; delivered.clear(); listeners.clear(); });
  return {
    service, pause,
    hasBlockingQuestions() {
      if (!context || !options.supported()) return false;
      try { return service.list(context).some(q => q.status === "pending" && (q as any).blocking?.foreground === true); }
      catch { return false; }
    },
    async handle(ctx: ExtensionContext, method: string, params: unknown) {
      if (!attach(ctx)) throw new Error("Question session is no longer active.");
      if (!options.supported()) throw new Error("Persistent questions need the parent CLI session. Web projection and child in-place replies are not supported; ask the parent to record the question.");
      if (method === "questions.answer") throw new Error("Answer in /questions answer <id> <text>. Tool or voice transcript text is not a targeted user reply.");
      const result = await service.handle(method, params, ctx);
      changed();
      return result;
    },
    commands(ctx: ExtensionContext) {
      if (!attach(ctx)) throw new Error("Question session is no longer active.");
      return {
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        async handle(method: string, params: Record<string, unknown> = {}) {
          if (context?.sessionManager !== ctx.sessionManager) throw new Error("Question session is no longer active.");
          if (!options.supported()) throw new Error("Questions are supported in the parent CLI session only.");
          if (method === "questions.answer" || method === "questions.cancel" || method === "questions.resume") {
            const q = service.get(ctx, String(params.id));
            if (method === "questions.resume") {
              if (q.status !== "answered") throw new Error("Only a saved answer can be resumed.");
              const key = replyKey(q);
              delivered.delete(key);
              if (!queued.has(key) && queued.size >= maxQueued) throw new Error("Too many queued answers; let the agent settle first.");
              stopped = false;
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
