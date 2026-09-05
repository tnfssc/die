import {test, expect} from "bun:test";
import {mkdtemp, rm} from "node:fs/promises";
import {homedir,tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {getModels} from "@earendil-works/pi-ai/compat";
import {ModelRuntime,createAgentSession,DefaultResourceLoader,SessionManager,SettingsManager,compact} from "@earendil-works/pi-coding-agent";
import tasks from "./phase1-compaction-fixture";

// A single synthetic warm-cache experiment, not a claim of general task quality.
// Artifacts retain failures; the test never retries to obtain a cache hit.
test.skipIf(process.env.DIE_RUN_LLM_TESTS!=="1")("live cache-affine checkpoint, cold baseline, and resumed usage",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"die-compact-live-"));
 const artifact=resolve("artifacts/compaction/live-"+Date.now()+".json");
 const evidence:any={phase:"setup",requests:[]};
 let session:Awaited<ReturnType<typeof createAgentSession>>["session"]|undefined;
 try {
  const model=getModels("openai-codex").find(m=>m.id===(process.env.DIE_COMPACTION_MODEL??"gpt-5.6-luna"));
  if(!model) throw new Error("Unknown DIE_COMPACTION_MODEL");
  const agentDir=process.env.DIE_CODING_AGENT_DIR??join(homedir(),".die","agent");
  const runtime=await ModelRuntime.create({authPath:join(agentDir,"auth.json"),modelsPath:null,refreshOnCreate:false});
  const manager=SessionManager.inMemory(dir);
  const zero={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
  const marker="CHECKPOINT_VALUE=fern-copper-731";
  const common={api:model.api,provider:model.provider,model:model.id,usage:zero};
  manager.appendMessage({role:"user",content:"This is a synthetic checkpoint fixture. The tool output contains CHECKPOINT_VALUE; preserve its exact value in any checkpoint. No real work or tool execution is needed.",timestamp:1});
  manager.appendMessage({role:"assistant",...common,content:[{type:"toolCall",id:"call_fixture_read",name:"execute",arguments:{code:'console.log("synthetic fixture read")'}}],stopReason:"toolUse",timestamp:2});
  manager.appendMessage({role:"toolResult",toolCallId:"call_fixture_read",toolName:"execute",content:[{type:"text",text:"Archive detail. ".repeat(2400)+"\n"+marker}],isError:false,timestamp:3});
  let preparation:any;
  const loader=new DefaultResourceLoader({cwd:dir,agentDir:dir,noExtensions:true,noSkills:true,noThemes:true,noPromptTemplates:true,extensionFactories:[{name:"capture-preparation",factory:pi=>{pi.on("session_before_compact",event=>{preparation=event.preparation;});}},{name:"die-tasks",factory:tasks}]});
  await loader.reload();
  ({session}=await createAgentSession({cwd:dir,agentDir:dir,resourceLoader:loader,model,modelRuntime:runtime,sessionManager:manager,settingsManager:SettingsManager.inMemory({transport:"sse",compaction:{enabled:false,keepRecentTokens:256,reserveTokens:8192}}),thinkingLevel:"medium",tools:["execute"]}));
  session.subscribe(event=>{if(event.type==="message_end"&&event.message.role==="assistant")evidence.requests.push({phase:evidence.phase,usage:event.message.usage,stopReason:event.message.stopReason,text:event.message.content.filter(p=>p.type==="text").map(p=>p.text).join("\n")});});
  evidence.phase="warm-up";
  await session.prompt("Reply READY only. Do not call tools. Context padding: "+"Nothing else has changed. ".repeat(180));
  await session.prompt("Reply READY only. Do not call tools. Retained-tail-only fact: TAIL_SENTINEL=violet-delta-912. More context padding: "+"Continue preserving the fixture. ".repeat(180));
  evidence.phase="cache-affine";
  const started=Date.now();
  const checkpoint=await session.compact("Keep the summary under 250 words and preserve CHECKPOINT_VALUE exactly.");
  evidence.affine={elapsedMs:Date.now()-started,...checkpoint};
  const saved=manager.getEntries().slice().reverse().find(e=>e.type==="compaction") as any;
  expect(saved.details?.strategy).toBe("cache-affine-plaintext");
  expect(saved.summary).toContain(marker);
  expect(saved.summary).not.toContain("violet-delta-912");
  expect(saved.usage.cacheRead).toBeGreaterThan(0);
  evidence.phase="resumed";
  await session.prompt("What is CHECKPOINT_VALUE? Reply with its exact value only; do not call tools.");
  expect(evidence.requests.at(-1).text).toContain("fern-copper-731");
  evidence.phase="default-baseline";
  const baselineStart=Date.now();
  const baseline=await compact(preparation,model,undefined,undefined,"Keep the summary under 250 words and preserve CHECKPOINT_VALUE exactly.",undefined,"medium",(m,c,o)=>runtime.streamSimple(m,c,o));
  evidence.baseline={elapsedMs:Date.now()-baselineStart,...baseline};
  evidence.phase="complete";
 } catch(error) {evidence.error=String(error);throw error;}
 finally {await Bun.write(artifact,JSON.stringify(evidence,null,2));console.log("Compaction experiment: "+artifact);session?.dispose();await rm(dir,{recursive:true,force:true});}
},180_000);
