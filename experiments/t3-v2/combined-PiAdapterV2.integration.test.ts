import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, NodeId, ProviderInstanceId, ProviderSessionId, RunAttemptId, RunId, ThreadId, type ModelSelection, type OrchestrationV2AppThread } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFileSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { ServerConfig } from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import { IdAllocatorV2, layer as idAllocatorLayer } from "../IdAllocator.ts";
import { ProviderAdapterV2RuntimePolicy, type ProviderAdapterV2Event } from "../ProviderAdapter.ts";
import { makePiAdapterV2 } from "./PiAdapterV2.ts";

const PI = ProviderInstanceId.make("pi");
const THREAD = ThreadId.make("thread-combined-pi-die");
const SESSION = ProviderSessionId.make("session-combined-pi-die");
const selection: ModelSelection = { instanceId: PI, model: "loopback/combined-fixture" };
const policy = ProviderAdapterV2RuntimePolicy.make({ runtimeMode: "full-access", interactionMode: "default", cwd: null });
const testLayer = Layer.mergeAll(NodeServices.layer, idAllocatorLayer, ServerConfig.layerTest(process.cwd(), { prefix: "combined-pi-die-" }).pipe(Layer.provide(NodeServices.layer)));

async function body(req: IncomingMessage) { let text = ""; for await (const chunk of req) text += chunk; return JSON.parse(text); }
function reply(res: ServerResponse, value: unknown, headers: Record<string,string> = {}) { res.writeHead(200, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(value)); }
function sse(res: ServerResponse, values: unknown[]) { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(values.map(v => `data: ${JSON.stringify(v)}\n\n`).join("") + "data: [DONE]\n\n"); }
async function listen(server: ReturnType<typeof createServer>) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return (server.address() as {port:number}).port; }

const log = (...details: unknown[]) => {
  const line = JSON.stringify({ at: new Date().toISOString(), details }) + "\n";
  if (process.env.T3_COMBINED_EVIDENCE) appendFileSync(process.env.T3_COMBINED_EVIDENCE, line);
};

