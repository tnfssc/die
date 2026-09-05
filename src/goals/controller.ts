import type { GoalState } from "./types";

export const MAX_NO_PROGRESS_CONTINUATIONS = 3;

// Only evidence deliberately recorded through goal.update({ progress }) is a
// milestone. Lifecycle churn (including waiting job IDs and revisions) is not.
function milestoneState(goal: GoalState): string {
  return JSON.stringify({ id: goal.id, progress: goal.progress ?? [] });
}

export class GoalContinuationController {
  #automatic = false;
  #helperActivated = false;
  #startingMilestones?: string;
  #noProgress = 0;

  markAutomaticStart(goal: GoalState): void {
    this.#automatic = true;
    this.#helperActivated = false;
    this.#startingMilestones = milestoneState(goal);
  }

  markHelperStart(goal: GoalState): void {
    this.#automatic = true;
    this.#helperActivated = true;
    this.#startingMilestones = milestoneState(goal);
  }

  // AgentSession can run several automatic completion turns before it emits
  // agent_settled. Account at the boundary that occurs exactly once per model
  // run so those turns cannot evade the no-progress guard.
  endRun(goal: GoalState | undefined): "pause" | "none" {
    if (!goal || !this.#automatic) return "none";

    // A helper can create a goal during a turn that would have run anyway. Do
    // not charge that turn when it ends normally, but retain automatic
    // tracking when its first turn hands off into waiting work.
    if (this.#helperActivated) {
      this.#helperActivated = false;
      if (goal.status !== "waiting") return "none";
    }

    if (goal.status !== "active" && goal.status !== "waiting") return "none";
    const milestones = milestoneState(goal);
    const progressed = milestones !== this.#startingMilestones;
    this.#noProgress = progressed ? 0 : this.#noProgress + 1;
    this.#startingMilestones = milestones;
    return this.#noProgress >= MAX_NO_PROGRESS_CONTINUATIONS ? "pause" : "none";
  }

  // Reminder scheduling remains at the fully-settled boundary. No accounting
  // happens here: every completed run was already observed by endRun().
  settle(goal: GoalState | undefined): "continue" | "none" {
    return goal?.status === "active" ? "continue" : "none";
  }

  reset(): void {
    this.#automatic = false;
    this.#helperActivated = false;
    this.#startingMilestones = undefined;
    this.#noProgress = 0;
  }
}
