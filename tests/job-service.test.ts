import {test,expect,spyOn} from "bun:test";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {TaskManager,type TaskLaunch} from "../src/tasks/task-manager";
import {JobService} from "../src/tasks/job-service";
const signal=new AbortController().signal;
test("job helper validation rejects invalid inputs before spawning",async()=>{
  const manager=new TaskManager(()=>{}),service=new JobService(manager,()=>({depth:0}),()=>{});
  try{for(const [method,params] of [["shell",{command:""}],["shell",{command:"echo bad",waitSeconds:-1}],["shell",{command:"echo bad",waitSeconds:Infinity}],["jobs.inspect",{id:"x",limit:5001}],["jobs.list",{count:101}],["subagent",{prompt:"x",model:"p/override"}],["subagent",{type:"bad",prompt:"x"}],["jobs.input",{id:"x"}]])await expect(service.handle(method as string,params,{cwd:process.cwd()} as any,signal)).rejects.toThrow();expect(manager.list()).toHaveLength(0);}finally{await manager.shutdown();}
});
test("profile settings, child identity, and three-tier limits survive helper migration",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"die-jobs-profile-")),path=join(dir,"profiles.json");
  await writeFile(path,JSON.stringify({fast:{model:"p/quick",thinking:"off"}}));
  const manager=new TaskManager(()=>{}),launches:TaskLaunch[]=[];
  const spawn=spyOn(manager,"spawn").mockImplementation(launch=>{launches.push(launch);return{id:"fake",kind:"agent",command:"test",cwd:dir,status:"running",startedAt:new Date().toISOString(),baseOffset:0,outputEnd:0,timedOut:false};});
  const foreground=spyOn(manager,"foreground").mockResolvedValue({id:"fake",kind:"agent",command:"test",cwd:dir,status:"running",startedAt:new Date().toISOString(),baseOffset:0,outputEnd:0,timedOut:false,output:"",requestedOffset:0,nextOffset:0,outputLost:false,hasMore:false,background:true});
  let policy:{depth:number;type?:string}={depth:0};const service=new JobService(manager,()=>policy,()=>{},path);
  const ctx={cwd:dir,model:{provider:"p",id:"parent"},thinkingLevel:"medium",sessionManager:{getSessionDir:()=>dir,getSessionFile:()=>undefined}} as any;
  try{
    await service.handle("subagent",{type:"fast",prompt:"scout"},ctx,signal);expect(launches[0]!.args).toContain("p/quick");expect(launches[0]!.args).toContain("off");expect(launches[0]!.env?.DIE_SUBAGENT_TYPE).toBe("fast");expect(foreground.mock.calls[0]![1]).toBe(1000);
    for(const type of ["fast","normal"]){policy={depth:1,type};await expect(service.handle("subagent",{prompt:"x"},ctx,signal)).rejects.toThrow("Only orchestrator");}
    policy={depth:1,type:"orchestrator"};await expect(service.handle("subagent",{type:"orchestrator",prompt:"x"},ctx,signal)).rejects.toThrow("fast/normal");
    await service.handle("subagent",{type:"fast",prompt:"x"},ctx,signal);expect(launches[1]!.env?.DIE_SUBAGENT_DEPTH).toBe("2");
    policy={depth:2,type:"orchestrator"};await expect(service.handle("subagent",{prompt:"x"},ctx,signal)).rejects.toThrow("two levels");
  }finally{spawn.mockRestore();foreground.mockRestore();await manager.shutdown();await rm(dir,{recursive:true,force:true});}
});
