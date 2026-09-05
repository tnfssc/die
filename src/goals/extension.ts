import { randomUUID } from "node:crypto";
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
    goal.progress?.length && `Progress:\n${goal.progress.map(item => `- ${item}`).join("\n")}`,
    goal.evidence && `Evidence: ${goal.evidence}`,
    goal.blocker && `Blocker: ${goal.blocker}`,
    goal.pendingJobIds?.length && `Waiting on: ${goal.pendingJobIds.join(", ")}`,
    goal.pauseReason && `Reason: ${goal.pauseReason}`,
  ].filter(Boolean).join("\n");
}

function continuation(goal: GoalState, generation: number): string {
  return goalContinuation.trimEnd()
    .replace("{{objective}}", () => goal.objective)
    .replace("{{criteria}}", () => goal.criteria.map(item => `- ${item}`).join("\n"))
    .replace("{{constraints}}", () => goal.constraints.length
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
  let loadedManager: object | undefined;
  let loadedLeaf: string | undefined;
  let context: ExtensionContext | undefined;
  let generation = 0;
  let jobsDirty = false;
  let queuedUserInput = false;
  let reminderEpoch = randomUUID();
  let reminderSequence = 0;
  const queuedReminderIds = new Set<string>();
  const controller = new GoalContinuationController();

  const leafOf = (ctx: ExtensionContext) => ctx.sessionManager?.getLeafId?.() ?? undefined;
  const ensureStore = (ctx: ExtensionContext): GoalStore => {
    context = ctx;
    const manager = ctx.sessionManager as object | undefined;
    const leaf = leafOf(ctx);
    if (!store || loadedManager !== manager || (leaf !== undefined && leaf !== loadedLeaf)) {
      const entries = ctx.sessionManager?.getBranch?.()
        ?? ctx.sessionManager?.getEntries()
        ?? [];
      const candidate = new GoalStore((type, data) => {
        pi.appendEntry(type, data);
        loadedLeaf = leafOf(ctx);
      }, entries);
      const branchChanged = !store
        || loadedManager !== manager
        || JSON.stringify(candidate.get()) !== JSON.stringify(store.get());
      loadedManager = manager;
      loadedLeaf = leaf;
      // Ordinary messages also advance the leaf. Preserve controller state when
      // branch-derived goal state is unchanged, but refresh after navigation.
      if (branchChanged) {
        store = candidate;
        jobsDirty = store.get()?.status === "waiting";
        queuedReminderIds.clear();
        controller.reset();
      }
    }
    return store!;
  };
  const requireStore = () => {
    if (context) return ensureStore(context);
    if (!store) throw new Error("Goal state is not initialized");
    return store;
  };
  const notify = (message: string, level: "info" | "warning" = "info") => {
    context?.ui.notify(message, level);
  };
  const bumpGeneration = () => {
    generation++;
    queuedReminderIds.clear();
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
    const id = String(++reminderSequence);
    if (queuedReminderIds.size >= 16) queuedReminderIds.delete(queuedReminderIds.values().next().value!);
    queuedReminderIds.add(id);
    const message = continuation(goal, generation)
      + `\n\n<!-- die-goal-reminder:${reminderEpoch}:${generation}:${id} -->`;
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
    } else if (statuses.some(status => status === "finished")) {
      const settled = goal.pendingJobIds!.filter((_, index) => statuses[index] === "finished");
      store!.update({ status: "active", progress: `Owned jobs settled: ${settled.join(", ")}` });
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
    loadedManager = undefined;
    loadedLeaf = undefined;
    reminderEpoch = randomUUID();
    queuedReminderIds.clear();
    ensureStore(ctx);
    invalidate();
  });

  // Runs before every provider request, including tool and custom-message
  // continuations. Mutable goal state stays out of the cache-sensitive system
  // prefix and participates in the ordinary context filtering lifecycle.
  pi.on("context", (event, ctx) => {
    ensureStore(ctx);
    reconcileWaiting();
    const goal = store?.get();
    if (!goal) return;
    return {
      messages: [...event.messages, {
        role: "custom" as const,
        customType: "die-goal-state",
        content: `Persistent goal state (authoritative):\n${formatGoal(goal)}`,
        display: false,
        timestamp: Date.now(),
      }],
    };
  });

  pi.on("input", (event, ctx) => {
    context = ctx;
    ensureStore(ctx);
    if (event.source === "extension") {
      const match = /<!-- die-goal-reminder:([^:>]+):(\d+):(\d+) -->/.exec(event.text);
      if (match) {
        const accepted = match[1] === reminderEpoch
          && Number(match[2]) === generation
          && queuedReminderIds.delete(match[3]!);
        if (!accepted) return { action: "handled" as const };
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
    ensureStore(ctx);
    reconcileWaiting();
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

  pi.on("session_shutdown", () => {
    queuedReminderIds.clear();
    reminderEpoch = randomUUID();
    controller.reset();
    store = undefined;
    context = undefined;
    loadedManager = undefined;
    loadedLeaf = undefined;
    jobsDirty = false;
  });

  return {
    get: () => context ? ensureStore(context).get() : store?.get(),
    jobsChanged() {
      jobsDirty = true;
      reconcileWaiting();
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
