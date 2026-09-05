import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import goalContinuation from "../prompts/goal-continuation.md" with { type: "text" };
import { GoalContinuationController } from "./controller";
import { GoalStore } from "./store";
import type { GoalJobCoordinator, GoalState } from "./types";

export interface GoalRuntime {
  get(): GoalState | undefined;
  handle(method: string, params: unknown): unknown;
  jobsChanged(): void;
}

function formatGoal(goal?: GoalState): string {
  if (!goal) return "No goal is set.";
  return [
    `Goal: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Criteria: ${goal.criteria.join("; ")}`,
    `Constraints: ${goal.constraints.join("; ") || "none"}`,
    goal.evidence && `Evidence: ${goal.evidence}`,
    goal.blocker && `Blocker: ${goal.blocker}`,
    goal.pendingJobIds?.length && `Waiting on: ${goal.pendingJobIds.join(", ")}`,
    goal.pauseReason && `Reason: ${goal.pauseReason}`,
  ].filter(Boolean).join("\n");
}

function continuation(goal: GoalState, generation: number): string {
  return goalContinuation.trimEnd()
    .replace("{{objective}}", goal.objective)
    .replace("{{criteria}}", goal.criteria.map(item => `- ${item}`).join("\n"))
    .replace("{{constraints}}", goal.constraints.length
      ? goal.constraints.map(item => `- ${item}`).join("\n")
      : "- None")
    + `\n\n<!-- die-goal-generation:${generation} -->`;
}

function parseSet(args: string): { objective: string; criteria: string[]; constraints: string[] } {
  const criteriaAt = args.indexOf(" --criteria ");
  const constraintsAt = args.indexOf(" --constraints ");
  if (criteriaAt <= 0 || constraintsAt <= criteriaAt) {
    throw new Error("Usage: /goal set <objective> --criteria <criterion[;...]> --constraints <constraint[;...]>");
  }
  const split = (value: string) => value.split(";").map(item => item.trim()).filter(Boolean);
  return {
    objective: args.slice(0, criteriaAt).trim(),
    criteria: split(args.slice(criteriaAt + 12, constraintsAt)),
    constraints: split(args.slice(constraintsAt + 15)),
  };
}

