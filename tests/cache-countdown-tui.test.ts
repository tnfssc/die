import {expect,test} from "bun:test";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {run} from "./helpers";

test("real PTY shows unknown estimate and /cache-ttl persists a validated value",async()=>{
 const home=await mkdtemp(join(tmpdir(),"die-cache-pty-"));const socket="die-cache-"+process.pid+"-"+Date.now(),session="cache";
 const tmux=(...args:string[])=>run(["tmux","-L",socket,...args]);const quote=(v:string)=>"'"+v.replaceAll("'","'\''")+"'";
 const capture=()=>tmux("capture-pane","-p","-t",session,"-S","-");
 async function waitFor(text:string){let frame="";for(let i=0;i<100;i++){frame=(await capture()).stdout;if(frame.includes(text))return frame;await Bun.sleep(50);}throw Error("Missing "+text+" in:\n"+frame);}
 try {
  const binary=resolve(import.meta.dir,"../dist/die");
  const launch=["env","HOME="+home,"DIE_CODING_AGENT_DIR="+join(home,".die","agent"),"OPENAI_API_KEY=offline",binary,"--offline","--no-session","--provider","openai","--model","gpt-4o"].map(quote).join(" ");
  expect((await tmux("new-session","-d","-s",session,"-x","140","-y","35","-c",home,launch)).code).toBe(0);
  expect(await waitFor("cache est ?")).toContain("· cache est ?");
  await tmux("send-keys","-t",session,"-l","/cache-ttl 30m");await tmux("send-keys","-t",session,"Enter");
  expect(await waitFor("Cache TTL estimate set to 30m")).toContain("does not guarantee provider cache retention or hits");
  expect(JSON.parse(await readFile(join(home,".die","settings.json"),"utf8"))).toEqual({cacheTtlMs:1_800_000});
 } finally {await tmux("kill-server").catch(()=>({code:1,stdout:"",stderr:""}));await rm(home,{recursive:true,force:true});}
},15_000);
