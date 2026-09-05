import {test,expect,spyOn,afterEach} from "bun:test";
import extension from "../src/tasks/extension";
import * as execution from "../src/typescript/execution";
const originalDepth=process.env.DIE_SUBAGENT_DEPTH,originalType=process.env.DIE_SUBAGENT_TYPE;
afterEach(()=>{if(originalDepth===undefined)delete process.env.DIE_SUBAGENT_DEPTH;else process.env.DIE_SUBAGENT_DEPTH=originalDepth;if(originalType===undefined)delete process.env.DIE_SUBAGENT_TYPE;else process.env.DIE_SUBAGENT_TYPE=originalType;});
function load(depth=0,type?:string){
  process.env.DIE_SUBAGENT_DEPTH=String(depth);if(type)process.env.DIE_SUBAGENT_TYPE=type;else delete process.env.DIE_SUBAGENT_TYPE;
  const tools=new Map<string,any>(),handlers=new Map<string,Function[]>(),messages:any[]=[];let active:string[]=[];
  extension({registerTool:(t:any)=>tools.set(t.name,t),registerCommand(){},registerMessageRenderer(){},on:(e:string,h:Function)=>handlers.set(e,[...(handlers.get(e)??[]),h]),setActiveTools:(names:string[])=>active=names,sendMessage:(m:any)=>messages.push(m)} as any);
  const fire=async(event:string,...args:any[])=>{let result;for(const h of handlers.get(event)??[])result=await h(...args);return result;};
  return{tools,fire,messages,active:()=>active};
}
test("root and all agent profiles expose only execute",async()=>{
  for(const [depth,type] of [[0,undefined],[1,"fast"],[1,"normal"],[1,"orchestrator"],[2,"normal"]] as const){const e=load(depth,type);await e.fire("session_start",{},{});expect([...e.tools.keys()]).toEqual(["execute"]);expect(e.active()).toEqual(["execute"]);expect(e.tools.get("execute").promptGuidelines.join("\n")).toContain("jobs.inspect");await e.fire("session_shutdown",{},{});}
});
test("resumed leaf identity is retained in instructions",async()=>{
  const e=load(); const ctx={sessionManager:{getEntries:()=>[{type:"custom",customType:"die-agent",data:{type:"fast",depth:1}}]}};
  await e.fire("session_start",{},ctx);
  const result=await e.fire("before_agent_start",{systemPrompt:"base"},ctx);expect(result.systemPrompt).toContain("You are a fast sub-agent");expect(result.systemPrompt).toContain("Delegation is disabled");
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

test("root values are part of the agent frame and explicit user prompts retain precedence", async () => {
  const e = load();
  const framed = await e.fire("before_agent_start", {systemPrompt:"base", systemPromptOptions:{}}, {});
  expect(framed.systemPrompt).toContain("Working together");
  expect(framed.systemPrompt).toContain("Responsive collaboration");
  expect(framed.systemPrompt).toContain("main agent in orchestrator instruction mode");
  expect(framed.systemPrompt).toContain("delegation permissions remain available");
  const custom = await e.fire("before_agent_start", {systemPrompt:"user custom", systemPromptOptions:{customPrompt:"user custom"}}, {});
  expect(custom).toBeUndefined();
});


test("session lifecycle resets resumed child identity when returning to root", async () => {
  const e = load();
  const manager = (id: string, entries: any[]) => ({ getEntries: () => entries, getBranch: () => entries, getSessionId: () => id });
  const root = { sessionManager: manager("root", []) };
  const child = { sessionManager: manager("child", [{type:"custom",customType:"die-agent",data:{type:"normal",depth:1}}]) };
  let framed = await e.fire("before_agent_start", {systemPrompt:"base",systemPromptOptions:{}}, root);
  expect(framed.systemPrompt).toContain("main agent in orchestrator instruction mode");
  await e.fire("session_shutdown", {}, root);
  await e.fire("session_start", {}, child);
  framed = await e.fire("before_agent_start", {systemPrompt:"base",systemPromptOptions:{}}, child);
  expect(framed.systemPrompt).toContain("You are a normal sub-agent");
  await e.fire("session_shutdown", {}, child);
  await e.fire("session_start", {}, root);
  framed = await e.fire("before_agent_start", {systemPrompt:"base",systemPromptOptions:{}}, root);
  expect(framed.systemPrompt).toContain("main agent in orchestrator instruction mode");
  expect(framed.systemPrompt).not.toContain("You are a normal sub-agent");
  await e.fire("session_shutdown", {}, root);
});

test("spawned child environment remains the identity floor before metadata is attached", async () => {
  const e = load(1, "fast");
  const ctx = { sessionManager: { getEntries: () => [], getBranch: () => [], getSessionId: () => "fresh-child" } };
  await e.fire("session_start", {}, ctx);
  const framed = await e.fire("before_agent_start", {systemPrompt:"base",systemPromptOptions:{}}, ctx);
  expect(framed.systemPrompt).toContain("You are a fast sub-agent");
  expect(framed.systemPrompt).not.toContain("main agent in");
  await e.fire("session_shutdown", {}, ctx);
});


test("spawned environment roles cannot be changed by resumed metadata", async () => {
  const cases = [
    { environment: "normal", metadata: "orchestrator", delegation: "Delegation is disabled" },
    { environment: "orchestrator", metadata: "normal", delegation: "Fast/normal workers are available" },
  ] as const;
  for (const item of cases) {
    const e = load(1, item.environment);
    const entries = [{ type: "custom", customType: "die-agent", data: { type: item.metadata, depth: 1 } }];
    const ctx = { sessionManager: { getEntries: () => entries, getBranch: () => entries, getSessionId: () => "role-cap-" + item.environment } };
    await e.fire("session_start", {}, ctx);
    const framed = await e.fire("before_agent_start", { systemPrompt: "base", systemPromptOptions: {} }, ctx);
    expect(framed.systemPrompt).toContain("You are a " + item.environment + " sub-agent");
    expect(framed.systemPrompt).not.toContain("You are a " + item.metadata + " sub-agent");
    expect(framed.systemPrompt).toContain(item.delegation);
    await e.fire("session_shutdown", {}, ctx);
  }
});
