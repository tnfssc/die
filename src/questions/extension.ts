import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** The service owns persistence, scope and authorization; UI only presents a view. */
export interface QuestionCommands {
  handle(method: string, params?: Record<string, unknown>): unknown | Promise<unknown>;
  subscribe?(listener: () => void): () => void;
}
type Question = { id: string; text?: string; question?: string; status?: string; answer?: string };

function records(value: unknown): Question[] {
  if (Array.isArray(value)) return value as Question[];
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["questions", "items", "entries"])
      if (Array.isArray(object[key])) return object[key] as Question[];
  }
  return [];
}

function renderQuestion(question: Question): string {
  return [question.id, question.status ? "[" + question.status + "]" : "", question.text ?? question.question ?? ""]
    .filter(Boolean)
    .join(" ");
}

/** No modal, focus transfer or repeated notification on background changes. */
export function registerQuestions(
  pi: ExtensionAPI,
  getService: (ctx: ExtensionContext) => QuestionCommands,
): { refresh: () => Promise<void> } {
  let context: ExtensionContext | undefined;
  let unsubscribe: (() => void) | undefined;
  let subscribed: QuestionCommands | undefined;
  let generation = 0;
  const refresh = async () => {
    const current = context;
    if (!current) return;
    const token = generation;
    try {
      const service = getService(current);
      if (subscribed !== service) {
        unsubscribe?.();
        subscribed = service;
        unsubscribe = service.subscribe?.(() => {
          void refresh();
        });
      }
      const pending = records(await service.handle("questions.list", { status: "pending" })).filter(
        (question) => !question.status || question.status === "pending",
      );
      if (token === generation && context === current)
        current.ui.setStatus(
          "die-questions",
          pending.length ? pending.length + " question" + (pending.length === 1 ? "" : "s") + " pending" : undefined,
        );
    } catch {
      // Commands report errors; background refresh must not create notice spam.
      if (token === generation && context === current) current.ui.setStatus("die-questions", undefined);
    }
  };

  pi.registerCommand("questions", {
    description: "List, inspect, answer or cancel pending questions",
    async handler(args, ctx) {
      context = ctx;
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const [verb = "list", id, ...rest] = parts;
      try {
        const service = getService(ctx);
        if (verb === "list") {
          if (id) throw new Error("Usage: /questions [list|detail <id>|answer <id> <text>|cancel <id>]");
          const questions = records(await service.handle("questions.list", {}));
          ctx.ui.notify(questions.length ? questions.map(renderQuestion).join("\n") : "No questions", "info");
        } else if (verb === "detail") {
          if (!id || rest.length) throw new Error("Usage: /questions detail <id>");
          const question = (await service.handle("questions.get", { id })) as Question | null;
          if (!question) throw new Error("Question not found: " + id);
          ctx.ui.notify(
            [renderQuestion(question), question.answer ? "Answer: " + question.answer : ""].filter(Boolean).join("\n"),
            "info",
          );
        } else if (verb === "answer") {
          const answer = rest.join(" ").trim();
          if (!id || !answer) throw new Error("Usage: /questions answer <id> <text>");
          await service.handle("questions.answer", { id, answer });
          ctx.ui.notify("Answer saved for " + id, "info");
        } else if (verb === "resume") {
          if (!id || rest.length) throw new Error("Usage: /questions resume <id>");
          await service.handle("questions.resume", { id });
          ctx.ui.notify("Saved answer queued for a new parent turn: " + id, "info");
        } else if (verb === "cancel") {
          if (!id || rest.length) throw new Error("Usage: /questions cancel <id>");
          await service.handle("questions.cancel", { id });
          ctx.ui.notify("Question " + id + " cancelled", "info");
        } else throw new Error("Usage: /questions [list|detail <id>|answer <id> <text>|cancel <id>]");
        await refresh();
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
      }
    },
  });

  const attach = (ctx: ExtensionContext) => {
    context = ctx;
    generation++;
    void refresh();
  };
  pi.on("session_start", (_event, ctx) => attach(ctx));
  pi.on("session_switch", (_event, ctx) => attach(ctx));
  pi.on("session_tree", (_event, ctx) => attach(ctx));
  pi.on("tool_execution_end", (_event, ctx) => attach(ctx));
  pi.on("before_agent_start", (_event, ctx) => {
    if (context !== ctx) attach(ctx);
    else void refresh();
  });
  pi.on("agent_end", (_event, ctx) => {
    context = ctx;
    void refresh();
  });
  pi.on("session_shutdown", () => {
    generation++;
    context?.ui.setStatus("die-questions", undefined);
    context = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    subscribed = undefined;
  });
  return { refresh };
}
