import type { GoalState } from "./types";

export const MAX_NO_PROGRESS_CONTINUATIONS = 3;

function meaningfulState(goal: GoalState): string {
  return JSON.stringify({
    id: goal.id,
    objective: goal.objective,
    criteria: goal.criteria,
    constraints: goal.constraints,
    status: goal.status,
    progress: goal.progress,
    evidence: goal.evidence,
    blocker: goal.blocker,
    pendingJobIds: goal.pendingJobIds,
    pauseReason: goal.pauseReason,
  });
}

export class GoalContinuationController {
  #automatic = false;
  #startingState?: string;
  #noProgress = 0;

  markAutomaticStart(goal: GoalState): void {
    this.#automatic = true;
    this.#startingState = meaningfulState(goal);
  }

  settle(goal: GoalState | undefined): "continue" | "pause" | "none" {
    if (!goal || goal.status !== "active") {
      this.reset();
      return "none";
    }

    if (!this.#automatic) {
      this.#noProgress = 0;
      return "continue";
    }

    const progressed = meaningfulState(goal) !== this.#startingState;
    this.#noProgress = progressed ? 0 : this.#noProgress + 1;
    this.#startingState = meaningfulState(goal);
    if (this.#noProgress >= MAX_NO_PROGRESS_CONTINUATIONS) {
      this.reset();
      return "pause";
    }
    return "continue";
  }

  reset(): void {
    this.#automatic = false;
    this.#startingState = undefined;
    this.#noProgress = 0;
  }
}
