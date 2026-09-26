import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** The service owns persistence, scope and authorization; UI only presents a view. */
export interface QuestionCommands {
  handle(method: string, params?: Record<string, unknown>): unknown | Promise<unknown>;
  subscribe?(listener: () => void): () => void;
}
type Question = {
  id: string;
  text?: string;
  question?: string;
  status?: string;
  answer?: string;
  readOnly?: boolean;
  owner?: { sessionId: string; branchId: string };
  version?: number;
  requester?: string;
  taskIds?: string[];
  reason?: string;
  choices?: string[];
  allowFreeText?: boolean;
  blocked?: { checkpoint: string; foreground?: boolean; taskIds?: string[] };
  replyId?: string;
  delivery?: string;
  resolutionReason?: string;
};

function records(value: unknown): Question[] {
  if (Array.isArray(value)) return value as Question[];
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["questions", "items", "entries"])
      if (Array.isArray(object[key])) return object[key] as Question[];
  }
  return [];
}

function shortId(question: Question, all: Question[]): string {
  const prefix = question.id.slice(0, 10);
  return all.filter((entry) => entry.id.startsWith(prefix)).length === 1 ? prefix : question.id;
}

function renderQuestion(question: Question, id = question.id): string {
  return [
    id,
    question.status
      ? "[" +
        question.status +
        (question.readOnly
          ? "; history only"
          : question.blocked && question.status === "pending"
            ? "; waiting on you"
            : "") +
        "]"
      : "",
    question.text ?? question.question ?? "",
  ]
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
    // No-history sessions cannot own durable questions. This is not a storage failure.
    if (current.sessionManager?.getSessionFile && !current.sessionManager.getSessionFile()) {
      current.ui.setStatus("die-questions", undefined);
      return;
    }
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
      const open = records(await service.handle("questions.list", {})).filter(
        (question) =>
          !question.readOnly &&
          (!question.status ||
            question.status === "pending" ||
            question.status === "answered" ||
            (question.status === "cancelled" && !!question.blocked)),
      );
      const saved = open.filter((q) => q.status === "answered").length;
      const waiting = open.some((q) => q.status !== "answered" && q.blocked);
      const cancelled = open.some((q) => q.status === "cancelled" && q.blocked);
      if (token === generation && context === current)
        current.ui.setStatus(
          "die-questions",
          open.length
            ? open.length +
                " question" +
                (open.length === 1 ? "" : "s") +
                (saved ? " · " + saved + " saved" : cancelled ? "" : " pending") +
                (waiting ? (cancelled ? " · follow-up blocked" : " · waiting on you") : "")
            : undefined,
        );
    } catch {
      // Commands report errors; background refresh must not create notice spam.
      if (token === generation && context === current) current.ui.setStatus("die-questions", "/questions unavailable");
    }
  };

  const resolveId = async (service: QuestionCommands, id: string): Promise<string> => {
    if (id.length < 8) return id;
    const matches = records(await service.handle("questions.list", {})).filter((q) => q.id.startsWith(id));
    if (matches.some((q) => q.id === id)) return id;
    if (matches.length > 1) throw new Error("Question ID is ambiguous; use more characters from /questions.");
    return matches[0]?.id ?? id;
  };

  pi.registerCommand("questions", {
    description: "List, inspect, answer, cancel or resume questions",
    async handler(args, ctx) {
      context = ctx;
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const [verb = "list", id, ...rest] = parts;
      try {
        const service = getService(ctx);
        if (verb === "list") {
          if (id) throw new Error("Usage: /questions [list|detail <id>|answer <id> <text>|cancel <id>|resume <id>]");
          const questions = records(await service.handle("questions.list", {}));
          ctx.ui.notify(
            questions.length
              ? questions.map((q) => renderQuestion(q, shortId(q, questions))).join("\n")
              : "No questions",
            "info",
          );
        } else if (verb === "detail") {
          if (!id || rest.length) throw new Error("Usage: /questions detail <id>");
          const question = (await service.handle("questions.get", {
            id: await resolveId(service, id),
          })) as Question | null;
          if (!question) throw new Error("Question not found: " + id);
          ctx.ui.notify(
            [
              renderQuestion(question),
              question.requester && "Requester: " + question.requester,
              question.reason && "Why: " + question.reason,
              question.choices?.length &&
                "Choices: " +
                  question.choices.join(" | ") +
                  (question.allowFreeText === false ? " (pick one)" : " (or your own answer)"),
              question.blocked &&
                "Blocked follow-up: " +
                  [question.blocked.foreground ? "parent" : "", ...(question.blocked.taskIds ?? [])]
                    .filter(Boolean)
                    .join(", ") +
                  " — " +
                  question.blocked.checkpoint,
              question.answer && "Answer: " + question.answer,
              question.status === "cancelled" &&
                question.blocked &&
                "Cancelled; follow-up needs a new plan, not a guessed answer.",
              question.status === "answered" &&
                (question.delivery === "dispatching"
                  ? "Answer saved · delivery uncertain; check parent chat"
                  : question.delivery === "delivered"
                    ? "Answer sent to parent"
                    : question.delivery === "queued"
                      ? "Answer saved · waiting for parent"
                      : "Answer saved · /questions resume " + question.id),
              question.resolutionReason && "Closed: " + question.resolutionReason,
              question.taskIds?.length &&
                "Tasks: " + question.taskIds.join(", ") + ". Child in-place replies are not supported.",
            ]
              .filter(Boolean)
              .join("\n"),
            "info",
          );
        } else if (verb === "answer") {
          const answer =
            args
              .trim()
              .match(/^answer\s+\S+\s+([\s\S]+)$/)?.[1]
              .trim() ?? "";
          if (!id || !answer) throw new Error("Usage: /questions answer <id> <text>");
          await service.handle("questions.answer", { id: await resolveId(service, id), answer });
          ctx.ui.notify("Answer saved for " + id, "info");
        } else if (verb === "resume") {
          if (!id || rest.length) throw new Error("Usage: /questions resume <id>");
          await service.handle("questions.resume", { id: await resolveId(service, id) });
          ctx.ui.notify("Saved answer queued for a new parent turn: " + id, "info");
        } else if (verb === "cancel") {
          if (!id || rest.length) throw new Error("Usage: /questions cancel <id>");
          await service.handle("questions.cancel", { id: await resolveId(service, id) });
          ctx.ui.notify("Question " + id + " cancelled", "info");
        } else throw new Error("Usage: /questions [list|detail <id>|answer <id> <text>|cancel <id>|resume <id>]");
        await refresh();
      } catch (error) {
        ctx.ui.notify(
          error instanceof SyntaxError
            ? "Could not read saved questions: invalid data. Repair the questions file before retrying."
            : error instanceof Error
              ? error.message
              : String(error),
          "warning",
        );
      }
    },
  });

  const attach = (ctx: ExtensionContext) => {
    context = ctx;
    generation++;
    void refresh();
  };
  pi.on("session_start", (_event, ctx) => attach(ctx));
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
