import {test,expect,spyOn,afterEach} from "bun:test";
import extension from "../src/tasks/extension";
import * as execution from "../src/typescript/execution";
const originalDepth=process.env.DIE_SUBAGENT_DEPTH,originalType=process.env.DIE_SUBAGENT_TYPE;
afterEach(()=>{if(originalDepth===undefined)delete process.env.DIE_SUBAGENT_DEPTH;else process.env.DIE_SUBAGENT_DEPTH=originalDepth;if(originalType===undefined)delete process.env.DIE_SUBAGENT_TYPE;else process.env.DIE_SUBAGENT_TYPE=originalType;});
function load(depth=0,type?:string,options:any={}){
  process.env.DIE_SUBAGENT_DEPTH=String(depth);if(type)process.env.DIE_SUBAGENT_TYPE=type;else delete process.env.DIE_SUBAGENT_TYPE;
  const tools=new Map<string,any>(),handlers=new Map<string,Function[]>(),messages:any[]=[];let active:string[]=[];
  extension({registerTool:(t:any)=>tools.set(t.name,t),registerCommand(){},registerMessageRenderer(){},on:(e:string,h:Function)=>handlers.set(e,[...(handlers.get(e)??[]),h]),setActiveTools:(names:string[])=>active=names,sendMessage:(m:any)=>messages.push(m)} as any,options);
  const fire=async(event:string,...args:any[])=>{let result;for(const h of handlers.get(event)??[])result=await h(...args);return result;};
  return{tools,fire,messages,active:()=>active};
}
test("root and all agent profiles expose only execute",async()=>{
  for(const [depth,type] of [[0,undefined],[1,"fast"],[1,"normal"],[1,"orchestrator"],[2,"normal"]] as const){const e=load(depth,type);await e.fire("session_start",{},{});expect([...e.tools.keys()]).toEqual(["execute"]);expect(e.active()).toEqual(["execute"]);expect(e.tools.get("execute").promptGuidelines.join("\n")).toContain("jobs.inspect");await e.fire("session_shutdown",{},{});}
});
test("resumed leaf identity is retained in instructions",async()=>{
  const e=load();await e.fire("session_start",{},{sessionManager:{getEntries:()=>[{type:"custom",customType:"die-agent",data:{type:"fast",depth:1}}]}});
  const result=await e.fire("before_agent_start",{systemPrompt:"base"},{});expect(result.systemPrompt).toContain("You are a fast sub-agent");expect(result.systemPrompt).toContain("Delegation is disabled");
});
for(const mode of ["print","json"])test(mode+" idle boundary still resumes background jobs",async()=>{
  const e=load();let rpc:any;const mock=spyOn(execution,"executeIsolated").mockImplementation(async(_c,_w,_s,_t,options)=>{rpc=options!.jobHandler;return{exitCode:0,stdout:"",stderr:"",stdoutLost:false,stderrLost:false,timedOut:false,cancelled:false,images:[]};});
  try{
    await e.tools.get("execute").execute("bind",{code:""},undefined,undefined,{cwd:process.cwd()});mock.mockRestore();
    const signal=new AbortController().signal;
    const task=await rpc("shell",{command:"read value; printf ready",waitSeconds:0},signal);
    let ended=false;const boundary=e.fire("agent_end",{messages:[]},{mode}).then(()=>ended=true);
    await Bun.sleep(10);expect(ended).toBe(false);
    await rpc("jobs.input",{id:task.id,data:"go\n",closeInput:true},signal);await boundary;
    expect(e.messages).toHaveLength(1);expect(e.messages[0].content).toContain("ready");
  }finally{mock.mockRestore();await e.fire("session_shutdown",{},{});}
});

test("print agent_end wakes on attention while a job is still running",async()=>{
  const e=load(0,undefined,{attention:{quietMs:15,reviewMs:1000}});let rpc:any;
  const mock=spyOn(execution,"executeIsolated").mockImplementation(async(_c,_w,_s,_t,options)=>{rpc=options!.jobHandler;return{exitCode:0,stdout:"",stderr:"",stdoutLost:false,stderrLost:false,timedOut:false,cancelled:false,images:[]};});
  try{
    await e.tools.get("execute").execute("bind",{code:""},undefined,undefined,{cwd:process.cwd()});mock.mockRestore();
    const signal=new AbortController().signal, task=await rpc("shell",{command:"read value",waitSeconds:0},signal);
    await e.fire("agent_end",{messages:[]},{mode:"print",signal});
    await Bun.sleep(120);
    expect(e.messages).toHaveLength(1);expect(e.messages[0].customType).toBe("task-attention");
    expect(e.messages[0].content).toContain("Jobs continue running");expect(e.messages[0].content).toContain(task.id);
    await rpc("jobs.stop",{id:task.id},signal);
  }finally{mock.mockRestore();await e.fire("session_shutdown",{},{});}
});

