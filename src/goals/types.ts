export const GOAL_STATUSES = ["active", "waiting", "blocked", "completed", "paused"] as const;
export type GoalStatus = typeof GOAL_STATUSES[number];
export interface GoalState { id:string; revision:number; objective:string; criteria:string[]; constraints:string[]; status:GoalStatus; createdAt:string; updatedAt:string; evidence?:string; blocker?:string; pendingJobIds?:string[]; pauseReason?:string }
export interface GoalEntry { version:1; operation:"set"|"update"|"clear"; goal?:GoalState; at:string }
