import {test,expect} from "bun:test";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createAssistantMessageEventStream,getModel,type AssistantMessage} from "@earendil-works/pi-ai/compat";
import {createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,type ToolDefinition,type ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {registerExecuteTool} from "../src/typescript/extension";

for (const allYield of [true,false]) test("Pi honors cooperative batch termination: allYield="+allYield,async()=>{
  const dir=await mkdtemp(join(tmpdir(),"die-handoff-batch-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"]|undefined;
  try {
    let tool!:ToolDefinition;
    registerExecuteTool({registerTool(value:ToolDefinition){tool=value;},on(){}} as unknown as ExtensionAPI);
    tool.execute=async(_id,args)=>({content:[{type:"text",text:"Progress"}],details:{handoff:"Progress"},terminate:allYield||(args as {code:string}).code==="one"});
    const loader=new DefaultResourceLoader({cwd:dir,agentDir:dir,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true});
    await loader.reload();
    const modelRuntime=await ModelRuntime.create({authPath:join(dir,"auth.json"),modelsPath:null,refreshOnCreate:false});
    modelRuntime.hasConfiguredAuth=()=>true;
    ({session}=await createAgentSession({cwd:dir,agentDir:dir,resourceLoader:loader,modelRuntime,model:getModel("openai-codex","gpt-5.6-luna"),sessionManager:SessionManager.inMemory(dir),customTools:[tool],tools:["execute"]}));
    let requests=0;
    session.agent.streamFunction=()=>{
      const first=++requests===1;
      const message:AssistantMessage={role:"assistant",api:"openai-codex-responses",provider:"openai-codex",model:"gpt-5.6-luna",timestamp:Date.now(),stopReason:first?"toolUse":"stop",usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},content:first?[{type:"toolCall",id:"one",name:"execute",arguments:{code:"one"}},{type:"toolCall",id:"two",name:"execute",arguments:{code:"two"}}]:[{type:"text",text:"done"}]};
      const stream=createAssistantMessageEventStream();
      stream.push({type:"start",partial:message});
      stream.push({type:"done",reason:first?"toolUse":"stop",message});
      return stream;
    };
    await session.prompt("Exercise the batch boundary");
    expect(requests).toBe(allYield?1:2);
    expect(session.isStreaming).toBe(false);
  } finally {session?.dispose();await rm(dir,{recursive:true,force:true});}
});
