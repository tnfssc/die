import type { GoalState } from "./types";

export const MAX_NO_PROGRESS_CONTINUATIONS = 3;

// Only evidence deliberately recorded through goal.update({ progress }) is a
// milestone. Lifecycle churn (including waiting job IDs and revisions) is not.
function milestoneState(goal: GoalState): string {
  return JSON.stringify({ id: goal.id, progress: goal.progress ?? [] });
}

export class GoalContinuationController {
  #automatic = false;
  #startingMilestones?: string;
  #noProgress = 0;

  markAutomaticStart(goal: GoalState): void {
    this.#automatic = true;
    this.#startingMilestones = milestoneState(goal);
  }

  settle(goal: GoalState | undefined): "continue" | "pause" | "none" {
    if (!goal) return "none";
    if (!this.#automatic) return goal.status === "active" ? "continue" : "none";

    const milestones = milestoneState(goal);
    const progressed = milestones !== this.#startingMilestones;
    this.#noProgress = progressed ? 0 : this.#noProgress + 1;
    this.#startingMilestones = milestones;

    if (this.#noProgress >= MAX_NO_PROGRESS_CONTINUATIONS
      && (goal.status === "active" || goal.status === "waiting")) {
      return "pause";
    }
    return goal.status === "active" ? "continue" : "none";
  }

  reset(): void {
    this.#automatic = false;
    this.#startingMilestones = undefined;
    this.#noProgress = 0;
  }
}
