import {expect,test} from "bun:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createAssistantMessageEventStream,getModel,type AssistantMessage} from "@earendil-works/pi-ai/compat";
import {ModelRuntime,createAgentSession,DefaultResourceLoader,SessionManager,SettingsManager} from "@earendil-works/pi-coding-agent";
import tasks from "../src/tasks/extension";
import {CACHE_CALL_ENTRY} from "../src/tasks/cache-countdown";

const usage={input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
async function make(root:string,rejectPayload=false,noHttpHook=false) {
 let network=0;
 const model=getModel("anthropic","claude-sonnet-4-5")!;
 const runtime=await ModelRuntime.create({authPath:join(root,"auth.json"),modelsPath:null,refreshOnCreate:false});
 runtime.hasConfiguredAuth=()=>true; runtime.getAuth=(async()=>({auth:{apiKey:"offline"}})) as any;
 const stream=(m:any,_c:any,o:any)=>{const out=createAssistantMessageEventStream();void(async()=>{
   // Real runtime-provided provider hooks surround the request at this seam.
   await o?.onPayload?.({model:m.id,input:[]},m);
   if(rejectPayload) throw new Error("payload rejected before fetch");
   await o?.transformHeaders?.({});
   network++;
   if (!noHttpHook) await o?.onResponse?.({status:200,headers:{}},m);
   const message:AssistantMessage={role:"assistant",api:m.api,provider:m.provider,model:m.id,content:[{type:"text",text:"offline"}],stopReason:"stop",usage,timestamp:Date.now()};
   out.push({type:"done",reason:"stop",message});out.end(message);
  })().catch(error=>{const message:any={role:"assistant",api:m.api,provider:m.provider,model:m.id,content:[],stopReason:"error",errorMessage:String(error),usage,timestamp:Date.now()};out.push({type:"error",reason:"error",error:message});out.end(message);});return out;};
 runtime.stream=stream as any;runtime.streamSimple=stream as any;
 const manager=SessionManager.create(root,join(root,"sessions"));
 const loader=new DefaultResourceLoader({cwd:root,agentDir:root,noExtensions:true,noSkills:true,noThemes:true,noPromptTemplates:true,extensionFactories:[{name:"die",factory:pi=>tasks(pi,{cacheSettingsPath:join(root,"cache-settings.json"),profilesPath:join(root,"profiles.json")})}]});
 await loader.reload();
 const {session}=await createAgentSession({cwd:root,agentDir:root,resourceLoader:loader,model,modelRuntime:runtime,sessionManager:manager,settingsManager:SettingsManager.inMemory({compaction:{enabled:false}}),tools:["execute"]});
 return {session,manager,get network(){return network;}};
}

test("SDK provider pipeline records only the calling agent and survives disk resume",async()=>{
 const root=await mkdtemp(join(tmpdir(),"die-cache-sdk-"));
 try {
  const a=await make(join(root,"a")), b=await make(join(root,"b"));
  await a.session.prompt("one actual request");
  const calls=()=>a.manager.getEntries().filter(e=>e.type==="custom"&&e.customType===CACHE_CALL_ENTRY);
  expect(calls()).toHaveLength(1);
  expect(b.manager.getEntries().filter(e=>e.type==="custom"&&e.customType===CACHE_CALL_ENTRY)).toHaveLength(0);
  const call=(calls()[0] as any).data;expect(call.provider).toBe("anthropic");expect(call.model).toBe("claude-sonnet-4-5");
  const file=a.manager.getSessionFile()!;a.session.dispose();b.session.dispose();
  const resumed=SessionManager.open(file);
  expect(resumed.getEntries().some(e=>e.type==="custom"&&e.customType===CACHE_CALL_ENTRY&&(e as any).data.timestamp===call.timestamp)).toBe(true);
 } finally {await rm(root,{recursive:true,force:true});}
});


test("payload rejection before fetch does not reset the estimate",async()=>{
 const root=await mkdtemp(join(tmpdir(),"die-cache-reject-"));
 try {
  const run=await make(root,true);
  await run.session.prompt("reject before network").catch(()=>{});
  expect(run.network).toBe(0);
  expect(run.manager.getEntries().filter(e=>e.type==="custom"&&e.customType===CACHE_CALL_ENTRY)).toHaveLength(0);
  run.session.dispose();
 } finally {await rm(root,{recursive:true,force:true});}
});


test("successful terminal observation covers transports without an HTTP hook",async()=>{
 const root=await mkdtemp(join(tmpdir(),"die-cache-terminal-"));
 try {
  const run=await make(root,false,true);
  await run.session.prompt("scripted WebSocket success");
  expect(run.network).toBe(1);
  const calls=run.manager.getEntries().filter(e=>e.type==="custom"&&e.customType===CACHE_CALL_ENTRY);
  expect(calls).toHaveLength(1);
  expect((calls[0] as any).data).toMatchObject({provider:"anthropic",model:"claude-sonnet-4-5"});
  run.session.dispose();
 } finally {await rm(root,{recursive:true,force:true});}
});
