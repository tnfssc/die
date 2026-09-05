import { test, expect } from "bun:test";
import { AgentProgress, type AgentInfo } from "../src/tasks/agent-progress";
const info = (): AgentInfo => ({type:"normal",model:"p/model",depth:1,sessionFile:"/session.jsonl"});
const line = (event: unknown) => Buffer.from(JSON.stringify(event) + "\n");
test("fragmented UTF-8 events expose tools/output without reasoning or images", () => {
  const metadata=info(); let output="";
  const progress=new AgentProgress(metadata, value=>output+=value);
  const events = Buffer.concat([
    line({type:"tool_execution_start", toolName:"execute",args:{code:"console.log('😀')"}}),
    line({type:"message_update",assistantMessageEvent:{type:"thinking_delta",delta:"PRIVATE"}}),
    line({type:"tool_execution_end",toolName:"execute",result:{content:[{type:"text",text:"found 😀"},{type:"image",data:"IMAGE"}]}}),
    line({type:"message_end",message:{role:"assistant",stopReason:"stop",content:[{type:"text",text:"done"}]}}),
  ]);
  for (let i=0;i<events.length;i++) progress.push(events.subarray(i,i+1));
  progress.finish();
  expect(metadata.events).toBe(4);
  expect(metadata.lastActivityAt).toBeDefined();
  expect(metadata.currentTool).toBeUndefined();
  expect(output).toContain("found 😀");
  expect(output).toContain("console.log");
  expect(output).not.toContain("PRIVATE");
  expect(output).not.toContain("IMAGE");
  expect(progress.final.read(0,5000).buffer.toString()).toBe("done");
});
test("oversized records are discarded and framing recovers", () => {
  let output=""; const progress=new AgentProgress(info(),value=>output+=value);
  progress.push(Buffer.from('x'.repeat(1_100_000)));
  progress.push(Buffer.concat([Buffer.from("\n"),line({type:"agent_start"})]));
  progress.finish();
  expect(output.length).toBeLessThan(300);
  expect(output).toContain("Oversized event");
  expect(progress.info.phase).toBe("waiting for model");
});
test("model failures and retry recovery are observable", () => {
  const progress=new AgentProgress(info(),()=>{});
  progress.push(line({type:"message_end",message:{role:"assistant",stopReason:"error",errorMessage:"rate limited"}}));
  expect(progress.failed).toBe(true);
  expect(progress.info.lastError).toBe("rate limited");
  progress.push(line({type:"auto_retry_start",errorMessage:"retrying"}));
  expect(progress.info.phase).toBe("auto_retry_start");
  progress.push(line({type:"message_end",message:{role:"assistant",stopReason:"stop",content:[{type:"text",text:"recovered"}]}}));
  expect(progress.failed).toBe(false);
});
test("incomplete last JSON line is flushed and malformed output remains inspectable", () => {
  let output="";const progress=new AgentProgress(info(),v=>output+=v);
  progress.push(Buffer.from("startup warning\n" + JSON.stringify({type:"agent_start"})));
  progress.finish();
  expect(output).toContain("startup warning");
  expect(progress.info.events).toBe(1);
});

test("cooperative handoff exposes pending ownership and its progress text", () => {
  const metadata=info();
  const progress=new AgentProgress(metadata,()=>{});
  progress.push(line({type:"tool_execution_end",toolName:"execute",isError:false,result:{content:[{type:"text",text:"Execution handed off."}],details:{handoff:"Waiting for owned background work"}}}));
  expect(metadata.phase).toBe("waiting for background work");
  expect(progress.final.read(0,5000).buffer.toString()).toBe("Waiting for owned background work");
});

test("final assistant text ends receiving status without claiming process completion", () => {
  const progress = new AgentProgress(info(), () => {});
  progress.push(line({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } }));
  expect(progress.info.phase).toBe("receiving model response");
  progress.push(line({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] } }));
  expect(progress.info.phase).toBe("assistant turn finished");
  progress.push(line({ type: "agent_end" }));
  expect(progress.info.phase).toBe("agent ended");
});