test("attention and a racing completion produce one deduplicated parent wakeup",async()=>{
  const e=load(0,undefined,{attention:{quietMs:15,reviewMs:1000}});let rpc:any;
  const mock=spyOn(execution,"executeIsolated").mockImplementation(async(_c,_w,_s,_t,options)=>{rpc=options!.jobHandler;return{exitCode:0,stdout:"",stderr:"",stdoutLost:false,stderrLost:false,timedOut:false,cancelled:false,images:[]};});
  try{
    await e.tools.get("execute").execute("bind",{code:""},undefined,undefined,{cwd:process.cwd()});mock.mockRestore();
    const signal=new AbortController().signal;const task=await rpc("shell",{command:"read value; printf done",waitSeconds:0},signal);
    const boundary=e.fire("agent_end",{messages:[]},{mode:"print",signal});
    await Bun.sleep(25);await rpc("jobs.input",{id:task.id,data:"go\n",closeInput:true},signal);
    await boundary;
    const deadline=Date.now()+2000;while(!e.messages.length&&Date.now()<deadline)await Bun.sleep(10);
    expect(e.messages).toHaveLength(1);expect(e.messages[0].customType).toBe("task-complete");
    expect(e.messages[0].content).toContain("completed");
    // Stale attention for the now-completed task is removed from the same batch.
    expect(e.messages[0].content).not.toContain("attention checkpoint");
  }finally{mock.mockRestore();await e.fire("session_shutdown",{},{});}
});

test("root values are part of the agent frame and explicit user prompts retain precedence", async () => {
  const e = load();
  const framed = await e.fire("before_agent_start", {systemPrompt:"base", systemPromptOptions:{}}, {});
  expect(framed.systemPrompt).toContain("Working together");
  expect(framed.systemPrompt).toContain("Responsive collaboration");
  const custom = await e.fire("before_agent_start", {systemPrompt:"user custom", systemPromptOptions:{customPrompt:"user custom"}}, {});
  expect(custom).toBeUndefined();
});


test("mixed completion and attention reserve bounded evidence for both",async()=>{
  let now=Date.now(), nextTimer=1;const timers=new Map<number,{at:number;callback:()=>void}>();
  const clock={now:()=>now,setTimeout:(callback:()=>void,delay:number)=>{const id=nextTimer++;timers.set(id,{at:now+delay,callback});return id;},clearTimeout:(id:unknown)=>timers.delete(id as number)};
  const advance=(ms:number)=>{now+=ms;for(;;){const due=[...timers].find(([,timer])=>timer.at<=now);if(!due)break;timers.delete(due[0]);due[1].callback();}};
  const e=load(0,undefined,{attention:{quietMs:15,reviewMs:1000,clock}});let rpc:any;
  const mock=spyOn(execution,"executeIsolated").mockImplementation(async(_c,_w,_s,_t,options)=>{rpc=options!.jobHandler;return{exitCode:0,stdout:"",stderr:"",stdoutLost:false,stderrLost:false,timedOut:false,cancelled:false,images:[]};});
  try {
    await e.tools.get("execute").execute("bind",{code:""},undefined,undefined,{cwd:process.cwd()});mock.mockRestore();
    const signal=new AbortController().signal;
    const idle=await rpc("shell",{command:"read value",waitSeconds:0},signal);
    const finishing=await rpc("shell",{command:"read value; head -c 20000 /dev/zero | tr '\\0' x",waitSeconds:0},signal);
    const boundary=e.fire("agent_end",{messages:[]},{mode:"print",signal});
    advance(15);await rpc("jobs.input",{id:finishing.id,data:"go\n",closeInput:true},signal);
    while((await rpc("jobs.inspect",{id:finishing.id},signal)).status==="running")await Bun.sleep(1);
    await boundary;
    expect(e.messages).toHaveLength(1);const message=e.messages[0];
    expect(message.content.length).toBeLessThanOrEqual(5000);
    expect(message.content).toContain(finishing.id);expect(message.content).toContain("completed");
    expect(message.content).toContain(idle.id);expect(message.content).toContain("attention checkpoint");
    expect(message.details.omittedAttention).toBe(0);
    await rpc("jobs.stop",{id:idle.id},signal);
  } finally {mock.mockRestore();await e.fire("session_shutdown",{},{});}
});
