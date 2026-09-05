import {expect,test} from "bun:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {run} from "./helpers";

test("real TUI opens and closes /ps without leaking the focused component",async()=>{
 const home=await mkdtemp(join(tmpdir(),"die-ps-tui-"));const socket="die-ps-"+process.pid+"-"+Date.now();const name="ps";
 const tmux=(...args:string[])=>run(["tmux","-L",socket,...args]);const quote=(v:string)=>"'"+v.replaceAll("'","'\''")+"'";
 const capture=async()=> (await tmux("capture-pane","-p","-t",name)).stdout;
 try{
  const binary=resolve(import.meta.dir,"../dist/die");const launch=["env","HOME="+home,"DIE_CODING_AGENT_DIR="+join(home,".die","agent"),binary,"--offline","--no-session"].map(quote).join(" ");
  expect((await tmux("new-session","-d","-s",name,"-x","100","-y","30","-c",home,launch)).code).toBe(0);
  let frame="";for(let i=0;i<80;i++){frame=await capture();if(frame.includes("/model"))break;await Bun.sleep(50);}await Bun.sleep(500);
  await tmux("send-keys","-t",name,"-l","/ps");await tmux("send-keys","-t",name,"Enter");
  for(let i=0;i<80;i++){frame=await capture();if(frame.includes("Running jobs")&&frame.includes("No jobs have been started"))break;await Bun.sleep(50);}
  expect(frame).toContain("Running jobs");expect(frame).toContain("No jobs have been started");
  await tmux("send-keys","-t",name,"Escape");await Bun.sleep(100);frame=await capture();expect(frame).not.toContain("No jobs have been started");
 }finally{await tmux("kill-server").catch(()=>({code:1,stdout:"",stderr:""}));await rm(home,{recursive:true,force:true});}
},15000);
