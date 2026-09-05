import {describe,expect,test} from "bun:test";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import type {ExtensionAPI,ExtensionContext} from "@earendil-works/pi-coding-agent";
import {CACHE_CALL_ENTRY,CacheCountdown,DEFAULT_CACHE_TTL_MS,loadCacheSettings,parseCacheSettings,parseCacheTtl,registerCacheCountdown} from "../src/tasks/cache-countdown";

function context(provider="openai",id="alpha",entries:any[]=[]){return {model:{provider,id},sessionManager:{getEntries:()=>entries},ui:{notify(){}}} as unknown as ExtensionContext;}

describe("cache countdown",()=>{
 test("is per-agent/model, coarse, warning-colored state, expired, and unknown",()=>{
  let now=1_000_000;
  const a=new CacheCountdown(()=>now), b=new CacheCountdown(()=>now);
  const ctx=context();
  expect(a.estimate(ctx)).toEqual({state:"unknown",text:"cache est ?"});
  a.record({appendEntry(){}} as unknown as ExtensionAPI,ctx);
  expect(a.estimate(ctx)).toMatchObject({state:"active",text:"cache est 60m"});
  now+=45*60_000;
  expect(a.estimate(ctx)).toMatchObject({state:"warning",text:"cache est 15m"});
  now+=10*60_000;
  expect(a.estimate(ctx)).toMatchObject({state:"urgent",text:"cache est 5m"});
  now+=5*60_000;
  expect(a.estimate(ctx)).toEqual({state:"expired",text:"cache est expired"});
  expect(b.estimate(ctx).state).toBe("unknown");
  expect(a.estimate(context("openai","beta")).state).toBe("unknown");
 });
 test("restores durable exact-model calls without allowing descendant resets",()=>{
  const parent=new CacheCountdown(()=>9000);
  const entries=[{type:"custom",customType:CACHE_CALL_ENTRY,data:{timestamp:1000,provider:"p",model:"m"}}];
  parent.restore(context("p","m",entries));
  const child=new CacheCountdown(()=>9000);
  child.record({appendEntry(){}} as unknown as ExtensionAPI,context("p","m"),8000);
  expect(parent.estimate(context("p","m"),9000).text).toBe("cache est 60m");
  expect(child.estimate(context("p","m"),9000).text).toBe("cache est 60m");
  expect(parent.estimate(context("p","other"),9000).state).toBe("unknown");
 });
 test("validates durations and strict persisted settings",()=>{
  expect(parseCacheTtl("30m")).toBe(1_800_000); expect(parseCacheTtl("1h")).toBe(DEFAULT_CACHE_TTL_MS);
  expect(parseCacheTtl("1.5h")).toBe(5_400_000); expect(parseCacheTtl("2")).toBe(120_000);
  for(const bad of ["", "zero", "0m", "8d", "1.001m"]) expect(()=>parseCacheTtl(bad)).toThrow();
  expect(()=>parseCacheSettings({cacheTtlMs:60000,extra:true})).toThrow("unknown setting");
 });
 test("public command persists and provider-request seam records each attempt",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"die-cache-")); const path=join(dir,"settings.json");
  try {
   const handlers=new Map<string,Function>(); let command:any, note="", kind="", appended:any[]=[];
   const pi={on:(name:string,fn:Function)=>handlers.set(name,fn),registerCommand:(name:string,value:any)=>{expect(name).toBe("cache-ttl");command=value;},appendEntry:(type:string,data:any)=>appended.push({type,data})} as unknown as ExtensionAPI;
   const cache=new CacheCountdown(()=>123456);
   registerCacheCountdown(pi,cache,path);
   const ctx=context(); (ctx.ui as any).notify=(message:string,k:string)=>{note=message;kind=k;};
   await handlers.get("session_start")!({},ctx);
   await handlers.get("before_provider_headers")!({},ctx);
   await handlers.get("before_provider_headers")!({},ctx); // retry/error attempt
   expect(appended).toHaveLength(2); expect(appended[0].type).toBe(CACHE_CALL_ENTRY);
   await command.handler("90m",ctx); expect(kind).toBe("info"); expect(note).toContain("does not guarantee");
   expect((await loadCacheSettings(path)).ttlMs).toBe(5_400_000);
   await command.handler("nonsense",ctx); expect(kind).toBe("error");
   expect(JSON.parse(await readFile(path,"utf8"))).toEqual({cacheTtlMs:5_400_000});
  } finally {await rm(dir,{recursive:true,force:true});}
 });
});
