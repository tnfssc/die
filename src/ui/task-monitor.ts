import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type Focusable, type KeybindingsManager } from "@earendil-works/pi-tui";
import type { TaskManager, TaskSummary } from "../tasks/task-manager";

const OUTPUT_BYTES = 2400;
const OUTPUT_LINES = 12;
const RENDER_INTERVAL_MS = 100;

function age(ms: number): string {
  const seconds=Math.max(0,Math.floor(ms/1000));
  if (seconds<60) return seconds+"s";
  const minutes=Math.floor(seconds/60);
  return minutes<60 ? minutes+"m "+seconds%60+"s" : Math.floor(minutes/60)+"h "+minutes%60+"m";
}
function cleanOutput(value: string): string[] {
  const lines=value.replace(/\r/g,"").replace(/[^\n\t\x20-\x7e\x80-\uffff]/g,"\uFFFD").split("\n");
  if (lines.at(-1)==="") lines.pop();
  return lines.slice(-OUTPUT_LINES);
}

/** Focused, read-only phase-one job monitor. It never consumes task completion. */
export class TaskMonitorPanel implements Component, Focusable {
  private selected=0;
  private confirming=false;
  private disposed=false;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private clock?: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  private hasFocus=false;
  get focused(){ return this.hasFocus; }
  set focused(value:boolean){ this.hasFocus=value; }

  constructor(private manager:TaskManager, private theme:Theme, private keys:KeybindingsManager,
    private done:()=>void, private changed:()=>void) {
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
  private move(delta:number){
    const tasks=this.running();
    if(!tasks.length){this.selected=0;return;}
    this.selected=(this.selected+delta+tasks.length)%tasks.length;
    this.confirming=false;
  }
  handleInput(data:string){
    const cancel=data==="\x1b" || this.keys.matches(data,"tui.select.cancel");
    const confirm=data==="\r" || this.keys.matches(data,"tui.select.confirm");
    if(this.confirming){
      if(cancel || data.toLowerCase()==="n"){this.confirming=false;this.changed();return;}
      if(confirm || data.toLowerCase()==="y"){
        const task=this.running()[this.selected];
        if(task) this.manager.kill(task.id);
        this.confirming=false;this.changed();return;
      }
      return;
    }
    if(cancel){this.done();return;}
    if(data==="\x1b[A" || data==="k" || this.keys.matches(data,"tui.select.up")){this.move(-1);this.changed();return;}
    if(data==="\x1b[B" || data==="j" || this.keys.matches(data,"tui.select.down")){this.move(1);this.changed();return;}
    if(data.toLowerCase()==="s" || data.toLowerCase()==="x"){
      if(this.running()[this.selected]){this.confirming=true;this.changed();}
    }
  }
  render(width:number):string[]{
    if(width<1)return[];
    const tasks=this.running();
    this.selected=Math.max(0,Math.min(this.selected,tasks.length-1));
    const lines:string[]=[this.theme.fg("accent","─".repeat(width)),this.theme.bold("Running jobs")];
    if(!tasks.length){
      lines.push("",this.theme.fg("muted",this.manager.list().length ? "No jobs are running." : "No jobs have been started in this session."),"",this.theme.fg("dim","Esc close"),this.theme.fg("accent","─".repeat(width)));
      return lines.map(line=>truncateToWidth(line,width));
    }
    lines.push("");
    for(let i=0;i<tasks.length;i++){
      const task=tasks[i], selected=i===this.selected;
      const role=task.agent ? task.agent.type : task.kind;
      const label=
        (selected?"› ":"  ")+this.theme.fg(selected?"accent":"muted",task.id)+" "+
        this.theme.fg(task.agent?.type==="orchestrator"?"warning":task.agent?"accent":"dim","["+role+"]")+" "+
        task.command+"  "+this.theme.fg("dim",age(Date.now()-Date.parse(task.startedAt)));
      lines.push(selected?this.theme.bold(label):label);
    }
    const task=tasks[this.selected];
    lines.push("",this.theme.fg("muted","Live output · last "+OUTPUT_BYTES+" bytes / "+OUTPUT_LINES+" lines"));
    const inspection=this.manager.inspect(task.id,Math.max(task.baseOffset,task.outputEnd-OUTPUT_BYTES),OUTPUT_BYTES);
    const outputLines=cleanOutput(inspection.output);
    if(task.outputEnd===0) lines.push(this.theme.fg("dim","No output received yet."));
    else if(!outputLines.some(line=>line.trim())) lines.push(this.theme.fg("dim","Output received, but it is whitespace only."));
    else lines.push(...outputLines.map(line=>"  "+line));
    if(task.agent?.lastActivityAt){
      const quiet=Date.now()-Date.parse(task.agent.lastActivityAt);
      lines.push(this.theme.fg("dim","Agent quiet for "+age(quiet)+" · "+(task.agent.phase??"running")+(task.agent.events!==undefined?" · "+task.agent.events+" events":"")));
    }
    lines.push("",this.confirming?this.theme.fg("error","Stop "+task.id+"? Enter/y confirm · Esc/n cancel"):this.theme.fg("dim","↑↓/j/k select · s/x stop · Esc close"),this.theme.fg("accent","─".repeat(width)));
    return lines.map(line=>truncateToWidth(line,width));
  }
  invalidate(){}
  dispose(){
    if(this.disposed)return;this.disposed=true;this.unsubscribe();
    if(this.renderTimer)clearTimeout(this.renderTimer);
    if(this.clock)clearInterval(this.clock);
  }
}
