import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { expect, describe, it } from "@effect/vitest";
import { CommandId, EnvironmentId, MessageId, ProjectId, ProviderDriverKind, ProviderInstanceId, ThreadId, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { McpProtocol, McpSchema, McpServer } from "effect/unstable/ai";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFileSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { ServerConfig } from "../../config.ts";
import { T3ExecuteBridgeClient } from "../../../../../../../bridge-client.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import * as McpSessionRegistry from "../../mcp/McpSessionRegistry.ts";
import { ScheduledTaskService } from "../../scheduledTasks/ScheduledTaskService.ts";
import { makeProviderRegistryLayer } from "../../provider/testUtils/providerRegistryMock.ts";
import { makePiAdapterV2 } from "../Adapters/PiAdapterV2.ts";
import { IdAllocatorV2, layer as idAllocatorLayer } from "../IdAllocator.ts";
import { OrchestratorV2 } from "../Orchestrator.ts";
import { EventStoreV2, layer as eventStoreLayer } from "../EventStore.ts";
import { makeSqlitePersistenceLive } from "../../persistence/Layers/Sqlite.ts";
import { makeLayer as makeProviderAdapterRegistryLayer } from "../ProviderAdapterRegistry.ts";
import { layer as threadManagementServiceLayer } from "../ThreadManagementService.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "./integratedRealHarness.ts";

const PI = ProviderInstanceId.make("pi-integrated-real");
const PARENT = ThreadId.make("thread:integrated-real-parent");
const PROJECT = ProjectId.make("project:integrated-real");
const selection = { instanceId: PI, model: "loopback/integrated-real" };
const marker = "INTEGRATED_REAL_RESULT_7bde9d";

async function body(req: IncomingMessage) { let text = ""; for await (const chunk of req) text += chunk; return JSON.parse(text); }
function sse(res: ServerResponse, values: unknown[]) { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(values.map(v => `data: ${JSON.stringify(v)}\n\n`).join("") + "data: [DONE]\n\n"); }
async function listen(server: ReturnType<typeof createServer>) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return (server.address() as {port:number}).port; }

const providerSnapshot: ServerProvider = {
  instanceId: PI, driver: ProviderDriverKind.make("pi"), enabled: true, installed: true,
  version: "integrated-real", status: "ready", auth: { status: "authenticated" },
  checkedAt: "2026-09-20T00:00:00.000Z",
  models: [{ slug: "loopback/integrated-real", name: "integrated-real", isCustom: true, capabilities: null }],
  slashCommands: [], skills: [],
};
const scheduledLayer = Layer.succeed(ScheduledTaskService, ScheduledTaskService.of({
  list: () => Effect.succeed({ tasks: [] }), subscribeList: () => Stream.empty,
  upsert: () => Effect.die("unused"), setEnabled: () => Effect.die("unused"),
  delete: () => Effect.die("unused"), runNow: () => Effect.die("unused"),
}));
const environmentLayer = Layer.succeed(ServerEnvironment.ServerEnvironment, {
  getEnvironmentId: Effect.succeed(EnvironmentId.make("environment:integrated-real")),
  getDescriptor: Effect.die("unused"),
});

const makeAuth = McpSessionRegistry.McpSessionRegistry.pipe(Effect.map(registry =>
  Effect.fn("integratedRealAuth")(function* (httpEffect: any) {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authorization = request.headers.authorization;
    const raw = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    const invocation = yield* registry.resolve(raw);
    if (!invocation) return HttpServerResponse.jsonUnsafe({ error: "invalid_mcp_credential" }, { status: 401 });
    return yield* httpEffect.pipe(Effect.provideService(McpInvocationContext.McpInvocationContext, invocation));
  })
));
const authLayer = HttpRouter.middleware<{ provides: McpInvocationContext.McpInvocationContext }>()(makeAuth as any).layer;

function waitFor(orchestrator: OrchestratorV2["Service"], threadId: ThreadId, predicate: (p:any)=>boolean) {
  return Effect.gen(function* () {
    for (let n=0;n<2400;n++) { const p=yield* orchestrator.getThreadProjection(threadId); if (predicate(p)) return p; yield* Effect.sleep("10 millis"); }
    const last=yield* orchestrator.getThreadProjection(threadId); console.error("PROJECTION_TIMEOUT",JSON.stringify({runs:last.runs,turns:last.providerTurns,items:last.items?.slice(-5)})); return yield* Effect.die(new Error(`projection timeout: ${threadId}`));
  });
}