export function registerGoalMode(pi: ExtensionAPI, jobs: GoalJobCoordinator): GoalRuntime {
  let store: GoalStore | undefined;
  let context: ExtensionContext | undefined;
  let generation = 0;
  let jobsDirty = false;
  let queuedUserInput = false;
  const queuedReminders = new Map<string, number>();
  const controller = new GoalContinuationController();

  const ensureStore = (ctx: ExtensionContext): GoalStore => {
    context = ctx;
    if (!store) {
      const entries = ctx.sessionManager?.getBranch?.()
        ?? ctx.sessionManager?.getEntries()
        ?? [];
      store = new GoalStore((type, data) => pi.appendEntry(type, data), entries);
    }
    return store;
  };
  const requireStore = () => {
    if (!store) throw new Error("Goal state is not initialized");
    return store;
  };
  const notify = (message: string, level: "info" | "warning" = "info") => {
    context?.ui.notify(message, level);
  };
  const bumpGeneration = () => {
    generation++;
  };
  const invalidate = () => {
    bumpGeneration();
    controller.reset();
  };
  const pause = (reason: string) => {
    const current = store?.get();
    if (current?.status === "active" || current?.status === "waiting") {
      store!.update({ status: "paused", reason });
      invalidate();
    }
  };
  const sendContinuation = (goal: GoalState) => {
    const message = continuation(goal, generation);
    queuedReminders.set(message, generation);
    controller.markAutomaticStart(goal);
    pi.sendUserMessage(message, { deliverAs: "followUp" });
  };
  const reconcileWaiting = () => {
    const goal = store?.get();
    if (!goal || goal.status !== "waiting" || !jobsDirty) return;
    jobsDirty = false;
    const statuses = goal.pendingJobIds!.map(id => jobs.status(id));
    if (statuses.some(status => status === "unavailable")) {
      pause("Paused because waiting work is unavailable in this process");
    } else if (statuses.every(status => status === "finished")) {
      store!.update({ status: "active" });
      invalidate();
    }
  };

  pi.registerCommand("goal", {
    description: "Set or inspect persistent goal mode",
    async handler(args, ctx) {
      context = ctx;
      const activeStore = ensureStore(ctx);
      const parts = args.trim() ? args.trim().split(/\s+/) : ["status"];
      const command = parts[0]!;
      const value = parts.slice(1).join(" ");
      try {
        if (command === "set") activeStore.set(parseSet(value));
        else if (command === "status") {
          notify(formatGoal(activeStore.get()));
          return;
        } else if (command === "pause") {
          activeStore.update({ status: "paused", reason: value || "Paused by user" });
        } else if (command === "resume") activeStore.update({ status: "active" });
        else if (command === "clear") activeStore.clear();
        else throw new Error("Usage: /goal set|status|pause|resume|clear");

        invalidate();
        const current = activeStore.get();
        notify(formatGoal(current));
        if (current?.status === "active" && (command === "set" || command === "resume")) {
          sendContinuation(current);
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), "warning");
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    context = ctx;
    store = undefined;
    const loaded = ensureStore(ctx);
    jobsDirty = loaded.get()?.status === "waiting";
    invalidate();
  });

  pi.on("before_agent_start", (event, ctx) => {
    ensureStore(ctx);
    reconcileWaiting();
    const goal = store?.get();
    if (!goal) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\nPersistent goal state (authoritative):\n${formatGoal(goal)}`,
    };
  });

  pi.on("input", (event, ctx) => {
    context = ctx;
    if (event.source === "extension") {
      const reminderGeneration = queuedReminders.get(event.text);
      if (reminderGeneration !== undefined) {
        queuedReminders.delete(event.text);
        if (reminderGeneration !== generation) return { action: "handled" as const };
      }
      return;
    }
    if (event.streamingBehavior !== undefined) {
      queuedUserInput = true;
      pause("Paused by user interruption");
    }
  });

  pi.on("agent_end", event => {
    const last = [...event.messages].reverse().find(message => message.role === "assistant");
    if (last?.stopReason === "aborted" || last?.stopReason === "error") {
      pause("Paused after interrupted agent turn");
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    context = ctx;
    const goal = store?.get();
    if (!goal || goal.status !== "active") {
      queuedUserInput = false;
      controller.settle(goal);
      return;
    }
    if (ctx.signal?.aborted) {
      pause("Paused after interruption");
      queuedUserInput = false;
      return;
    }
    if (queuedUserInput) {
      pause("Paused for queued user input");
      queuedUserInput = false;
      return;
    }

    const action = controller.settle(goal);
    if (action === "pause") {
      store!.update({
        status: "paused",
        reason: "Paused after repeated automatic turns made no meaningful progress",
      });
      invalidate();
      notify("Goal paused: repeated continuations made no meaningful progress", "warning");
    } else if (action === "continue") {
      sendContinuation(store!.get()!);
    }
  });

  return {
    get: () => store?.get(),
    jobsChanged() {
      jobsDirty = true;
    },
    handle(method, params) {
      const input = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
      if (method === "goal.get") return requireStore().get() ?? null;
      if (method === "goal.set") {
        const result = requireStore().set({
          objective: input.objective,
          criteria: input.criteria,
          constraints: input.constraints,
        });
        invalidate();
        return result;
      }
      if (method === "goal.update") {
        const result = requireStore().update(input as never, jobs.runningIds());
        bumpGeneration();
        return result;
      }
      if (method === "goal.clear") {
        requireStore().clear();
        invalidate();
        return { cleared: true };
      }
      throw new Error(`Unknown goal method: ${method}`);
    },
  };
}
