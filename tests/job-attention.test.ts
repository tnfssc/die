import { afterEach, expect, test } from "bun:test";
import { TaskManager, type TaskLaunch } from "../src/tasks/task-manager";
import { JobAttentionScheduler, MAX_SNOOZE_MINUTES, formatAttentionNotification, type AttentionClock, type AttentionNotice } from "../src/tasks/job-attention";
import { JobService } from "../src/tasks/job-service";

class FakeClock implements AttentionClock {
  nowMs = Date.now(); next = 1;
  timers = new Map<number, { at: number; callback: () => void }>();
  now = () => this.nowMs;
  setTimeout(callback: () => void, delayMs: number): unknown { const id=this.next++;this.timers.set(id,{at:this.nowMs+delayMs,callback});return id; }
  clearTimeout(handle: unknown): void { this.timers.delete(handle as number); }
  advance(ms: number): void {
    this.nowMs += ms;
    for (;;) {
      const due=[...this.timers].filter(([,timer])=>timer.at<=this.nowMs).sort((a,b)=>a[1].at-b[1].at)[0];
      if (!due) return;
      this.timers.delete(due[0]); due[1].callback();
    }
  }
}
const managers: TaskManager[]=[];
afterEach(async()=>{await Promise.all(managers.splice(0).map(manager=>manager.shutdown()));});
const launch=(command="idle"):TaskLaunch=>({kind:"command",command:process.execPath,args:["-e","setInterval(()=>{},10000)"],displayCommand:command,cwd:process.cwd()});

 test("one fake-clock scheduler batches 50+ quiet/review deadlines and noisy activity causes no timer storm",async()=>{
  const clock=new FakeClock(), batches:AttentionNotice[][]=[];
  const manager=new TaskManager(()=>{},10);managers.push(manager);
  const scheduler=new JobAttentionScheduler(manager,items=>batches.push(items),{clock});
  const tasks=Array.from({length:55},(_,index)=>manager.spawn(launch("job "+index)));
  expect(scheduler.diagnostics()).toMatchObject({activeJobs:55,timerArmed:true,timerSchedules:1,timerCallbacks:0});
  // Input/output activity is event-driven but must not clear/recreate the one timer.
  for(let index=0;index<100;index++) await manager.write(tasks[index%tasks.length]!.id,"x");
  expect(scheduler.diagnostics().timerSchedules).toBe(1);
  clock.advance(5*60_000);
  expect(batches).toHaveLength(1);expect(batches[0]).toHaveLength(55);
  expect(batches[0]!.every(notice=>notice.reasons.includes("quiet"))).toBe(true);
  expect(scheduler.diagnostics()).toMatchObject({timerCallbacks:1,timerSchedules:2,notices:55});
  clock.advance(5*60_000);
  expect(batches).toHaveLength(2);expect(batches[1]).toHaveLength(55);
  expect(batches[1]!.every(notice=>notice.reasons.includes("review"))).toBe(true);
  // Callback/schedule overhead is O(deadline batches), not output chunks/jobs.
  expect(scheduler.diagnostics()).toMatchObject({timerCallbacks:2,timerSchedules:3});
  scheduler.dispose();expect(clock.timers.size).toBe(0);expect(scheduler.diagnostics().activeJobs).toBe(0);
});

test("snooze defers quiet and review coherently; watch opt-out persists until enabled",()=>{
  const clock=new FakeClock(), batches:AttentionNotice[][]=[];
  const manager=new TaskManager(()=>{},10);managers.push(manager);
  const task=manager.spawn(launch()), scheduler=new JobAttentionScheduler(manager,items=>batches.push(items),{clock});
  scheduler.snooze(task.id,MAX_SNOOZE_MINUTES);
  clock.advance(54*60_000);expect(batches).toHaveLength(0);
  clock.advance(60_000);expect(batches).toHaveLength(1);expect(batches[0]![0]!.reasons).toEqual(["quiet","review"]);
  scheduler.setWatch(task.id,false);clock.advance(60*60_000);expect(batches).toHaveLength(1);expect(scheduler.isWatched(task.id)).toBe(false);
  scheduler.setWatch(task.id,true);clock.advance(5*60_000);expect(batches).toHaveLength(2);
  expect(()=>scheduler.snooze(task.id,55.01)).toThrow("at most 55");scheduler.dispose();
});

test("completion/cancellation clean scheduler state without attention or automatic kills",async()=>{
  const clock=new FakeClock(), notices:AttentionNotice[]=[];
  const manager=new TaskManager(()=>{},10);managers.push(manager);
  const scheduler=new JobAttentionScheduler(manager,batch=>notices.push(...batch),{clock,quietMs:100,reviewMs:200});
  const task=manager.spawn({kind:"command",command:process.execPath,args:["-e",""],displayCommand:"quick",cwd:process.cwd(),closeStdin:true});
  await manager.wait(task.id);expect(scheduler.diagnostics().activeJobs).toBe(0);
  clock.advance(1000);expect(notices).toHaveLength(0);expect(manager.inspect(task.id).status).toBe("completed");
  const running=manager.spawn(launch());scheduler.dispose();clock.advance(1000);
  expect(manager.inspect(running.id).status).toBe("running");
});

test("validated SDK service helpers expose snooze and persistent watch control",async()=>{
  const clock=new FakeClock(), manager=new TaskManager(()=>{},10);managers.push(manager);
  const scheduler=new JobAttentionScheduler(manager,()=>{},{clock}), service=new JobService(manager,()=>({depth:0}),()=>{},undefined,scheduler);
  const task=manager.spawn(launch()), ctx={cwd:process.cwd()} as any, signal=new AbortController().signal;
  expect(await service.handle("jobs.snooze",{id:task.id,minutes:12},ctx,signal)).toMatchObject({id:task.id,watchEnabled:true,snoozedMinutes:12});
  expect(await service.handle("jobs.setWatch",{id:task.id,enabled:false},ctx,signal)).toMatchObject({id:task.id,watchEnabled:false});
  await expect(service.handle("jobs.snooze",{id:task.id,minutes:56},ctx,signal)).rejects.toThrow();
  await expect(service.handle("jobs.setWatch",{id:task.id,enabled:"no"},ctx,signal)).rejects.toThrow();
  scheduler.dispose();
});

test("TaskManager pending/event contracts are snapshot-based and attention text is bounded evidence",async()=>{
  const manager=new TaskManager(()=>{},10);managers.push(manager);const events:string[]=[];const unsubscribe=manager.subscribe(event=>events.push(event.type));
  const task=manager.spawn(launch("contract"));expect(manager.pending().map(item=>item.id)).toEqual([task.id]);
  await manager.write(task.id,"evidence");expect(events).toContain("activity");
  manager.kill(task.id);await manager.wait(task.id);expect(manager.pending()).toHaveLength(0);expect(events).toContain("completed");
  unsubscribe();
  const sample={id:task.id,reasons:["review" as const],observedAt:new Date().toISOString(),elapsedMs:600000,quietForMs:0,outputBytes:1_000_000,stdinOpen:false,task:manager.inspect(task.id)};
  const text=formatAttentionNotification(Array.from({length:100},()=>sample));
  expect(text.length).toBeLessThanOrEqual(5000);expect(text).toContain("Jobs continue running");expect(text).not.toMatch(/kill(ed)? automatically/i);
});
