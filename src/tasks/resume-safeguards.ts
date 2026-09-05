import { open } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { type ExtensionAPI, type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

const METADATA_LIMIT=128*1024;
const METADATA_CONCURRENCY=8;
const METADATA_CACHE_LIMIT=256;
const TASK_ID_LIMIT=80;
type AgentRoleType="fast"|"normal"|"orchestrator";
export type SessionRole=
  | {kind:"root"|"unknown";type?:never;taskId?:never}
  | {kind:"orchestrator";type:"orchestrator";taskId?:string}
  | {kind:"worker";type:"fast"|"normal";taskId?:string};

function parseRoleType(value:unknown):AgentRoleType|undefined{
  return value==="fast" || value==="normal" || value==="orchestrator"?value:undefined;
}
function sanitizeTaskId(value:unknown):string|undefined{
  if(typeof value!=="string")return;
  const sanitized=stripTerminalSequences(value).replace(/[^A-Za-z0-9_.:-]/g,"").slice(0,TASK_ID_LIMIT);
  return sanitized || undefined;
}

export async function readSessionRole(path:string):Promise<SessionRole>{
  let handle;
  try{
    handle=await open(path,"r");
    const buffer=Buffer.allocUnsafe(METADATA_LIMIT);
    const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    let malformedAgentMetadata=false;
    for(const line of buffer.subarray(0,bytesRead).toString("utf8").split("\n")){
      if(!line.includes('"die-agent"'))continue;
      try{
        const entry=JSON.parse(line);
        if(entry?.type==="custom" && entry.customType==="die-agent"){
          const type=parseRoleType(entry.data?.type);
          if(!type)return {kind:"unknown"};
          const taskId=sanitizeTaskId(entry.data?.taskId);
          return type==="orchestrator"?{kind:"orchestrator",type,taskId}:{kind:"worker",type,taskId};
        }
      }catch{malformedAgentMetadata=true;/* A partial final line is expected at the diagnostic bound. */}
    }
    return malformedAgentMetadata?{kind:"unknown"}:{kind:"root"};
  }catch{return {kind:"unknown"};}
  finally{await handle?.close().catch(()=>{});}
}

function roleLabel(role:SessionRole):string|undefined{
  if(role.kind==="root")return "● root";
  if(role.kind==="orchestrator")return "◆ orchestrator";
  if(role.kind==="worker")return "◇ worker · "+role.type;
}
const metadataCache=new Map<string,SessionRole>();
async function cachedRole(path:string):Promise<SessionRole>{
  const cached=metadataCache.get(path);
  if(cached){metadataCache.delete(path);metadataCache.set(path,cached);return cached;}
  const role=await readSessionRole(path);
  if(role.kind!=="unknown"){
    metadataCache.set(path,role);
    while(metadataCache.size>METADATA_CACHE_LIMIT)metadataCache.delete(metadataCache.keys().next().value!);
  }
  return role;
}
async function mapBounded<T,R>(values:T[],limit:number,fn:(value:T)=>Promise<R>):Promise<R[]>{
  const result=new Array<R>(values.length);let next=0;
  await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{
    while(true){const index=next++;if(index>=values.length)return;result[index]=await fn(values[index]!);}
  }));
  return result;
}
function isWithin(path:string,root:string):boolean{
  const rel=relative(root,resolve(path));return rel==="" || (!rel.startsWith("..") && !rel.startsWith("/"));
}
const roots=new Map<string,number>();
async function decorate(sessions:SessionInfo[]):Promise<SessionInfo[]>{
  const active=[...roots.keys()];
  return mapBounded(sessions,METADATA_CONCURRENCY,async session=>{
    if(!active.some(root=>isWithin(session.path,root)))return session;
    const label=roleLabel(await cachedRole(session.path));
    if(!label)return session; // unreadable is unknown, never falsely called root
    if(session.name?.startsWith(label+" · ") || (!session.name && session.firstMessage?.startsWith(label+" · ")))return session;
    return session.name ? {...session,name:label+" · "+session.name} : {...session,firstMessage:label+" · "+session.firstMessage};
  });
}

let installs=0;
let originalList:typeof SessionManager.list|undefined;
let originalListAll:typeof SessionManager.listAll|undefined;
let listAdapter:typeof SessionManager.list|undefined;
let listAllAdapter:typeof SessionManager.listAll|undefined;
function installPickerAdapter(root:string):()=>void{
  const key=resolve(root);roots.set(key,(roots.get(key)??0)+1);installs++;
  if(installs===1){
    const capturedList=SessionManager.list;
    const capturedListAll=SessionManager.listAll;
    originalList=capturedList;
    originalListAll=capturedListAll;
    listAdapter=(async(...args:any[])=>decorate(await (capturedList as any).apply(SessionManager,args))) as typeof SessionManager.list;
    listAllAdapter=(async(...args:any[])=>decorate(await (capturedListAll as any).apply(SessionManager,args))) as typeof SessionManager.listAll;
    (SessionManager as any).list=listAdapter;(SessionManager as any).listAll=listAllAdapter;
  }
  let active=true;
  return()=>{
    if(!active)return;active=false;installs--;
    const count=(roots.get(key)??1)-1;if(count)roots.set(key,count);else roots.delete(key);
    if(installs===0 && originalList && originalListAll){
      if(SessionManager.list===listAdapter)(SessionManager as any).list=originalList;
      if(SessionManager.listAll===listAllAdapter)(SessionManager as any).listAll=originalListAll;
      originalList=originalListAll=listAdapter=listAllAdapter=undefined;
    }
  };
}

/** Adds role labels to Pi's TUI picker projection and guards interactive child entry. */
export function registerResumeSafeguards(pi:ExtensionAPI):void{
  let uninstall:(()=>void)|undefined;
  pi.on("session_start",(_event,ctx)=>{
    uninstall?.();
    if(ctx?.mode!=="tui")return;
    const file=ctx.sessionManager?.getSessionFile?.();
    const sessionDir=ctx.sessionManager?.getSessionDir?.() ?? (file?dirname(file):undefined);
    if(sessionDir)uninstall=installPickerAdapter(sessionDir);
  });
  pi.on("session_before_switch",async(event,ctx)=>{
    if(event.reason!=="resume" || !event.targetSessionFile || ctx.mode!=="tui")return;
    const role=await readSessionRole(event.targetSessionFile);
    if(role.kind==="root" || role.kind==="unknown")return;
    const identity=role.kind==="orchestrator"?"orchestrator child":"worker child ("+role.type+")";
    const detail=["This session has delegated-agent restrictions.",role.taskId?"Task: "+role.taskId:undefined,"Resume it deliberately rather than its root session."].filter(Boolean).join("\n");
    if(!(await ctx.ui.confirm("Enter "+identity+" session?",detail)))return {cancel:true};
  });
  pi.on("session_shutdown",()=>{uninstall?.();uninstall=undefined;});
}
