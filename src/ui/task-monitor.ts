import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, type Component, type Focusable, type KeybindingsManager } from "@earendil-works/pi-tui";
import type { TaskManager, TaskSummary } from "../tasks/task-manager";

const OUTPUT_BYTES = 2400;
const OUTPUT_LINES = 12;
const COMMAND_CHARS = 300;
const RENDER_INTERVAL_MS = 100;

function age(ms: number): string {
  const seconds=Math.max(0,Math.floor(ms/1000));
  if (seconds<60) return seconds+"s";
  const minutes=Math.floor(seconds/60);
  return minutes<60 ? minutes+"m "+seconds%60+"s" : Math.floor(minutes/60)+"h "+minutes%60+"m";
}
function cleanTerminalText(value:string, preserveNewlines=false):string {
  const stripped=stripTerminalSequences(value);
  const controls=preserveNewlines ? /[\x00-\x09\x0b-\x1f\x7f-\x9f]/g : /[\x00-\x1f\x7f-\x9f]/g;
  return stripped.replace(controls,"�");
}
function cleanCommand(value:string):string { return cleanTerminalText(value).slice(0,COMMAND_CHARS); }
function cleanOutput(value: string): string[] {
  const lines=cleanTerminalText(value,true).replace(/\r/g,"").split("\n");
  if (lines.at(-1)==="") lines.pop();
  return lines.slice(-OUTPUT_LINES);
}

/** Focused, read-only phase-one job monitor. It never consumes task completion. */
export class TaskMonitorPanel implements Component, Focusable {
  private selected=0;
  private selectedId?:string;
  private confirming?:{id:string;identity:string};
  private disposed=false;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private clock?: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  private hasFocus=false;
  get focused(){ return this.hasFocus; }
  set focused(value:boolean){ this.hasFocus=value; }

