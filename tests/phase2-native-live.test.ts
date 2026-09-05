import {test,expect} from "bun:test";
import {mkdtemp,rm} from "node:fs/promises";
import {homedir,tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {getModels} from "@earendil-works/pi-ai/compat";
import {ModelRuntime,SessionManager,SettingsManager,DefaultResourceLoader,createAgentSession} from "@earendil-works/pi-coding-agent";
import tasks from "../src/tasks/extension";

test.skipIf(process.env.DIE_RUN_LLM_TESTS!=="1")("native Codex live checkpoint and disk-resumed recall",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"die-native-live-"));
 const artifact=resolve("artifacts/compaction/native-live-"+Date.now()+".json");
 const evidence:any={phase:"setup",requests:[],notices:[]};
 let session:Awaited<ReturnType<typeof createAgentSession>>["session"]|undefined;
 let restoreNotify=()=>{};
 try {
  const model=getModels("openai-codex").find(m=>m.id===(process.env.DIE_COMPACTION_MODEL??"gpt-5.6-luna"));
  if(!model)throw Error("Unknown DIE_COMPACTION_MODEL");
  const agentDir=process.env.DIE_CODING_AGENT_DIR??join(homedir(),".die","agent");
  const runtime=await ModelRuntime.create({authPath:join(agentDir,"auth.json"),modelsPath:null,refreshOnCreate:false});
  const zero={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
  const marker="NATIVE_FIXTURE_VALUE=cedar-marble-842";
  let manager=SessionManager.create(dir,join(dir,"sessions"));
  manager.appendMessage({role:"user",content:"This is a synthetic context fixture. Preserve NATIVE_FIXTURE_VALUE from the tool output; do not perform real work.",timestamp:1});
  manager.appendMessage({role:"assistant",api:model.api,provider:model.provider,model:model.id,usage:zero,content:[{type:"toolCall",id:"call_native_fixture",name:"execute",arguments:{code:'console.log("synthetic fixture read")'}}],stopReason:"toolUse",timestamp:2});
  manager.appendMessage({role:"toolResult",toolCallId:"call_native_fixture",toolName:"execute",content:[{type:"text",text:"Historical fixture detail. ".repeat(1500)+"\n"+marker}],isError:false,timestamp:3});
  async function open(){
   const loader=new DefaultResourceLoader({cwd:dir,agentDir:dir,noExtensions:true,noSkills:true,noThemes:true,noPromptTemplates:true,extensionFactories:[{name:"observe",factory:pi=>{pi.on("before_agent_start",(_e,ctx)=>{const ui=ctx.ui,old=ui.notify;ui.notify=message=>{evidence.notices.push(message);};restoreNotify=()=>{ui.notify=old;};});}},{name:"die-tasks",factory:tasks}]});
   await loader.reload();
   const created=(await createAgentSession({cwd:dir,agentDir:dir,resourceLoader:loader,model,modelRuntime:runtime,sessionManager:manager,settingsManager:SettingsManager.inMemory({transport:"sse",compaction:{enabled:false,keepRecentTokens:128,reserveTokens:8192}}),thinkingLevel:"medium",tools:["execute"]})).session;
   created.subscribe(event=>{if(event.type==="message_end"&&event.message.role==="assistant")evidence.requests.push({phase:evidence.phase,usage:event.message.usage,stopReason:event.message.stopReason,text:event.message.content.filter(c=>c.type==="text").map(c=>c.text).join("\n")});});
   return created;
  }
  session=await open();
  evidence.phase="ordinary";
  await session.prompt("Reply READY only. No tools. Recent context padding: "+"Preserve the original fixture. ".repeat(180));
  evidence.phase="native-compaction";
  const started=Date.now();
  const checkpoint=await session.compact();
  const saved=manager.getEntries().slice().reverse().find(e=>e.type==="compaction") as any;
  expect(saved.details.strategy).toBe("codex-native");
  const opaque=saved.details.item;
  expect(opaque.type).toBe("compaction");
  expect(opaque.encrypted_content.length).toBeGreaterThan(0);
  expect(JSON.stringify(manager.buildSessionContext().messages)).not.toContain(marker);
  evidence.checkpoint={elapsedMs:Date.now()-started,usage:checkpoint.usage,strategy:saved.details.strategy,id:opaque.id,opaqueBytes:opaque.encrypted_content.length,opaqueSha256:createHash("sha256").update(opaque.encrypted_content).digest("hex")};
  const file=manager.getSessionFile()!;
  restoreNotify();session.dispose();session=undefined;
  manager=SessionManager.open(file);
  session=await open();
  evidence.phase="disk-resumed";
  await session.prompt("What is NATIVE_FIXTURE_VALUE? Reply with the exact value only. Do not call tools. Repeat-compaction fixture padding: "+"Keep the original fixture value. ".repeat(180));
  expect(evidence.requests.at(-1).text).toContain("cedar-marble-842");
  evidence.phase="repeat-compaction";
  const repeated=await session.compact();
  const latest=manager.getEntries().slice().reverse().find(e=>e.type==="compaction") as any;
  expect(latest.details.strategy).toBe("codex-native");
  evidence.repeated={usage:repeated.usage,strategy:latest.details.strategy,id:latest.details.item.id,opaqueBytes:latest.details.item.encrypted_content.length};
  evidence.phase="complete";
 } catch(error){evidence.error=String(error);throw error;}
 finally{await Bun.write(artifact,JSON.stringify(evidence,null,2));console.log("Native compaction evidence: "+artifact);restoreNotify();session?.dispose();await rm(dir,{recursive:true,force:true});}
},210_000);
