#!/usr/bin/env node
// Current pinned source probe. Copies/instruments source in an owned temporary directory only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tree = path.join(root, ".cache/die-t3code-v0042");
const pin = JSON.parse(fs.readFileSync(path.join(root, "web/t3-source.json"))).revision;
function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) throw Error(r.stderr || r.stdout || String(r.error));
  return r.stdout;
}
const head = run("git", ["-C", tree, "rev-parse", "HEAD"]).trim();
if (head !== pin || pin !== "719a76ca1dbf5490f1aa33ffb9966301e02be9a9") throw Error("Wrong source revision");
run("git", ["-C", tree, "apply", "--reverse", "--check", path.join(root, "web/t3.patch")]);
console.log("Verified pin and canonical reverse patch:", head);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "die-current-provider-audit-"));
const dir = path.join(tree, "apps/server/src/provider/Layers");
const absoluteImports = (s) =>
  s.replace(/(from\s+["'])(\.[^"']+)(["'])/g, (_, a, b, c) => a + path.resolve(dir, b) + c);
try {
  fs.symlinkSync(path.join(tree, "apps/server/node_modules"), path.join(tmp, "node_modules"), "dir");
  let source = absoluteImports(fs.readFileSync(path.join(dir, "PiAdapter.ts"), "utf8"));
  const marker = "  const events = yield* Queue.unbounded<ProviderRuntimeEvent>();";
  if (!source.includes(marker)) throw Error("Instrumentation anchor changed");
  source = source.replace(
    marker,
    "  globalThis.__auditPi = () => SynchronizedRef.get(threadLocks).pipe(Effect.map(locks => ({locks:locks.size,sessions:sessions.size,leases:sessionFileLeases.size})));\n" +
      marker,
  );
  source = source.replace(
    marker,
    "  globalThis.__auditPiSessions = () => Array.from(sessions.values()).map(ctx => ({extensionTasks:ctx.extensionSubagentTasks.size,workflowTasks:ctx.workflowTasks.size,dieTasks:ctx.dieTasksById.size}));\n" +
      marker,
  );
  fs.writeFileSync(path.join(tmp, "PiAdapter.ts"), source);
  let harness = absoluteImports(
    fs.readFileSync(path.join(dir, "PiAdapter.test.ts"), "utf8").split('describe("PiAdapter", () => {')[0],
  );
  harness = harness.replace(path.join(dir, "PiAdapter.ts"), path.join(tmp, "PiAdapter.ts"));
  harness +=
    'it.effect("audit: rejected Pi starts retain unique thread locks after stopAll", () => { const h=makeHarness(); return withAdapter(h, adapter => Effect.gen(function*(){ const samples=[]; for(let batch=0;batch<3;batch++){ for(let i=0;i<100;i++){ const id=ThreadId.make("audit-"+(batch*100+i)); const result=yield* adapter.startSession({threadId:id,runtimeMode:"approval-required"}).pipe(Effect.result); assert.equal(result._tag,"Failure"); yield* adapter.stopSession(id); } yield* adapter.stopAll(); samples.push(yield* globalThis.__auditPi()); } assert.equal(h.spawns.length,0); assert.deepEqual(samples,[{locks:100,sessions:0,leases:0},{locks:200,sessions:0,leases:0},{locks:300,sessions:0,leases:0}]); fs.writeFileSync(process.env.DIE_AUDIT_RESULT!, JSON.stringify(samples)); })).pipe(Effect.ensuring(Effect.sync(()=>{delete globalThis.__auditPi;fs.rmSync(h.stateDir,{recursive:true,force:true});}))); });';
  harness += `it.effect("audit: normal Pi session churn releases sessions and leases but not locks", () => { const h=makeHarness(); return withAdapter(h,adapter=>Effect.gen(function*(){ const drain=yield* adapter.streamEvents.pipe(Stream.runDrain,Effect.forkChild); for(let i=0;i<100;i++){yield* start(adapter,"normal-"+i);yield* adapter.stopSession(ThreadId.make("normal-"+i));} const state=yield* globalThis.__auditPi();assert.deepEqual(state,{locks:100,sessions:0,leases:0});assert.equal(h.client.calls.close,100);fs.appendFileSync(process.env.DIE_AUDIT_RESULT!,"\\nNORMAL_CHURN "+JSON.stringify(state));})).pipe(Effect.ensuring(Effect.sync(()=>{delete globalThis.__auditPi;delete globalThis.__auditPiSessions;fs.rmSync(h.stateDir,{recursive:true,force:true});})));});
 it.effect("audit: completed extension tasks retain session-lifetime records",()=>{const h=makeHarness();return withAdapter(h,adapter=>Effect.gen(function*(){yield* start(adapter);const samples=[];for(let batch=0;batch<3;batch++){const stream=yield* collectThroughSentinel(adapter); const turn=yield* adapter.sendTurn({threadId:ThreadId.make("thread"),input:"fake tasks",modelSelection});stream.setSentinel(turn.turnId);for(let i=0;i<100;i++){yield* Queue.offer(h.client.input,{type:"tool_execution_end",toolCallId:"task-"+(batch*100+i),toolName:"subagent",result:{content:[{type:"text",text:"done"}],details:{results:[{agent:"scout",task:"x".repeat(1000),exitCode:0,messages:[],usage:{}}]}},isError:false});}yield* Queue.offer(h.client.input,{type:"agent_settled"});yield* Fiber.join(stream.collected);samples.push(globalThis.__auditPiSessions()[0]);}assert.deepEqual(samples.map(s=>s.extensionTasks),[100,200,300]);fs.appendFileSync(process.env.DIE_AUDIT_RESULT!,"\\nCOMPLETED_EXTENSION_TASKS "+JSON.stringify(samples));yield* adapter.stopAll();assert.deepEqual(globalThis.__auditPiSessions(),[]);})).pipe(Effect.ensuring(Effect.sync(()=>{delete globalThis.__auditPi;delete globalThis.__auditPiSessions;fs.rmSync(h.stateDir,{recursive:true,force:true});})));});`;
  let loggerSource = absoluteImports(fs.readFileSync(path.join(dir, "EventNdjsonLogger.ts"), "utf8"));
  loggerSource = loggerSource.replace(
    "  const timerScope = yield* Scope.make();",
    "  globalThis.__auditLogger = () => SynchronizedRef.get(stateRef).pipe(Effect.map(state => ({sinks:state.sinks.size,pending:state.pending.length})));\n  const timerScope = yield* Scope.make();",
  );
  fs.writeFileSync(path.join(tmp, "EventNdjsonLogger.ts"), loggerSource);
  harness += `import {makeEventNdjsonLogStore} from "./EventNdjsonLogger.ts";
 it.effect("audit: logger retains all thread sinks and exempts their files from retention",()=>Effect.gen(function*(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"die-log-audit-"));const store=yield* makeEventNdjsonLogStore(path.join(dir,"events.ndjson"),{batchWindowMs:0,retentionCheckIntervalMs:1,maxTotalBytes:1024});try{const logger=store.logger("canonical");for(let i=0;i<100;i++){yield* TestClock.adjust("2 millis");yield* logger.write({type:"turn.completed",id:"e-"+i,payload:"x".repeat(1024)},ThreadId.make("log-thread-"+i));}const state=yield* globalThis.__auditLogger();const files=fs.readdirSync(dir);const bytes=files.reduce((n,f)=>n+fs.statSync(path.join(dir,f)).size,0);assert.deepEqual(state,{sinks:100,pending:0});assert.equal(files.length,100);assert.ok(bytes>100000);fs.appendFileSync(process.env.DIE_AUDIT_RESULT!,"\\nLOGGER_SINK_RETENTION "+JSON.stringify({...state,files:files.length,bytes,configuredTotalBytes:1024}));}finally{yield* store.close();delete globalThis.__auditLogger;fs.rmSync(dir,{recursive:true,force:true});}}));`;
  fs.writeFileSync(path.join(tmp, "probe.test.ts"), harness);
  fs.writeFileSync(
    path.join(tmp, "vite.config.ts"),
    'export default {test:{include:["probe.test.ts"],fileParallelism:false,testTimeout:30000}};',
  );
  const result = spawnSync(
    path.join(tree, "node_modules/.pnpm/node_modules/.bin/vitest"),
    ["run", "--config", path.join(tmp, "vite.config.ts"), "--root", tmp],
    { cwd: tmp, encoding: "utf8", env: { ...process.env, DIE_AUDIT_RESULT: path.join(tmp, "result.json") } },
  );
  if (fs.existsSync(path.join(tmp, "result.json")))
    console.log("CURRENT_PI_LOCK_RETENTION", fs.readFileSync(path.join(tmp, "result.json"), "utf8"));
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
