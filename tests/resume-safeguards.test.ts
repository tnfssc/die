import {expect,test} from "bun:test";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {SessionManager} from "@earendil-works/pi-coding-agent";
import {registerResumeSafeguards,readSessionRole} from "../src/tasks/resume-safeguards";
import {prepareAgentSession} from "../src/tasks/agent-session";

test("durable agent metadata drives picker labels and deliberate child confirmation",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"die-resume-role-"));
 try{
  const prepared=await prepareAgentSession(dir,dir,{type:"normal",model:"p/model",depth:1,parentSessionFile:"/parent.jsonl"});
  const file=prepared.agent.sessionFile,role=await readSessionRole(file);
  expect(role).toEqual({kind:"worker",type:"normal",taskId:prepared.id});
  const handlers=new Map<string,Function>();registerResumeSafeguards({on:(event:string,handler:Function)=>handlers.set(event,handler)} as any);
  const originalList=SessionManager.list,originalListAll=SessionManager.listAll;
  await handlers.get("session_start")?.({}, {mode:"tui",sessionManager:{getSessionFile:()=>file}});
  const picker=await SessionManager.list(dir,dir);expect(picker[0]?.name).toContain("◇ worker · normal");
  let prompt="";const denied=await handlers.get("session_before_switch")?.({reason:"resume",targetSessionFile:file},{mode:"tui",ui:{confirm:async(title:string,message:string)=>{prompt=title+"\n"+message;return false;}}});
  expect(denied).toEqual({cancel:true});expect(prompt).toContain("worker child (normal)");expect(prompt).toContain(prepared.id);
  await handlers.get("session_shutdown")?.();expect(SessionManager.list).toBe(originalList);expect(SessionManager.listAll).toBe(originalListAll);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test("root sessions are not confirmation-gated",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"die-resume-root-")),file=join(dir,"root.jsonl");
 try{
  await writeFile(file,'{"type":"session"}\n');let confirms=0;const handlers=new Map<string,Function>();registerResumeSafeguards({on:(e:string,h:Function)=>handlers.set(e,h)} as any);await handlers.get("session_start")?.({}, {mode:"tui",sessionManager:{getSessionFile:()=>file}});
  expect(await handlers.get("session_before_switch")?.({reason:"resume",targetSessionFile:file},{ui:{confirm:async()=>{confirms++;return false;}}})).toBeUndefined();expect(confirms).toBe(0);await handlers.get("session_shutdown")?.();
 }finally{await rm(dir,{recursive:true,force:true});}
});


test("picker adapter decorates only the active die directory and non-TUI resumes do not prompt",async()=>{
 const dieDir=await mkdtemp(join(tmpdir(),"die-picker-scope-")),otherDir=await mkdtemp(join(tmpdir(),"other-picker-scope-"));
 try{
  const child=await prepareAgentSession(dieDir,dieDir,{type:"fast",model:"p/model",depth:1,parentSessionFile:"/parent.jsonl"});
  await prepareAgentSession(otherDir,otherDir,{type:"normal",model:"p/model",depth:1,parentSessionFile:"/other.jsonl"});
  const handlers=new Map<string,Function>();registerResumeSafeguards({on:(e:string,h:Function)=>handlers.set(e,h)} as any);
  await handlers.get("session_start")?.({}, {mode:"tui",sessionManager:{getSessionFile:()=>child.agent.sessionFile}});
  expect((await SessionManager.list(dieDir,dieDir))[0]?.name).toContain("◇ worker · fast");
  expect((await SessionManager.list(otherDir,otherDir))[0]?.name).not.toContain("◇ worker");
  let confirms=0;
  expect(await handlers.get("session_before_switch")?.({reason:"resume",targetSessionFile:child.agent.sessionFile},{mode:"print",ui:{confirm:async()=>{confirms++;return false;}}})).toBeUndefined();
  expect(confirms).toBe(0);await handlers.get("session_shutdown")?.();
 }finally{await rm(dieDir,{recursive:true,force:true});await rm(otherDir,{recursive:true,force:true});}
});

test("unreadable session metadata remains unknown rather than labeled root",async()=>{
 expect((await readSessionRole(join(tmpdir(),"missing-die-session-"+Date.now()))).kind).toBe("unknown");
});
