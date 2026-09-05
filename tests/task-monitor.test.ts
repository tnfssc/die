import {expect,test} from "bun:test";
import {getKeybindings,visibleWidth} from "@earendil-works/pi-tui";
import {TaskManager} from "../src/tasks/task-manager";
import {TaskMonitorPanel} from "../src/ui/task-monitor";
import {registerTaskMonitor} from "../src/tasks/task-monitor";
const theme={fg:(_c:string,t:string)=>t,bold:(t:string)=>t};
const shell=process.platform==="win32"?(process.env.ComSpec??"cmd.exe"):"/bin/sh";
function launch(manager:TaskManager,script:string){return manager.spawn({kind:"command",command:shell,args:process.platform==="win32"?["/c",script]:["-c",script],displayCommand:script,cwd:process.cwd(),notifyOnComplete:false});}

test("monitor selects, shows bounded live output, confirms stop, and cleans resources",async()=>{
  const manager=new TaskManager(()=>{},25);let renders=0,done=false;
  const a=launch(manager,"printf first; sleep 10"),b=launch(manager,"printf second; sleep 10");
  const panel=new TaskMonitorPanel(manager,theme as any,getKeybindings(),()=>done=true,()=>renders++);
  try{
    await Bun.sleep(30);
    expect(panel.render(80).join("\n")).toContain("first");
    panel.handleInput("\x1b[B");expect(panel.render(80).join("\n")).toContain("second");
    panel.handleInput("s");expect(panel.render(80).join("\n")).toContain("Stop "+b.id);
    panel.handleInput("n");expect(manager.list().find(x=>x.id===b.id)?.status).toBe("running");
    panel.handleInput("x");panel.handleInput("y");await manager.wait(b.id);expect(manager.list().find(x=>x.id===b.id)?.status).toBe("killed");
    panel.handleInput("\x1b");expect(done).toBe(true);
    expect(panel.render(22).every(line=>visibleWidth(line)<=22)).toBe(true);
    expect(renders).toBeLessThan(20);
  }finally{panel.dispose();await manager.shutdown();}
  const after=renders;await Bun.sleep(150);expect(renders).toBe(after);
  expect(manager.list().find(x=>x.id===a.id)?.status).toBe("killed");
});

test("empty registry and no-output state are explicit",async()=>{
 const manager=new TaskManager(()=>{},20);const panel=new TaskMonitorPanel(manager,theme as any,getKeybindings(),()=>{},()=>{});
 try{
  expect(panel.render(80).join("\n")).toContain("No jobs have been started");
  launch(manager,"sleep 10");expect(panel.render(80).join("\n")).toContain("No output received yet");
 }finally{panel.dispose();await manager.shutdown();}
 expect(panel.render(80).join("\n")).toContain("No jobs are running");
});

test("/ps uses the supplied shared registry and refuses non-TUI",async()=>{
 let handler:any;const notes:any[]=[];const manager=new TaskManager(()=>{});
 registerTaskMonitor({registerCommand:(name:string,d:any)=>{expect(name).toBe("ps");handler=d.handler;}} as any,()=>manager);
 await handler("",{mode:"print",ui:{notify:(...x:any[])=>notes.push(x)}});expect(notes[0][0]).toContain("interactive");
 await manager.shutdown();
});
