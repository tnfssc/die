import { test, expect, spyOn } from "bun:test";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import * as execution from "../src/typescript/execution";
import { TaskManager } from "../src/tasks/task-manager";
import { executeOutputPreview } from "../src/ui/execution-previews";
import { registerExecuteTool } from "../src/typescript/extension";

for (const mode of ["inline", "background", "error"] as const) test("execute handoff notice: " + mode, async () => {
  let tool!: ToolDefinition;
  const mock = spyOn(execution, "executeIsolated").mockImplementation(async (_code, _cwd, _signal, _timeout, options) => {
    await options!.jobHandler!("subagent", {}, new AbortController().signal);
    return { exitCode: mode === "error" ? 1 : 0, stdout: "", stderr: mode === "error" ? "code failed after launch" : "", stdoutLost: false, stderrLost: false, timedOut: false, cancelled: false, images: [] };
  });
  try {
    registerExecuteTool({ registerTool(value: ToolDefinition) { tool = value; }, on() {} } as unknown as ExtensionAPI,
      async () => [{ id: "background-one", background: mode !== "inline" }, { id: "inline-two", background: false }]);
    const pending = tool.execute("test", { code: "" }, undefined, undefined, { cwd: process.cwd() } as ExtensionContext);
    if (mode === "error") {
      await expect(pending).rejects.toThrow("Background handoff: background-one");
    } else {
      const result = await pending;
      const text = result.content.filter(part => part.type === "text").map(part => part.text).join("\n");
      if (mode === "background") {
        expect(text).toContain("Background handoff: background-one");
        expect(text).toContain("ending your turn");
        expect(text).not.toContain("inline-two");
        expect((result.details as any).stdout).toBe("");
      } else expect(text).not.toContain("Background handoff");
    }
  } finally { mock.mockRestore(); }
});

test("cooperative handoff releases a foreground wait, preserves its job, and notifies once", async () => {
  let tool!: ToolDefinition;
  let id = "";
  let notifications = 0;
  let complete!: () => void;
  const completion = new Promise<void>(resolve => { complete = resolve; });
  const manager = new TaskManager(() => { notifications++; complete(); });
  const mock = spyOn(execution, "executeIsolated").mockImplementation(async (_code, _cwd, _signal, _timeout, options) => {
    const signal = new AbortController().signal;
    const waiting = options!.jobHandler!("shell", {}, signal);
    await options!.jobHandler!("handoff", {message:"Waiting for a dependency"}, signal);
    const launched = await waiting as any;
    expect(launched.background).toBe(true);
    return {exitCode:0, stdout:"", stderr:"", stdoutLost:false, stderrLost:false, timedOut:false, cancelled:false, images:[]};
  });
  try {
    registerExecuteTool({registerTool(value: ToolDefinition) {tool=value;}, on() {}} as unknown as ExtensionAPI,
      async (_ctx, _method, _params, signal) => {
        const task = manager.spawn({kind:"command",command:"/bin/sh",args:["-c","read value; printf survived"],displayCommand:"input gate",cwd:process.cwd()});
        id=task.id;
        return manager.foreground(id, 30000, signal);
      });
    const result = await tool.execute("handoff", {code:""}, undefined, undefined, {cwd:process.cwd()} as ExtensionContext);
    expect(result.terminate).toBe(true);
    expect((result.details as any).handoff).toBe("Waiting for a dependency");
    expect((result.details as any).backgroundJobs).toEqual([id]);
    expect(manager.inspect(id).status).toBe("running");
    expect(notifications).toBe(0);
    const preview=executeOutputPreview(result, false, false, {fg: (_:unknown, text:string)=>text} as any).render(80).join("\n");
    expect(preview).toContain("Waiting for a dependency");
    await manager.write(id,"go\n",true);
    await completion;
    expect(manager.inspect(id).output).toBe("survived");
    expect(notifications).toBe(1);
  } finally {mock.mockRestore(); await manager.shutdown();}
});

for (const message of [42, "", "   ", "x".repeat(2001)]) test("handoff validates progress text: "+String(message).slice(0,10), async () => {
  let accepted=false;
  let tool!: ToolDefinition;
  const mock=spyOn(execution,"executeIsolated").mockImplementation(async (_c,_w,_s,_t,options) => {
    await options!.jobHandler!("handoff",{message},new AbortController().signal);
    accepted=true;
    throw new Error("unexpected acceptance");
  });
  try {
    registerExecuteTool({registerTool(value:ToolDefinition){tool=value;},on(){}} as unknown as ExtensionAPI);
    await expect(tool.execute("bad",{code:""},undefined,undefined,{cwd:process.cwd()} as ExtensionContext)).rejects.toThrow();
    expect(accepted).toBe(false);
  } finally {mock.mockRestore();}
});
