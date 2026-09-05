import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { run } from "./helpers";

test("real TUI folds execute input/output and task-complete messages, with expansion", async () => {
  const home=await mkdtemp(join(tmpdir(),"die-preview-pty-"));
  const socket="die-preview-"+process.pid+"-"+Date.now();
  const tmux=(...args:string[])=>run(["tmux","-L",socket,...args]);
  const key=(...keys:string[])=>tmux("send-keys","-t","preview",...keys);
  const quote=(value:string)=>"'"+value.replaceAll("'", "'\\''")+"'";
  async function frameContaining(text:string,history=false) {
    let frame="";
    for(let attempt=0;attempt<80;attempt++) {
      frame=(await tmux("capture-pane","-p","-t","preview",...(history?["-S","-"]:[]))).stdout;
      if(frame.includes(text)) return frame;
      await Bun.sleep(50);
    }
    throw new Error("Missing "+text+" in frame:\n"+frame);
  }
  try {
    const session=SessionManager.create(home,join(home,"sessions"));
    const code=["// INPUT_FIRST",...Array.from({length:20},(_,i)=>"// INPUT_HIDDEN_"+i)].join("\n");
    const stdout=[...Array.from({length:20},(_,i)=>"OUTPUT_HIDDEN_"+i),"OUTPUT_LAST"].join("\n");
    const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
    session.appendMessage({role:"user",content:"Preview fixture",timestamp:Date.now()});
    session.appendMessage({role:"assistant",content:[{type:"toolCall",id:"preview-call",name:"execute",arguments:{code}}],api:"openai-completions",provider:"openai",model:"gpt-4o",usage,stopReason:"toolUse",timestamp:Date.now()});
    session.appendMessage({role:"toolResult",toolCallId:"preview-call",toolName:"execute",content:[{type:"text",text:"Execution completed with exit code 0.\n\nstdout:\n"+stdout}],details:{stdout,stderr:""},isError:false,timestamp:Date.now()});
    session.appendCustomMessageEntry("task-complete","1 asynchronous task completed.\ntask_fixture completed\n"+Array.from({length:30},(_,i)=>"TASK_HIDDEN_"+i).join("\n")+"\nTASK_LAST",true);
    const binary=resolve(import.meta.dir,"../dist/die");
    const launch=["env","HOME="+home,"DIE_CODING_AGENT_DIR="+join(home,".die","agent"),"OPENAI_API_KEY=offline-test-placeholder",binary,"--offline","--session",session.getSessionFile()!,"--provider","openai","--model","gpt-4o"].map(quote).join(" ");
    expect((await tmux("new-session","-d","-s","preview","-x","120","-y","50","-c",home,launch)).code).toBe(0);
    const compact=await frameContaining("TASK_LAST");
    expect(compact).toContain("INPUT_FIRST");expect(compact).toContain("OUTPUT_LAST");expect(compact).toContain("…");
    expect(compact).not.toContain("INPUT_HIDDEN_10");expect(compact).not.toContain("OUTPUT_HIDDEN_10");expect(compact).not.toContain("TASK_HIDDEN_10");
    await Bun.sleep(1000);
    await key("C-o");
    const expanded=await frameContaining("TASK_HIDDEN_10",true);
    expect(expanded).toContain("INPUT_HIDDEN_10");expect(expanded).toContain("OUTPUT_HIDDEN_10");
  } finally { await tmux("kill-server");await rm(home,{recursive:true,force:true}); }
},15000);