  constructor(private manager:TaskManager, private theme:Theme, private keys:KeybindingsManager,
    private done:()=>void, private changed:()=>void, private maxRows:()=>number=()=>process.stdout.rows||24) {
    this.unsubscribe=manager.subscribe(()=>this.scheduleRender());
    this.clock=setInterval(()=>this.scheduleRender(),1000);
    this.clock.unref?.();
  }
  private running():TaskSummary[]{ return this.manager.list().filter(task=>task.status==="running"); }
  private scheduleRender(){
    if(this.disposed || this.renderTimer) return;
    this.renderTimer=setTimeout(()=>{this.renderTimer=undefined;if(!this.disposed)this.changed();},RENDER_INTERVAL_MS);
    this.renderTimer.unref?.();
  }
  private syncSelection(tasks:TaskSummary[]):void {
    const preserved=this.selectedId && tasks.findIndex(task=>task.id===this.selectedId);
    if(typeof preserved==="number" && preserved>=0)this.selected=preserved;
    else this.selected=Math.max(0,Math.min(this.selected,tasks.length-1));
    this.selectedId=tasks[this.selected]?.id;
  }
  private move(delta:number){
    const tasks=this.running();
    this.syncSelection(tasks);
    if(!tasks.length){this.selected=0;this.selectedId=undefined;return;}
    this.selected=(this.selected+delta+tasks.length)%tasks.length;
    this.selectedId=tasks[this.selected]!.id;
    this.confirming=undefined;
  }
  handleInput(data:string){
    const cancel=data==="\x1b" || this.keys.matches(data,"tui.select.cancel");
    const confirm=data==="\r" || this.keys.matches(data,"tui.select.confirm");
    if(this.confirming){
      if(cancel || data.toLowerCase()==="n"){this.confirming=undefined;this.changed();return;}
      if(confirm || data.toLowerCase()==="y"){
        const target=this.confirming;
        const task=this.manager.list().find(task=>task.id===target.id && task.status==="running");
        if(task) this.manager.kill(target.id);
        this.confirming=undefined;this.changed();return;
      }
      return;
    }
    if(cancel){this.done();return;}
    if(data==="\x1b[A" || data==="k" || this.keys.matches(data,"tui.select.up")){this.move(-1);this.changed();return;}
    if(data==="\x1b[B" || data==="j" || this.keys.matches(data,"tui.select.down")){this.move(1);this.changed();return;}
    if(data.toLowerCase()==="s" || data.toLowerCase()==="x"){
      const tasks=this.running();this.syncSelection(tasks);const task=tasks[this.selected];
      if(task){this.confirming={id:task.id,identity:cleanCommand(task.command)};this.changed();}
    }
  }
  render(width:number):string[]{
    if(width<1)return[];
    const tasks=this.running();
    this.syncSelection(tasks);
    const lines:string[]=[this.theme.fg("accent","─".repeat(width)),this.theme.bold("Running jobs")];
    if(!tasks.length){
      lines.push("",this.theme.fg("muted",this.manager.list().length ? "No jobs are running." : "No jobs have been started in this session."),"",this.theme.fg("dim","Esc close"),this.theme.fg("accent","─".repeat(width)));
      return lines.map(line=>truncateToWidth(line,width));
    }
    lines.push("");
    const hasActivity=!!tasks[this.selected]?.agent?.lastActivityAt;
    const height=Math.max(10,this.maxRows());
    const fixedRows=8+(hasActivity?1:0);
    const available=Math.max(2,height-fixedRows);
    const previewRows=Math.min(OUTPUT_LINES,Math.max(1,Math.floor(available/2)));
    const taskRows=Math.max(1,available-previewRows);
    const pageStart=Math.max(0,Math.min(this.selected-Math.floor(taskRows/2),tasks.length-taskRows));
    const pageEnd=Math.min(tasks.length,pageStart+taskRows);
    for(let i=pageStart;i<pageEnd;i++){
      const task=tasks[i], selected=i===this.selected;
      const role=task.agent ? task.agent.type : task.kind;
      const label=
        (selected?"› ":"  ")+this.theme.fg(selected?"accent":"muted",task.id)+" "+
        this.theme.fg(task.agent?.type==="orchestrator"?"warning":task.agent?"accent":"dim","["+role+"]")+" "+
        cleanCommand(task.command)+"  "+this.theme.fg("dim",age(Date.now()-Date.parse(task.startedAt)));
      lines.push(selected?this.theme.bold(label):label);
    }
    const task=tasks[this.selected];
    lines.push("",this.theme.fg("muted","Live output · last "+OUTPUT_BYTES+" bytes / "+OUTPUT_LINES+" lines"));
    const inspection=this.manager.inspect(task.id,Math.max(task.baseOffset,task.outputEnd-OUTPUT_BYTES),OUTPUT_BYTES);
    const outputLines=cleanOutput(inspection.output).slice(-previewRows);
    if(task.outputEnd===0) lines.push(this.theme.fg("dim","No output received yet."));
    else if(!outputLines.some(line=>line.trim())) lines.push(this.theme.fg("dim","Output received, but it is whitespace only."));
    else lines.push(...outputLines.map(line=>"  "+line));
    if(task.agent?.lastActivityAt){
      const quiet=Date.now()-Date.parse(task.agent.lastActivityAt);
      lines.push(this.theme.fg("dim","Agent quiet for "+age(quiet)+" · "+(task.agent.phase??"running")+(task.agent.events!==undefined?" · "+task.agent.events+" events":"")));
    }
    lines.push("",this.confirming?this.theme.fg("error","Stop "+this.confirming.id+" ("+this.confirming.identity+")? Enter/y confirm · Esc/n cancel"):this.theme.fg("dim","↑↓/j/k select · s/x stop · Esc close"),this.theme.fg("accent","─".repeat(width)));
    return lines.map(line=>truncateToWidth(line,width));
  }
  invalidate(){}
  dispose(){
    if(this.disposed)return;this.disposed=true;this.unsubscribe();
    if(this.renderTimer)clearTimeout(this.renderTimer);
    if(this.clock)clearInterval(this.clock);
  }
}
