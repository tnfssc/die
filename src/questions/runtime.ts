import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { currentMainToolOwner } from "../live/main-owner";
import { QuestionService, type Question } from "./service";

/** A reply starts a new parent turn. It never holds or revives an execute stack. */
export function registerQuestionRuntime(
  pi: ExtensionAPI,
  options: { supported: () => boolean; hasMainToolOwner?: (manager: object) => boolean },
) {
  const service = new QuestionService();
  let context: ExtensionContext | undefined;
  let epoch = 0;
  let stopped = false;
  let closed = false;
  let continuationPending = false;
  const hasMainToolOwner = options.hasMainToolOwner ?? ((manager: object) => !!currentMainToolOwner(manager));
  const maxQueued = 20; // The ledger admits at most twenty pending questions.
  const queued = new Map<string, { question: Question; manager: object; leaf: string | null; epoch: number }>();
  const delivered = new Set<string>();
  const createdHere = new Set<string>();
  service.onAsked = (q) => {
    createdHere.add(q.id);
  };
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  const replyKey = (q: Question) => q.replyId ?? q.id + ":" + q.version;
  const project = (q: Question): Question =>
    q.status === "answered" && q.delivery === "queued" && !queued.has(replyKey(q))
      ? { ...q, delivery: "resume-needed" }
      : q;
  const projectResult = (value: Question | Question[]) => (Array.isArray(value) ? value.map(project) : project(value));
  const pause = () => {
    stopped = true;
    continuationPending = false;
    epoch++;
    queued.clear();
    changed();
  };
  const recordDelivery = async (
    ctx: ExtensionContext,
    q: Question,
    delivery: "resume-needed" | "queued" | "dispatching" | "delivered",
  ) => {
    const latest = service.get(ctx, q.id);
    if (latest.status !== "answered" || latest.readOnly) throw new Error("Answer no longer active");
    return service.setDelivery(ctx, { id: latest.id, owner: latest.owner, version: latest.version, delivery });
  };
  let flushing = false;
  const flush = async () => {
    const ctx = context;
    if (flushing || !ctx || stopped || !options.supported() || !ctx.isIdle() || hasMainToolOwner(ctx.sessionManager))
      return;
    flushing = true;
    try {
      for (const [key, item] of queued) {
        const eligible = () =>
          context?.sessionManager === ctx.sessionManager &&
          item.epoch === epoch &&
          item.manager === ctx.sessionManager &&
          item.question.owner.sessionId === ctx.sessionManager.getSessionId() &&
          (!item.leaf || ctx.sessionManager.getBranch().some((entry) => entry.id === item.leaf));
        if (!eligible()) {
          queued.delete(key);
          continue;
        }
        queued.delete(key);
        continuationPending = true;
        try {
          // Durable claim before the host side effect. A crash between claim and
          // acknowledgement is uncertain, never permission to replay the reply.
          await recordDelivery(ctx, item.question, "dispatching");
          if (!eligible() || stopped || !ctx.isIdle() || hasMainToolOwner(ctx.sessionManager)) {
            await recordDelivery(ctx, item.question, "resume-needed");
            continuationPending = false;
            changed();
            return;
          }
          delivered.add(key);
          if (delivered.size > 220) delivered.delete(delivered.values().next().value!);
          continuationPending = true;
          pi.sendMessage(
            {
              customType: "question-answer",
              display: false,
              content:
                "Saved answer for " +
                item.question.id +
                ":\n" +
                JSON.stringify(item.question) +
                "\nUse this saved reply in a new parent turn. Do not replay prior tool calls or resume a native child in place.",
              details: { questionId: item.question.id, replyKey: key, owner: item.question.owner },
            },
            { triggerTurn: true, deliverAs: "followUp" },
          );
          await recordDelivery(ctx, item.question, "delivered");
        } catch {
          // dispatching stays visible as uncertain. No automatic or blind manual
          // retry can duplicate a host turn that may already have been accepted.
        }
        changed();
        return;
      }
    } finally {
      flushing = false;
    }
  };
  service.onAnswered = async (question, raw) => {
    const ctx = raw as ExtensionContext;
    const key = replyKey(question);
    if (
      !stopped &&
      createdHere.has(question.id) &&
      options.supported() &&
      context?.sessionManager === ctx.sessionManager &&
      !delivered.has(key)
    ) {
      if (!queued.has(key) && queued.size >= maxQueued) {
        changed();
        return;
      }
      const answerEpoch = epoch;
      try {
        question = await recordDelivery(ctx, question, "queued");
      } catch {
        changed();
        return;
      }
      if (answerEpoch !== epoch || stopped || context?.sessionManager !== ctx.sessionManager) {
        changed();
        return;
      }
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
      epoch++;
      queued.clear();
      delivered.clear();
      createdHere.clear();
      stopped = false;
    }
    context = ctx;
    return true;
  };
  pi.on("session_start", (_event, ctx) => {
    attach(ctx, true);
    changed();
  });
  pi.on("session_tree", (_event, ctx) => {
    pause();
    attach(ctx, true);
    stopped = false;
    changed();
  });
  pi.on("before_agent_start", (_event, ctx) => {
    if (attach(ctx)) continuationPending = false;
  });
  pi.on("agent_end", (event, ctx) => {
    if (!attach(ctx)) return;
    const last = [...event.messages].reverse().find((message) => message.role === "assistant");
    if (ctx.signal?.aborted || last?.stopReason === "aborted" || last?.stopReason === "error") pause();
  });
  pi.on("agent_settled", (_event, ctx) => {
    if (attach(ctx)) flush();
  });
  pi.on("session_shutdown", () => {
    pause();
    closed = true;
    context = undefined;
    delivered.clear();
    createdHere.clear();
    listeners.clear();
  });
  return {
    service,
    pause,
    hasBlockingQuestions() {
      if (!context || !options.supported()) return false;
      if (continuationPending || queued.size) return true;
      try {
        return service
          .list(context)
          .some(
            (q) =>
              !q.readOnly && (q.status === "pending" || q.status === "cancelled") && q.blocked?.foreground === true,
          );
      } catch {
        return true;
      }
    },
    async handle(ctx: ExtensionContext, method: string, params: unknown) {
      if (!attach(ctx)) throw new Error("Question session is no longer active.");
      if (!options.supported())
        throw new Error(
          "Persistent questions need the parent CLI session. Web projection and child in-place replies are not supported; ask the parent to record the question.",
        );
      if (method === "questions.answer")
        throw new Error(
          "Answer in /questions answer <id> <text>. Tool or voice transcript text is not a targeted user reply.",
        );
      const result = await service.handle(method, params, ctx);
      changed();
      return projectResult(result);
    },
    commands(ctx: ExtensionContext) {
      if (!attach(ctx)) throw new Error("Question session is no longer active.");
      return {
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        async handle(method: string, params: Record<string, unknown> = {}) {
          if (context?.sessionManager !== ctx.sessionManager) throw new Error("Question session is no longer active.");
          if (!options.supported()) throw new Error("Questions are supported in the parent CLI session only.");
          if (method === "questions.answer" || method === "questions.cancel" || method === "questions.resume") {
            const q = service.get(ctx, String(params.id));
            if (method === "questions.resume") {
              if (q.readOnly) throw new Error("Question belongs to the original branch; this is history only.");
              if (q.status !== "answered") throw new Error("Only a saved answer can be resumed.");
              const key = replyKey(q);
              if (q.delivery === "dispatching")
                throw new Error(
                  "Answer delivery is uncertain. Check the parent chat before continuing; this reply will not be sent twice.",
                );
              if (delivered.has(key) || q.delivery === "delivered")
                throw new Error(
                  "This reply was already sent to a parent turn. Read its result or continue in chat; do not replay it.",
                );
              if (!queued.has(key) && queued.size >= maxQueued)
                throw new Error("Too many queued answers; let the agent settle first.");
              await recordDelivery(ctx, q, "queued");
              stopped = false;
              queued.set(key, {
                question: q,
                manager: ctx.sessionManager,
                leaf: ctx.sessionManager.getLeafId(),
                epoch,
              });
              queueMicrotask(flush);
              return q;
            }
            const input = {
              id: q.id,
              owner: q.owner,
              version: method === "questions.answer" && q.status === "answered" ? q.replyVersion! : q.version,
            };
            const result =
              method === "questions.answer"
                ? await service.answer(ctx, {
                    ...input,
                    text: String(params.answer ?? ""),
                    ...(q.replyId ? { replyId: q.replyId } : {}),
                  })
                : await service.cancel(ctx, input);
            changed();
            return result;
          }
          return projectResult(await service.handle(method, params, ctx));
        },
      };
    },
  };
}
