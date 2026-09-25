#!/usr/bin/env bun
/** Put upstream's deterministic subagent_v2_nested replay result in the isolated store.
 * The replay test makes input under .runtime. Touch no production or shared state.
 */
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
const here=import.meta.dir;
const resultPath=process.argv[2] ?? path.join(here,'.runtime/subagent-v2-nested-result.json');
const dbPath=process.argv[3] ?? path.join(here,'.runtime/state/t3-home/userdata/statev2.sqlite');
if(!fs.existsSync(resultPath)) throw new Error(`missing replay result: ${resultPath}`);
if(!fs.existsSync(dbPath)) throw new Error(`missing isolated database: ${dbPath}`);
const result=JSON.parse(fs.readFileSync(resultPath,'utf8'));
const projections=Object.values(result.projections) as any[];
const root=projections.find((p:any)=>p.thread.lineage.parentThreadId===null);
if(!root) throw new Error('replay result has no root thread');
const db=new Database(dbPath);
db.exec('PRAGMA foreign_keys=ON');
const run=db.transaction(()=>{
  db.query(`INSERT INTO projection_projects
    (project_id,title,workspace_root,scripts_json,created_at,updated_at,deleted_at,default_model_selection_json,default_thread_env_mode,favicon_path,auto_pull,project_icon_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at`).run(
      root.thread.projectId,'T3 browser replay fixture',here,'[]',root.thread.createdAt,root.thread.updatedAt,null,
      JSON.stringify(root.thread.modelSelection),'local',null,0,null);
  const versions=new Map<string,number>();
  const insert=db.query(`INSERT OR IGNORE INTO orchestration_events
    (event_id,aggregate_kind,stream_id,stream_version,event_type,occurred_at,command_id,causation_event_id,correlation_id,actor_kind,payload_json,metadata_json,application_event_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,2)`);
  for(const stored of result.storedEvents){
    const e=stored.event; const version=versions.get(e.threadId)??0; versions.set(e.threadId,version+1);
    const metadata:any={}; for(const k of ['runId','nodeId','driver','providerInstanceId','rawEventId']) if(e[k]!==undefined) metadata[k]=e[k];
    insert.run(e.id,'thread',e.threadId,version,e.type,e.occurredAt,stored.commandId??null,null,stored.commandId??null,e.rawEventId===undefined?'server':'provider',JSON.stringify(e.payload),JSON.stringify(metadata));
  }
  const put=(table:string,columns:string[],rows:any[][])=>{ if(!rows.length)return; const q=db.query(`INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`); for(const row of rows)q.run(...row); };
  put('orchestration_v2_projection_threads',['thread_id','project_id','title','default_provider','provider_instance_id','runtime_mode','interaction_mode','active_provider_thread_id','created_at','updated_at','archived_at','deleted_at','payload_json'],projections.map((p:any)=>{const x=p.thread;return[x.id,x.projectId,x.title,x.providerInstanceId,x.providerInstanceId,x.runtimeMode,x.interactionMode,x.activeProviderThreadId,x.createdAt,x.updatedAt,x.archivedAt,x.deletedAt,JSON.stringify(x)]}));
  const flat=(key:string)=>projections.flatMap((p:any)=>p[key]);
  put('orchestration_v2_projection_runs',['run_id','thread_id','ordinal','provider','provider_instance_id','provider_thread_id','status','requested_at','completed_at','payload_json'],flat('runs').map((x:any)=>[x.id,x.threadId,x.ordinal,x.providerInstanceId,x.providerInstanceId,x.providerThreadId,x.status,x.requestedAt,x.completedAt,JSON.stringify(x)]));
  put('orchestration_v2_projection_nodes',['node_id','thread_id','run_id','parent_node_id','root_node_id','kind','status','provider_thread_id','provider_turn_id','runtime_request_id','checkpoint_scope_id','started_at','completed_at','payload_json'],flat('nodes').map((x:any)=>[x.id,x.threadId,x.runId,x.parentNodeId,x.rootNodeId,x.kind,x.status,x.providerThreadId,x.providerTurnId,x.runtimeRequestId,x.checkpointScopeId,x.startedAt,x.completedAt,JSON.stringify(x)]));
  put('orchestration_v2_projection_subagents',['subagent_id','thread_id','run_id','parent_node_id','provider','driver','provider_instance_id','provider_thread_id','child_thread_id','origin','status','started_at','completed_at','updated_at','payload_json'],flat('subagents').map((x:any)=>[x.id,x.threadId,x.runId,x.parentNodeId,x.providerInstanceId,x.driver,x.providerInstanceId,x.providerThreadId,x.childThreadId,x.origin,x.status,x.startedAt,x.completedAt,x.updatedAt,JSON.stringify(x)]));
  put('orchestration_v2_projection_messages',['message_id','thread_id','run_id','node_id','role','streaming','created_at','updated_at','payload_json'],flat('messages').map((x:any)=>[x.id,x.threadId,x.runId,x.nodeId,x.role,x.streaming?1:0,x.createdAt,x.updatedAt,JSON.stringify(x)]));
  put('orchestration_v2_projection_turn_items',['turn_item_id','thread_id','run_id','node_id','provider_thread_id','provider_turn_id','parent_item_id','ordinal','type','status','updated_at','payload_json'],flat('turnItems').map((x:any)=>[x.id,x.threadId,x.runId,x.nodeId,x.providerThreadId,x.providerTurnId,x.parentItemId,x.ordinal,x.type,x.status,x.updatedAt,JSON.stringify(x)]));
  put('orchestration_v2_projection_provider_threads',['provider_thread_id','thread_id','owner_node_id','provider','provider_session_id','status','first_run_ordinal','last_run_ordinal','updated_at','payload_json','driver','provider_instance_id'],flat('providerThreads').map((x:any)=>[x.id,x.appThreadId,x.ownerNodeId,x.providerInstanceId,x.providerSessionId,x.status,x.firstRunOrdinal,x.lastRunOrdinal,x.updatedAt,JSON.stringify(x),x.driver,x.providerInstanceId]));
  db.query(`UPDATE orchestration_v2_projection_metadata SET last_sequence=(SELECT COALESCE(MAX(sequence),0) FROM orchestration_events),updated_at=? WHERE projection_name='thread-projections'`).run(new Date().toISOString());
});
run(); db.close();
console.log(JSON.stringify({label:'deterministic upstream replay fixture (not live provider)',projectId:root.thread.projectId,parentThreadId:root.thread.id,childThreadIds:projections.filter((p:any)=>p.thread.lineage.parentThreadId!==null).map((p:any)=>p.thread.id),eventCount:result.storedEvents.length},null,2));
