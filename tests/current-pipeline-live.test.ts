import {test,expect} from "bun:test";
import {mkdtemp,rm} from "node:fs/promises";
import {homedir,tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {getModels} from "@earendil-works/pi-ai/compat";
import {ModelRuntime,SessionManager,SettingsManager,DefaultResourceLoader,createAgentSession} from "@earendil-works/pi-coding-agent";
import phase1Fixture from "./phase1-compaction-fixture";

test.skipIf(process.env.DIE_RUN_LLM_TESTS!=="1")("current pipeline live: fresh resume and uncaptured tool results",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"die-current-live-"));
 const artifact=resolve("artifacts/compaction/current-live-"+Date.now()+".json");
 const evidence:any={phase:"setup",requests:[],payloads:[]};
 let session:Awaited<ReturnType<typeof createAgentSession>>["session"]|undefined;
 try {
  const model=getModels("openai-codex").find(m=>m.id===(process.env.DIE_COMPACTION_MODEL??"gpt-5.6-luna"));
  if(!model)throw Error("Unknown DIE_COMPACTION_MODEL");
  const runtime=await ModelRuntime.create({authPath:join(process.env.DIE_CODING_AGENT_DIR??join(homedir(),".die","agent"),"auth.json"),modelsPath:null,refreshOnCreate:false});
  const zero={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
  let manager=SessionManager.create(dir,join(dir,"sessions"));
  function addTool(value:string,id:string){
   manager.appendMessage({role:"assistant",api:model!.api,provider:model!.provider,model:model!.id,usage:zero,content:[{type:"toolCall",id,name:"execute",arguments:{code:'console.log("synthetic fixture")'}}],stopReason:"toolUse",timestamp:Date.now()});
   manager.appendMessage({role:"toolResult",toolCallId:id,toolName:"execute",content:[{type:"text",text:"Historical tool fixture detail. ".repeat(300)+"\nPRIVATE_REDACT_ME\nCURRENT_VALUE="+value}],isError:false,timestamp:Date.now()});
   manager.appendMessage({role:"user",content:"Preserve CURRENT_VALUE. No real work or tools needed. Recent padding: "+"Maintain the exact fixture value. ".repeat(180),timestamp:Date.now()});
   manager.appendMessage({role:"assistant",api:model!.api,provider:model!.provider,model:model!.id,usage:zero,content:[{type:"text",text:"Fixture noted."}],stopReason:"stop",timestamp:Date.now()});
  }
  manager.appendMessage({role:"user",content:"This is a synthetic memory fixture; preserve the CURRENT_VALUE from tool output.",timestamp:1});
  addTool("sequoia-bronze-318","call_fresh_fixture");
  const file=manager.getSessionFile()!;
  manager=SessionManager.open(file);
  async function open(){
   const loader=new DefaultResourceLoader({cwd:dir,agentDir:dir,noExtensions:true,noSkills:true,noThemes:true,noPromptTemplates:true,extensionFactories:[{name:"observe",factory:pi=>{
    pi.on("context",event=>({messages:event.messages.map(m=>m.role==="toolResult"?{...m,content:m.content.map(c=>c.type==="text"?{...c,text:c.text.replaceAll("PRIVATE_REDACT_ME","[REDACTED]")}:c)}:m)}));
    pi.on("before_provider_request",event=>{const text=JSON.stringify(event.payload);evidence.payloads.push({phase:evidence.phase,redactionIntact:!text.includes("PRIVATE_REDACT_ME"),hasNewValue:text.includes("harbor-amber-641")});});
   }},{name:"plaintext-strategy-fixture",factory:phase1Fixture}]});
   await loader.reload();
   const created=(await createAgentSession({cwd:dir,agentDir:dir,resourceLoader:loader,model,modelRuntime:runtime,sessionManager:manager,settingsManager:SettingsManager.inMemory({transport:"sse",compaction:{enabled:false,keepRecentTokens:128,reserveTokens:8192}}),thinkingLevel:"medium",tools:["execute"]})).session;
   created.subscribe(event=>{if(event.type==="message_end"&&event.message.role==="assistant")evidence.requests.push({phase:evidence.phase,usage:event.message.usage,stopReason:event.message.stopReason,text:event.message.content.filter(c=>c.type==="text").map(c=>c.text).join("\n")});});
   return created;
  }
  session=await open();
  evidence.phase="fresh-resume-compaction";
  const first=await session.compact();
  const saved=manager.getEntries().slice().reverse().find(e=>e.type==="compaction") as any;
  expect(saved.details.strategy).toBe("cache-affine-plaintext");
  expect(first.summary).toContain("sequoia-bronze-318");
  evidence.first={usage:first.usage,details:saved.details};
  session.dispose();session=undefined;manager=SessionManager.open(file);session=await open();
  evidence.phase="ordinary-recall";
  await session.prompt("What is CURRENT_VALUE? Reply with its exact value only, no tools.");
  expect(evidence.requests.at(-1).text).toContain("sequoia-bronze-318");
  addTool("harbor-amber-641","call_uncaptured_fixture");
  session.agent.state.messages=manager.buildSessionContext().messages;
  evidence.phase="uncaptured-tool-compaction";
  const second=await session.compact();
  const latest=manager.getEntries().slice().reverse().find(e=>e.type==="compaction") as any;
  expect(latest.details.strategy).toBe("cache-affine-plaintext");
  expect(second.summary).toContain("harbor-amber-641");
  expect(JSON.stringify(manager.buildSessionContext().messages.filter(m=>m.role!=="compactionSummary"))).not.toContain("harbor-amber-641");
  expect(evidence.payloads).toHaveLength(3);
  expect(evidence.payloads.every((p:any)=>p.redactionIntact)).toBe(true);
  expect(evidence.payloads.at(-1).hasNewValue).toBe(true);
  evidence.second={usage:second.usage,details:latest.details};evidence.phase="complete";
 }catch(error){evidence.error=String(error);throw error;}
 finally{await Bun.write(artifact,JSON.stringify(evidence,null,2));console.log("Current pipeline evidence: "+artifact);session?.dispose();await rm(dir,{recursive:true,force:true});}
},210_000);