describe("combined PiAdapterV2 -> Die -> mock MCP", () => {
 for (const launchMode of ["direct", "bridge"] as const) {
  it.live(`executes a real Die prompt and closes its scope (${launchMode})`, () => Effect.acquireUseRelease(
    Effect.promise(async () => {
      const pids: number[] = [];
      log("start", launchMode);
      const mcpCalls: Array<{ method: string; authorized: boolean }> = [];
      const modelRequests: any[] = [];
      const mcp = createServer(async (req, res) => {
        const rpc = await body(req); mcpCalls.push({ method: rpc.method, authorized: req.headers.authorization === "Bearer combined-secret" });
        const headers = { "mcp-session-id": "combined-session" };
        if (rpc.method === "initialize") return reply(res, { jsonrpc:"2.0", id:rpc.id, result:{ protocolVersion:"2025-06-18", capabilities:{}, serverInfo:{name:"combined",version:"1"} } }, headers);
        if (rpc.method === "tools/list") return reply(res, { jsonrpc:"2.0", id:rpc.id, result:{ tools:[{ name:"echo", description:"combined proof", inputSchema:{type:"object",properties:{value:{type:"string"}},required:["value"]} }] } }, headers);
        if (rpc.method === "tools/call") return reply(res, { jsonrpc:"2.0", id:rpc.id, result:{ content:[{type:"text",text:`COMBINED_MCP_PROOF:${rpc.params.arguments.value}`}] } }, headers);
        res.writeHead(400).end();
      });
      const mcpPort = await listen(mcp);
      const model = createServer(async (req, res) => {
        const payload = await body(req); modelRequests.push(payload);
        const base = { id:"combined", object:"chat.completion.chunk", created:1, model:"combined-fixture" };
        if (modelRequests.length === 1) return sse(res, [
          {...base,choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id:"mcp-proof",type:"function",function:{name:"execute",arguments:JSON.stringify({code:`import { T3ExecuteBridgeClient } from ${JSON.stringify(resolve(process.cwd(), "../../bridge-client.ts"))}; console.log(JSON.stringify(await T3ExecuteBridgeClient.fromEnvironment().callTool("echo", {value:"ok"})));`})}}]},finish_reason:null}]},
          {...base,choices:[{index:0,delta:{},finish_reason:"tool_calls"}]},
        ]);
        return sse(res, [{...base,choices:[{index:0,delta:{role:"assistant",content:"combined done"},finish_reason:null}]},{...base,choices:[{index:0,delta:{},finish_reason:"stop"}]}]);
      });
      const modelPort = await listen(model);
      const root = await mkdtemp(resolve(tmpdir(), "combined-pi-die-"));
      const home = resolve(root,"home"), agent = resolve(root,"agent"); await mkdir(home); await mkdir(agent);
      await writeFile(resolve(agent,"models.json"), JSON.stringify({providers:{loopback:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,api:"openai-completions",apiKey:"fixture-only",models:[{id:"combined-fixture",name:"Combined Fixture",contextWindow:32000,maxTokens:1000}]}}}));
      return { pids, mcp, model, mcpPort, mcpCalls, modelRequests, root, home, agent };
    }),
    fixture => Effect.gen(function* () {
      McpProviderSession.setMcpProviderSession({ environmentId:EnvironmentId.make("environment-combined"), threadId:THREAD, providerSessionId:String(SESSION), providerInstanceId:PI, endpoint:`http://127.0.0.1:${fixture.mcpPort}/mcp`, authorizationHeader:"Bearer combined-secret", browserToolsAvailable:false });
      const ids = yield* IdAllocatorV2; const config = yield* ServerConfig; const fs = yield* FileSystem.FileSystem; const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const launcher = resolve(process.cwd(), launchMode === "direct" ? "../../../../dist/die" : "../../bridge-launcher.ts"); const activation = resolve(process.cwd(), "../../bridge-activation.ts");
      const adapter = makePiAdapterV2({ instanceId:PI, settings:{enabled:true,binaryPath:launcher,launchArgs:`--no-context-files --extension ${activation}`,customModels:[]}, environment:{...process.env,DIE_T3_DIE_BIN:resolve(process.cwd(),"../../../../dist/die"),HOME:fixture.home,PI_CODING_AGENT_DIR:fixture.agent,DIE_CODING_AGENT_DIR:fixture.agent}, spawner: ChildProcessSpawner.make(command => spawner.spawn(command).pipe(Effect.tap(child => Effect.sync(() => { fixture.pids.push(Number(child.pid)); log("spawn", {launchMode,pid:Number(child.pid)}); if (process.env.T3_COMBINED_PIDS) appendFileSync(process.env.T3_COMBINED_PIDS, JSON.stringify({pid:Number(child.pid),stat:readFileSync(`/proc/${child.pid}/stat`, "utf8").split(") ")[1]?.split(" ")[19]}) + "\n"); })))), fileSystem:fs, idAllocator:ids, serverConfig:config });
      log("[combined] opening");
      const runtime = yield* adapter.openSession({ threadId:THREAD, providerSessionId:SESSION, modelSelection:selection, runtimePolicy:policy });
      log("[combined] opened");
      const events = yield* Queue.unbounded<ProviderAdapterV2Event>();
      yield* runtime.events.pipe(Stream.runForEach(e => Queue.offer(events,e)), Effect.forkScoped);
      const providerThread = yield* runtime.ensureThread({threadId:THREAD,modelSelection:selection,runtimePolicy:policy});
      log("[combined] ensured");
      yield* Effect.addFinalizer(() => Effect.sync(() => log("[combined] scope-finalizer-enter")));
      assert.equal(providerThread.providerSessionId, SESSION);
      // ensure may initialize this. That is not tool execution.
      assert.equal(fixture.mcpCalls.some(c => c.method === "tools/call"), false);
      const now = yield* DateTime.now;
      const appThread = {createdBy:"user",creationSource:"web",id:THREAD,projectId:"project-combined",title:"Combined",providerInstanceId:PI,modelSelection:selection,runtimeMode:"full-access",interactionMode:"default",branch:null,worktreePath:null,activeProviderThreadId:null,lineage:{parentThreadId:null,relationshipToParent:null,rootThreadId:THREAD},forkedFrom:null,createdAt:now,updatedAt:now,archivedAt:null,settledOverride:null,settledAt:null,lastVisitedAt:null,deletedAt:null} as OrchestrationV2AppThread;
      yield* runtime.startTurn({appThread,threadId:THREAD,runId:RunId.make("run-combined"),runOrdinal:1,providerTurnOrdinal:1,attemptId:RunAttemptId.make("attempt-combined"),rootNodeId:NodeId.make("node-combined"),providerThread,message:{messageId:"message-combined" as never,text:"Run the execute proof",attachments:[],createdBy:"user",creationSource:"web"},modelSelection:selection,runtimePolicy:policy});
      while (true) {
        const event = yield* Queue.take(events).pipe(Effect.timeout("10 seconds"));
        log("[combined] event", event.type);
        if (event.type === "provider_turn.updated" && event.providerTurn.status === "completed") break;
        if (event.type === "provider_turn.updated" && event.providerTurn.status === "failed") assert.fail("provider turn failed");
      }
      assert.equal(fixture.mcpCalls.filter(c => c.method === "tools/call").length, 1);
      assert.ok(fixture.mcpCalls.every(c => c.authorized));
      assert.equal(fixture.modelRequests.length, 2);
      assert.deepEqual(fixture.modelRequests[0].tools.map((t:any) => t.function.name), ["execute"]);
      assert.ok(JSON.stringify(fixture.modelRequests[1].messages).includes("COMBINED_MCP_PROOF:ok"));
      log("[combined] prompt-proof-complete", {launchMode, modelRequests:fixture.modelRequests.length, mcpCalls:fixture.mcpCalls, activeTools:fixture.modelRequests[0].tools.map((t:any) => t.function.name)});
    }).pipe(Effect.scoped, Effect.provide(testLayer), Effect.ensuring(Effect.sync(() => McpProviderSession.clearMcpProviderSession(THREAD)))),
    fixture => Effect.promise(async () => { log("[combined] scope-finalized"); fixture.mcp.closeAllConnections(); fixture.model.closeAllConnections(); fixture.mcp.close(); fixture.model.close(); for (const pid of fixture.pids) { let alive = false; try { process.kill(pid, 0); alive = true; } catch {} log("reaped", {pid, alive}); assert.equal(alive, false); } await rm(fixture.root,{recursive:true,force:true}); }),
  ), 15_000);
 }
});