describe("integrated real upstream orchestration", () => {
  it.live("uses scoped HTTP MCP through PiAdapterV2 and actual Die with idempotent child spawn and cancel", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => {
        const requests: any[] = [];
        const spawnPids: number[] = [];
        const hanging = new Set<ServerResponse>();
        const model = createServer(async (req, res) => {
          if(req.method==="GET" && req.url==="/cancel-ready") {
            const ready=requests.some(r=>(r.messages??[]).some((m:any)=>m.role==="user" && JSON.stringify(m.content).includes("INTEGRATED_CANCEL_CHILD")));
            res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({ready}));return;
          }
          const payload = await body(req); requests.push(payload);
          const text = JSON.stringify(payload.messages ?? []);
          const userText = JSON.stringify((payload.messages ?? []).filter((m:any) => m.role === "user"));
          const isParent = userText.includes("INTEGRATED_PARENT_START");
          const base = { id: "integrated-real", object: "chat.completion.chunk", created: 1, model: "integrated-real" };
          if (!isParent && userText.includes("INTEGRATED_CANCEL_CHILD")) { res.writeHead(200, { "content-type":"text/event-stream" }); hanging.add(res); req.on("close",()=>hanging.delete(res)); return; }
          if (!isParent && userText.includes("INTEGRATED_SUCCESS_CHILD") && !(payload.messages??[]).some((m:any)=>m.role==="tool" && JSON.stringify(m.content).includes("INTEGRATED_CHILD_TOOL_EVENT"))) return sse(res, [
            {...base,choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id:"child-execute",type:"function",function:{name:"execute",arguments:JSON.stringify({code:'console.log("INTEGRATED_CHILD_TOOL_EVENT")'})}}]},finish_reason:null}]},
            {...base,choices:[{index:0,delta:{},finish_reason:"tool_calls"}]},
          ]);
          if (!isParent && userText.includes("INTEGRATED_SUCCESS_CHILD")) return sse(res, [
            {...base,choices:[{index:0,delta:{role:"assistant",content:marker},finish_reason:null}]},
            {...base,choices:[{index:0,delta:{},finish_reason:"stop"}]},
          ]);
          if (!text.includes("INTEGRATED_PARENT_CONTINUATION")) {
            const bridge = resolve(process.cwd(), "../../bridge-client.ts");
            const code = `import { T3ExecuteBridgeClient } from ${JSON.stringify(bridge)}; const c=T3ExecuteBridgeClient.fromEnvironment(); const input={task:"INTEGRATED_SUCCESS_CHILD",mode:"wait",timeoutMs:15000,clientRequestId:"integrated-stable-success"}; const a=await c.delegateTask(input); const b=await c.delegateTask(input); const taskId=(a.structuredContent as any).taskId; const st=await c.taskStatus(taskId); const pending=await c.delegateTask({task:"INTEGRATED_CANCEL_CHILD",mode:"async",clientRequestId:"integrated-stable-cancel"}); const deadline=Date.now()+10000; while(!(await (await fetch("http://127.0.0.1:${(model.address() as {port:number}).port}/cancel-ready")).json()).ready) { if(Date.now()>deadline) throw new Error("CANCEL_CHILD_DID_NOT_REACH_MODEL"); await new Promise(r=>setTimeout(r,20)); } const cancel=await c.taskCancel((pending.structuredContent as any).taskId); const cancelAgain=await c.taskCancel((pending.structuredContent as any).taskId); if ((a.structuredContent as any).taskId !== (b.structuredContent as any).taskId || (a.structuredContent as any).summary !== (st.structuredContent as any).summary) throw new Error("REPLAY_RESULT_MISMATCH"); console.log("INTEGRATED_PARENT_CONTINUATION"+JSON.stringify({taskId,summary:(a.structuredContent as any).summary,replaySameTask:true,statusSameResult:true,cancelStatus:(cancel.structuredContent as any).status,cancelAgainStatus:(cancelAgain.structuredContent as any).status})); await c.close();`;
            return sse(res, [
              {...base,choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id:"integrated-execute",type:"function",function:{name:"execute",arguments:JSON.stringify({code})}}]},finish_reason:null}]},
              {...base,choices:[{index:0,delta:{},finish_reason:"tool_calls"}]},
            ]);
          }
          return sse(res, [
            {...base,choices:[{index:0,delta:{role:"assistant",content:"INTEGRATED_PARENT_DONE"},finish_reason:null}]},
            {...base,choices:[{index:0,delta:{},finish_reason:"stop"}]},
          ]);
        });
        const port = await listen(model);
        const root = await mkdtemp(resolve(tmpdir(), "t3-integrated-real-"));
        const home=resolve(root,"home"), agent=resolve(root,"agent"); await mkdir(home); await mkdir(agent);
        await writeFile(resolve(agent,"models.json"), JSON.stringify({providers:{loopback:{baseUrl:`http://127.0.0.1:${port}/v1`,api:"openai-completions",apiKey:"fixture-only",models:[{id:"integrated-real",name:"integrated-real",contextWindow:32000,maxTokens:2000}]}}}));
        return { model, requests, spawnPids, hanging, root, home, agent };
      }),
      fixture => Effect.gen(function* () {
        const ids=yield* IdAllocatorV2, config=yield* ServerConfig, fs=yield* FileSystem.FileSystem, spawner=yield* ChildProcessSpawner.ChildProcessSpawner;
        const actualAdapter=makePiAdapterV2({ instanceId:PI, settings:{enabled:true,binaryPath:resolve(process.cwd(),"../../../../dist/die"),launchArgs:`--no-context-files --extension ${resolve(process.cwd(),"../../bridge-activation.ts")}`,customModels:[]}, environment:{...process.env,T3_MCP_URL:"http://127.0.0.1:1/should-not-use",T3_MCP_BEARER_TOKEN:"STALE_FIXTURE_ONLY",HOME:fixture.home,PI_CODING_AGENT_DIR:fixture.agent,DIE_CODING_AGENT_DIR:fixture.agent}, spawner:ChildProcessSpawner.make(command=>spawner.spawn(command).pipe(Effect.tap(child=>Effect.sync(()=>{
          const pid=Number(child.pid); fixture.spawnPids.push(pid);
          if(process.env.T3_INTEGRATED_PIDS) appendFileSync(process.env.T3_INTEGRATED_PIDS,JSON.stringify({pid,start:readFileSync(`/proc/${pid}/stat`,"utf8").split(") ")[1]?.split(" ")[19]})+"\n");
        })))),fileSystem:fs,idAllocator:ids,serverConfig:config });

        const adapterLayer=makeProviderAdapterRegistryLayer([actualAdapter]);
        const registryLayer=McpSessionRegistry.layer;
        const databaseLayer=makeSqlitePersistenceLive(resolve(fixture.root,"state.sqlite"));
        const orchestratorLayer=makeOrchestratorV2ReplayLayerWithRegistry({name:"integrated-real",runtimePolicyOverride:{cwd:process.cwd(),approvalPolicy:"never",sandboxPolicy:{type:"readOnly",access:{type:"fullAccess"},networkAccess:true}}},adapterLayer,{databaseLayer}).pipe(Layer.provide(registryLayer));
        const orchestrationLayer=Layer.mergeAll(orchestratorLayer,threadManagementServiceLayer.pipe(Layer.provide(orchestratorLayer)),eventStoreLayer.pipe(Layer.provide(databaseLayer)));
        const transport=McpServer.layerHttp({name:"T3 integrated real",version:"1",path:"/mcp",protocols:[McpProtocol.v2025_06_18]}).pipe(Layer.provide(authLayer));
        const appLayer=McpHttpServer.OrchestratorToolkitRegistrationLive.pipe(
          Layer.provideMerge(transport), Layer.provideMerge(orchestrationLayer), Layer.provide(adapterLayer),
          Layer.provide(makeProviderRegistryLayer([providerSnapshot])), Layer.provide(scheduledLayer), Layer.provideMerge(registryLayer),
          Layer.provide(environmentLayer), Layer.provide(NodeServices.layer),
        );
        const liveLayer=Layer.merge(appLayer,HttpRouter.serve(appLayer,{disableListenLog:true,disableLogger:true}));
        yield* Effect.gen(function* () {
        const orchestrator=yield* OrchestratorV2;
        yield* orchestrator.dispatch({type:"thread.create",createdBy:"user",creationSource:"web",commandId:CommandId.make("command:integrated:create"),threadId:PARENT,projectId:PROJECT,title:"Integrated real parent",modelSelection:selection,runtimeMode:"full-access",interactionMode:"default",branch:null,worktreePath:process.cwd()});
        yield* orchestrator.dispatch({type:"message.dispatch",createdBy:"user",creationSource:"web",commandId:CommandId.make("command:integrated:start"),threadId:PARENT,messageId:MessageId.make("message:integrated:start"),text:"INTEGRATED_PARENT_START",attachments:[],modelSelection:selection,dispatchMode:{type:"start_immediately"}});
        const parent=yield* waitFor(orchestrator,PARENT,p=>p.runs.some((r:any)=>r.status==="completed") && p.subagents.filter((x:any)=>x.origin==="app_owned").length===2 && p.subagents.filter((x:any)=>x.origin==="app_owned")[0]?.status==="completed" && p.subagents.filter((x:any)=>x.origin==="app_owned")[1]?.status==="interrupted");
        const children=parent.subagents.filter((s:any)=>s.origin==="app_owned");
        expect(children).toHaveLength(2);
        const success=children[0]; const cancelled=children[1];
        expect(success?.status).toBe("completed"); expect(success?.result).toContain(marker);
        expect(cancelled?.status).toBe("interrupted");
        const successRequests=fixture.requests.filter((r:any)=>(r.messages??[]).some((m:any)=>m.role==="user" && JSON.stringify(m.content).includes("INTEGRATED_SUCCESS_CHILD")));
        expect(successRequests).toHaveLength(2);
        const cancelRequests=fixture.requests.filter((r:any)=>(r.messages??[]).some((m:any)=>m.role==="user" && JSON.stringify(m.content).includes("INTEGRATED_CANCEL_CHILD")));
        expect(cancelRequests).toHaveLength(1);
        const parentContinuation=fixture.requests.find((r:any)=>JSON.stringify(r.messages??[]).includes("INTEGRATED_PARENT_CONTINUATION"));
        expect(JSON.stringify(parentContinuation)).toContain(marker);
        expect(JSON.stringify(parentContinuation).split(marker).length-1).toBe(1);
        const endpoint=McpProviderSession.readMcpProviderSession(PARENT)?.endpoint; expect(endpoint).toBeDefined();
        const unauthorized=yield* Effect.promise(()=>fetch(endpoint!,{method:"POST",headers:{"content-type":"application/json","accept":"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:99,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"negative",version:"1"}}})}));
        expect(unauthorized.status).toBe(401);
        const successProjection=yield* orchestrator.getThreadProjection(success.childThreadId); const cancelProjection=yield* orchestrator.getThreadProjection(cancelled.childThreadId);
        expect(successProjection.runs).toHaveLength(1);
        expect(success.completionDelivery.state).toBe("acknowledged");
        expect(cancelled.completionDelivery.state).toBe("disposed");
        const resultTransfers=parent.contextTransfers.filter((t:any)=>t.type==="subagent_result" && t.sourceThreadId===success.childThreadId);
        expect(resultTransfers).toHaveLength(1);
        expect(resultTransfers[0].status).toBe("consumed");
        const parentToolMarkerCount=parent.turnItems.filter((t:any)=>t.type==="dynamic_tool").reduce((n:number,t:any)=>n+(JSON.stringify(t.output).split(marker).length-1),0);
        expect(parentToolMarkerCount).toBe(1);
        expect(parent.messages.filter((m:any)=>m.role==="assistant" && m.text==="INTEGRATED_PARENT_DONE")).toHaveLength(1);
        for(const request of fixture.requests) expect(request.tools.map((t:any)=>t.function.name)).toEqual(["execute"]);
        const registry=yield* McpSessionRegistry.McpSessionRegistry;
        const parentCredential=McpProviderSession.readMcpProviderSession(PARENT)!;
        const childCredential=McpProviderSession.readMcpProviderSession(success.childThreadId)!;
        expect(Boolean(childCredential)).toBe(true);
        expect(parentCredential.authorizationHeader!==childCredential.authorizationHeader).toBe(true);
        const childScope=yield* registry.resolve(childCredential.authorizationHeader.slice(7));
        expect(childScope?.threadId).toBe(success.childThreadId);
        const sibling=ThreadId.make("thread:integrated-sibling");
        yield* orchestrator.dispatch({type:"thread.create",createdBy:"user",creationSource:"web",commandId:CommandId.make("command:integrated:sibling"),threadId:sibling,projectId:PROJECT,title:"Isolated sibling auth probe",modelSelection:selection,runtimeMode:"full-access",interactionMode:"default",branch:null,worktreePath:process.cwd()});
        const siblingCredential=yield* registry.issue({threadId:sibling,providerInstanceId:PI});
        const siblingClient=new T3ExecuteBridgeClient(siblingCredential.config.endpoint,siblingCredential.config.authorizationHeader.slice(7));
        const rejected=yield* Effect.promise(async()=>{
          const results=[];
          for(const method of ["taskStatus","taskCancel"] as const) {
            try { const result=await siblingClient[method](success.id); results.push((result.structuredContent as any)?._tag === "OrchestratorMcpFailure" && (result.structuredContent as any)?.code === "task_not_found"); }
            catch (error) { results.push(/task_not_found|does not belong/.test(String(error))); }
          }
          return results;
        });
        expect(rejected).toEqual([true,true]);
        yield* registry.revokeProviderSession(siblingCredential.config.providerSessionId);
        yield* Effect.promise(async()=>{await expect(siblingClient.taskStatus(success.id)).rejects.toThrow("HTTP 401");});
        // Revoked transport belongs to this test server. Its finalizer removes it.
        yield* Effect.promise(()=>siblingClient.close().catch(()=>undefined));
        
        const store=yield* EventStoreV2;
        const storedEvents=yield* store.read().pipe(Stream.runCollect);
        yield* Effect.promise(()=>writeFile(resolve(process.cwd(), "../integrated-real-result.json"),JSON.stringify({label:"Real PiAdapterV2/Die + upstream MCP/orchestrator + deterministic HTTP model",credentialLifecycle:"production ProviderSessionManager configureMcp=true",projections:{[PARENT]:parent,[success.childThreadId]:successProjection,[cancelled.childThreadId]:cancelProjection},storedEvents},null,2)));
        console.error("INTEGRATED_REAL_EVIDENCE",JSON.stringify({parentThreadId:PARENT,parentRunId:parent.runs[0]?.id,successTaskId:success?.id,successThreadId:success?.childThreadId,successRunId:successProjection.runs[0]?.id,cancelTaskId:cancelled?.id,cancelThreadId:cancelled?.childThreadId,cancelRunId:cancelProjection.runs[0]?.id,providerPids:fixture.spawnPids,successModelRequests:successRequests.length,cancelModelRequests:cancelRequests.length,parentRunStatus:parent.runs[0]?.status,cancelStatus:cancelled.status,successRunCount:successProjection.runs.length,resultTransferCount:resultTransfers.length,parentToolMarkerCount,deliveryState:success.completionDelivery.state,cancelDeliveryState:cancelled.completionDelivery.state,activeTools:["execute"],staleInheritedCredentialIgnored:true,siblingReadRejected:rejected[0],siblingCancelRejected:rejected[1],revokedCredentialStatus:401,clientRequestIds:["integrated-stable-success","integrated-stable-cancel"],unauthorized:unauthorized.status,marker}));
        }).pipe(Effect.provide(liveLayer));
      }).pipe(Effect.scoped,Effect.provide(Layer.mergeAll(NodeServices.layer,idAllocatorLayer,ServerConfig.layerTest(process.cwd(),{prefix:"integrated-real-"}).pipe(Layer.provide(NodeServices.layer)),NodeHttpServer.layerTest,environmentLayer))),
      fixture => Effect.promise(async()=>{ for(const res of fixture.hanging) res.destroy(); fixture.model.closeAllConnections(); fixture.model.close(); for (const pid of fixture.spawnPids) { let alive=false; try {process.kill(pid,0);alive=true;} catch {} expect(alive).toBe(false); } console.error("INTEGRATED_SCOPE_FINALIZED",JSON.stringify({providerPids:fixture.spawnPids,allReaped:true})); await copyFile(resolve(fixture.root,"state.sqlite"),resolve(process.cwd(),"../integrated-real-state.sqlite")); await rm(fixture.root,{recursive:true,force:true}); }),
    ), 45_000);
});
