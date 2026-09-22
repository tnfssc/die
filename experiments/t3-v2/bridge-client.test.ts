import { expect, test } from "bun:test";
import { T3ExecuteBridgeClient } from "./bridge-client";
import configure from "./bridge-activation";

test("status/cancel work across fresh HTTP clients with session bearer", async () => {
  const calls: string[] = [];
  const token = crypto.randomUUID();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (request.headers.get("authorization") !== "Bearer " + token) return new Response(null, { status: 401 });
    const rpc = await request.json() as any;
    calls.push(rpc.method === "tools/call" ? rpc.params.name : rpc.method);
    const result = rpc.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "mock", version: "1" } } : { structuredContent: { taskId: rpc.params.arguments.taskId, status: rpc.params.name === "task_cancel" ? "interrupted" : "completed" } };
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
  }});
  try {
    const endpoint = "http://127.0.0.1:" + server.port;
    expect((await new T3ExecuteBridgeClient(endpoint, token).taskStatus("task-1")).structuredContent).toEqual({ taskId: "task-1", status: "completed" });
    expect((await new T3ExecuteBridgeClient(endpoint, token).taskCancel("task-1")).structuredContent).toEqual({ taskId: "task-1", status: "interrupted" });
    expect(calls).toEqual(["initialize", "task_status", "initialize", "task_cancel"]);
    await expect(new T3ExecuteBridgeClient(endpoint, "wrong").taskStatus("task-1")).rejects.toThrow("HTTP 401");
  } finally { server.stop(true); }
});

test("bridge refuses HTTP redirects instead of forwarding session credentials", async () => {
  let targetHits = 0;
  const target = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { targetHits++; return new Response("unexpected"); } });
  const redirect = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { return Response.redirect("http://127.0.0.1:" + target.port, 307); } });
  try {
    await expect(new T3ExecuteBridgeClient("http://127.0.0.1:" + redirect.port, "test-only").taskStatus("task-1")).rejects.toThrow();
    expect(targetHits).toBe(0);
  } finally { redirect.stop(true); target.stop(true); }
});

test("activation does nothing in an ordinary non-T3 process", () => {
  const previous = process.env.T3_MCP_URL;
  delete process.env.T3_MCP_URL;
  try { configure({ on() { throw new Error("must not register hooks"); } } as any); }
  finally { if (previous === undefined) delete process.env.T3_MCP_URL; else process.env.T3_MCP_URL = previous; }
});

// Protocol regression fixture, not a substitute for the real Effect MCP tests.
test("one-shot helpers send protocol header and delete each transport session", async () => {
  const { taskStatus, delegateTask } = await import("./bridge-client");
  const sessions = new Set<string>();
  let initialized = 0, deleted = 0, calls = 0;
  const server = Bun.serve({ hostname:"127.0.0.1", port:0, async fetch(request) {
    if (request.headers.get("mcp-protocol-version") !== "2025-06-18") return new Response(null,{status:400});
    if (request.headers.get("authorization") !== "Bearer fixture-protocol") return new Response(null,{status:401});
    const session = request.headers.get("mcp-session-id");
    if (request.method === "DELETE") {
      expect(sessions.delete(session!)).toBe(true); deleted++;
      return new Response(null,{status:200});
    }
    const rpc = await request.json() as any;
    if (rpc.method === "initialize") {
      const id = "session-" + ++initialized; sessions.add(id);
      return Response.json({jsonrpc:"2.0",id:rpc.id,result:{protocolVersion:"2025-06-18",capabilities:{},serverInfo:{name:"strict-fixture",version:"1"}}},{headers:{"mcp-session-id":id}});
    }
    expect(sessions.has(session!)).toBe(true);
    calls++;
    if (rpc.params.name === "delegate_task") return Response.json({jsonrpc:"2.0",id:rpc.id,error:{code:-32000,message:"REJECTED"}});
    // Notification and wrong-ID frames must not replace the matching response.
    return new Response('data: {"jsonrpc":"2.0","method":"notifications/message"}\n\ndata: {"jsonrpc":"2.0","id":999,"result":"wrong"}\n\ndata: '+JSON.stringify({jsonrpc:"2.0",id:rpc.id,result:{structuredContent:{taskId:"durable-task",status:"completed"}}})+'\n\n',{headers:{"content-type":"text/event-stream"}});
  }});
  const previous = {url:process.env.T3_MCP_URL,token:process.env.T3_MCP_BEARER_TOKEN};
  process.env.T3_MCP_URL = "http://127.0.0.1:"+server.port;
  process.env.T3_MCP_BEARER_TOKEN = "fixture-protocol";
  try {
    for (let i=0;i<2;i++) {
      expect((await taskStatus("durable-task")).structuredContent).toEqual({taskId:"durable-task",status:"completed"});
      expect(sessions.size).toBe(0);
    }
    await expect(delegateTask({task:"reject"})).rejects.toThrow("REJECTED");
    expect(sessions.size).toBe(0);
    expect({initialized,deleted,calls}).toEqual({initialized:3,deleted:3,calls:3});
  } finally {
    if(previous.url===undefined) delete process.env.T3_MCP_URL; else process.env.T3_MCP_URL=previous.url;
    if(previous.token===undefined) delete process.env.T3_MCP_BEARER_TOKEN; else process.env.T3_MCP_BEARER_TOKEN=previous.token;
    server.stop(true);
  }
});
