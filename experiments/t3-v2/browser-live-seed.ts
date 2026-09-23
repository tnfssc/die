#!/usr/bin/env bun
/** Add project-list metadata to a CLOSED real-engine database copy. Never import fake thread events. */
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
const here=import.meta.dir;
const resultPath=process.argv[2] ?? path.join(here,".runtime/integrated-real-result.json");
const dbPath=process.argv[3] ?? path.join(here,".runtime/browser-live-final-state/t3-home/userdata/statev2.sqlite");
if(!fs.existsSync(resultPath) || !fs.existsSync(dbPath)) throw new Error("prepare an actual integrated snapshot first");
const result=JSON.parse(fs.readFileSync(resultPath,"utf8"));
const projections=Object.values(result.projections) as any[];
const root=projections.find(p=>p.thread.lineage.parentThreadId===null);
if(!root) throw new Error("actual result has no parent projection");
const db=new Database(dbPath);
try {
  const event=db.query("SELECT event_id FROM orchestration_events WHERE event_id=?");
  for(const stored of result.storedEvents) if(!event.get(stored.event.id)) throw new Error("snapshot does not contain the exported real event IDs");
  db.query(`INSERT INTO projection_projects
    (project_id,title,workspace_root,scripts_json,created_at,updated_at,deleted_at,default_model_selection_json,default_thread_env_mode,favicon_path,auto_pull,project_icon_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at`).run(
      root.thread.projectId,"T3 integrated real browser proof",here,"[]",root.thread.createdAt,root.thread.updatedAt,null,
      JSON.stringify(root.thread.modelSelection),"local",null,0,null);
  console.log(JSON.stringify({mode:"closed real database; project metadata only",parentThreadId:root.thread.id,childThreadIds:projections.filter(p=>p.thread.lineage.parentThreadId!==null).map(p=>p.thread.id),verifiedStoredEvents:result.storedEvents.length},null,2));
} finally {db.close();}
