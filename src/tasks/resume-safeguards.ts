import { open } from "node:fs/promises";
import { SessionManager, type ExtensionAPI, type SessionInfo } from "@earendil-works/pi-coding-agent";

const METADATA_LIMIT=128*1024;
type Role={kind:"root"|"orchestrator"|"worker";type?:string;taskId?:string};

export async function readSessionRole(path:string):Promise<Role>{
  let handle;
  try{
    handle=await open(path,"r");
    const buffer=Buffer.alloc(METADATA_LIMIT);
    const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    for(const line of buffer.subarray(0,bytesRead).toString("utf8").split("\n")){
      if(!line.includes('"die-agent"'))continue;
      try{
        const entry=JSON.parse(line);
        if(entry?.type==="custom" && entry.customType==="die-agent"){
          const type=typeof entry.data?.type==="string"?entry.data.type:"normal";
          return {kind:type==="orchestrator"?"orchestrator":"worker",type,taskId:typeof entry.data?.taskId==="string"?entry.data.taskId:undefined};
        }
      }catch{/* A partial final line is expected at the diagnostic bound. */}
    }
  }catch{return {kind:"root"};}
  finally{await handle?.close().catch(()=>{});}
  return {kind:"root"};
}

function roleLabel(role:Role):string{
  if(role.kind==="root")return "● root";
  if(role.kind==="orchestrator")return "◆ orchestrator";
  return "◇ worker · "+role.type;
}
async function decorate(sessions:SessionInfo[]):Promise<SessionInfo[]>{
  return Promise.all(sessions.map(async session=>{
    const label=roleLabel(await readSessionRole(session.path));
    // SessionInfo is picker-only projection. Never append or replace durable names.
    return session.name ? {...session,name:label+" · "+session.name} : {...session,firstMessage:label+" · "+session.firstMessage};
  }));
}

let installs=0;
let originalList:typeof SessionManager.list|undefined;
let originalListAll:typeof SessionManager.listAll|undefined;
function installPickerAdapter():()=>void{
  installs++;
  if(installs===1){
    originalList=SessionManager.list.bind(SessionManager) as typeof SessionManager.list;
    originalListAll=SessionManager.listAll.bind(SessionManager) as typeof SessionManager.listAll;
    (SessionManager as any).list=async(...args:any[])=>decorate(await (originalList as any)(...args));
    (SessionManager as any).listAll=async(...args:any[])=>decorate(await (originalListAll as any)(...args));
  }
  let active=true;
  return()=>{
    if(!active)return;active=false;installs--;
    if(installs===0 && originalList && originalListAll){
      (SessionManager as any).list=originalList;
      (SessionManager as any).listAll=originalListAll;
      originalList=originalListAll=undefined;
    }
  };
}

/** Adds role labels to Pi's actual picker projection and guards child entry. */
export function registerResumeSafeguards(pi:ExtensionAPI):void{
  let uninstall: (()=>void)|undefined;
  pi.on("session_start",()=>{ uninstall?.(); uninstall=installPickerAdapter(); });
  pi.on("session_before_switch",async(event,ctx)=>{
    if(event.reason!=="resume" || !event.targetSessionFile)return;
    const role=await readSessionRole(event.targetSessionFile);
    if(role.kind==="root")return;
    const identity=role.kind==="orchestrator"?"orchestrator child":"worker child ("+role.type+")";
    const detail=["This session has delegated-agent restrictions.",role.taskId?"Task: "+role.taskId:undefined,"Resume it deliberately rather than its root session."].filter(Boolean).join("\n");
    if(!(await ctx.ui.confirm("Enter "+identity+" session?",detail)))return {cancel:true};
  });
  pi.on("session_shutdown",()=>{uninstall?.();uninstall=undefined;});
}
