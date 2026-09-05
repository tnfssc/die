import { randomUUID } from "node:crypto";
import { GOAL_STATUSES, type GoalEntry, type GoalState, type GoalStatus } from "./types";
export const GOAL_ENTRY_TYPE = "die-goal";
const MAX_FIELD=8000;
const text=(v:unknown,n:string)=>{if(typeof v!=="string"||!v.trim())throw new Error(n+" is required");if(v.length>MAX_FIELD)throw new Error(n+" is too long");return v.trim()};
const strings=(v:unknown,n:string,required=false):string[]=>{if(!Array.isArray(v)||v.some(x=>typeof x!=="string"||!x.trim()))throw new Error(n+" must be an array of nonempty strings");if(required&&!v.length)throw new Error(n+" is required");if(v.length>50)throw new Error(n+" has too many items");return v.map(x=>text(x,n))};
export function latestGoal(entries:readonly unknown[]):GoalState|undefined {let goal:GoalState|undefined;for(const raw of entries){const e=raw as {type?:string;customType?:string;data?:GoalEntry};if(e?.type!=="custom"||e.customType!==GOAL_ENTRY_TYPE||e.data?.version!==1)continue;if(e.data.operation==="clear")goal=undefined;else if(e.data.goal)goal=e.data.goal}return goal}
export class GoalStore {
 #goal?:GoalState;
 constructor(private append:(type:string,data:GoalEntry)=>void,entries:readonly unknown[]=[],private now=()=>new Date().toISOString()){this.#goal=latestGoal(entries)}
 get(){return this.#goal?structuredClone(this.#goal):undefined}
 set(input:{objective:unknown;criteria:unknown;constraints:unknown}){const at=this.now();const goal:GoalState={id:randomUUID(),revision:(this.#goal?.revision??0)+1,objective:text(input.objective,"objective"),criteria:strings(input.criteria,"criteria",true),constraints:strings(input.constraints,"constraints"),status:"active",createdAt:at,updatedAt:at};return this.#save("set",goal)}
 update(input:{status:unknown;evidence?:unknown;blocker?:unknown;pendingJobIds?:unknown;reason?:unknown},runningJobs:ReadonlySet<string>=new Set()){if(!this.#goal)throw new Error("No goal is set");if(typeof input.status!=="string"||!GOAL_STATUSES.includes(input.status as GoalStatus))throw new Error("Invalid goal status");const status=input.status as GoalStatus;const goal:GoalState={...this.#goal,status,revision:this.#goal.revision+1,updatedAt:this.now()};delete goal.evidence;delete goal.blocker;delete goal.pendingJobIds;delete goal.pauseReason;if(status==="completed")goal.evidence=text(input.evidence,"completion evidence");if(status==="blocked")goal.blocker=text(input.blocker,"blocker explanation");if(status==="waiting"){goal.pendingJobIds=strings(input.pendingJobIds,"pendingJobIds",true);const unknown=goal.pendingJobIds.filter(id=>!runningJobs.has(id));if(unknown.length)throw new Error("Waiting requires running jobs owned by this agent: "+unknown.join(", "))}if(status==="paused")goal.pauseReason=typeof input.reason==="string"&&input.reason.trim()?text(input.reason,"pause reason"):"Paused";return this.#save("update",goal)}
 clear(){this.#goal=undefined;this.append(GOAL_ENTRY_TYPE,{version:1,operation:"clear",at:this.now()})}
 #save(operation:"set"|"update",goal:GoalState){this.#goal=goal;this.append(GOAL_ENTRY_TYPE,{version:1,operation,goal,at:goal.updatedAt});return this.get()!}
}
