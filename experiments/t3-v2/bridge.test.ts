import { afterEach, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";

const roots: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function listen(server: ReturnType<typeof createServer>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  return (server.address() as { port: number }).port;
}
async function jsonBody(request: IncomingMessage) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}
function json(response: ServerResponse, value: unknown, headers: Record<string, string> = {}) {
  response.writeHead(200, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}
function stream(response: ServerResponse, chunks: unknown[]) {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n");
}

for (const rejectDelegation of [false, true]) test((rejectDelegation ? "negative/rejection-surfaced: " : "") + "actual Die execute imports the bridge and invokes mock delegate_task exactly once", async () => {
  const calls: Array<{ method: string; params: any; authorization?: string }> = [];
  const mcp = createServer(async (request, response) => {
    if (request.method === "DELETE") { response.writeHead(200).end(); return; }
    const rpc = await jsonBody(request);
    calls.push({ method: rpc.method, params: rpc.params, authorization: request.headers.authorization });
    const headers = { "mcp-session-id": `bridge-test-${calls.length}` };
    if (rpc.method === "initialize") return json(response, { jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "explicit-mock-t3", version: "1" } } }, headers);
    if (rpc.method === "tools/list") return json(response, { jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "delegate_task", description: "Mock T3 delegation", inputSchema: { type: "object", properties: { task: { type: "string" } }, required: ["task"] } }] } }, headers);
    if (rpc.method === "tools/call" && rejectDelegation) return json(response, { jsonrpc:"2.0", id:rpc.id, error:{code:-32000,message:"DETERMINISTIC_DELEGATION_REJECTED"} }, headers);
    if (rpc.method === "tools/call") return json(response, { jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: `T3_DELEGATE_RESULT:${rpc.params.arguments.task}` }] } }, headers);
    response.writeHead(400).end();
  });
  const mcpPort = await listen(mcp);

  const bridgePath = resolve(import.meta.dir, "bridge-client.ts");
  const executeCode = `import { delegateTask } from ${JSON.stringify(bridgePath)}; console.log("LOCAL_SUBAGENT_HELPER:" + typeof subagent); try { const result = await delegateTask({ task: "one-child-only", mode: "wait" }); console.log("EXECUTE_RECEIVED:" + JSON.stringify(result)); } catch(error) { console.log("EXECUTE_REJECTED:" + error.message); }`;
  const modelRequests: any[] = [];
  const model = createServer(async (request, response) => {
    const payload = await jsonBody(request);
    modelRequests.push(payload);
    const base = { id: "fixture", object: "chat.completion.chunk", created: 1, model: "bridge-fixture" };
    if (modelRequests.length === 1) {
      return stream(response, [
        { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [
          { index: 0, id: "execute-proof", type: "function", function: { name: "execute", arguments: JSON.stringify({ code: executeCode }) } },
        ] }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ]);
    }
    return stream(response, [
      { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]);
  });
  const modelPort = await listen(model);

  const root = await mkdtemp(resolve(tmpdir(), "die-t3-bridge-"));
  roots.push(root);
  const agentDir = resolve(root, "agent");
  const home = resolve(root, "home");
  await mkdir(agentDir, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(resolve(agentDir, "models.json"), JSON.stringify({ providers: { loopback: {
    baseUrl: `http://127.0.0.1:${modelPort}/v1`, api: "openai-completions", apiKey: "fixture-only",
    models: [{ id: "bridge-fixture", name: "Bridge Fixture", contextWindow: 32000, maxTokens: 1000 }],
  } } }));

  const repo = resolve(import.meta.dir, "../..");
  const child = Bun.spawn([
    resolve(import.meta.dir, "bridge-launcher.ts"), "--mode", "rpc", "--no-session",
    "--provider", "loopback", "--model", "bridge-fixture",
    // Stand-in for PiAdapterV2's injected extension: it remains loaded, but its
    // registered delegate_task tool must not become model-visible.
    "--extension", resolve(import.meta.dir, "bridge-extension.ts"),
  ], {
    cwd: repo,
    env: { ...process.env, DIE_T3_DIE_BIN: resolve(repo, "dist/die"), HOME: home, PI_CODING_AGENT_DIR: agentDir, DIE_CODING_AGENT_DIR: agentDir,
      T3_MCP_URL: `http://127.0.0.1:${mcpPort}/mcp`, T3_MCP_BEARER_TOKEN: "secret-fixture-token" },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const output: any[] = [];
  let stderr = "";
  const reader = (async () => {
    let pending = "";
    for await (const chunk of child.stdout) {
      pending += new TextDecoder().decode(chunk);
      const lines = pending.split("\n"); pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) output.push(JSON.parse(line));
    }
  })();
  const errorReader = (async () => { for await (const chunk of child.stderr) stderr += new TextDecoder().decode(chunk); })();
  try {
    child.stdin.write(JSON.stringify({ id: "proof", type: "prompt", message: "delegate exactly once through execute" }) + "\n");
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && modelRequests.length < 2) await Bun.sleep(25);
    expect(modelRequests.length, stderr).toBe(2);
    const advertised = modelRequests[0].tools.map((tool: any) => tool.function?.name ?? tool.name);
    expect(advertised).toEqual(["execute"]);
    expect(JSON.stringify(modelRequests[0].messages)).toContain(bridgePath);
    const continuation = JSON.stringify(modelRequests[1].messages);
    expect(continuation).toContain("LOCAL_SUBAGENT_HELPER:function");
    if (rejectDelegation) {
      expect(continuation).toContain("EXECUTE_REJECTED:DETERMINISTIC_DELEGATION_REJECTED");
      expect(continuation).not.toContain("T3_DELEGATE_RESULT:one-child-only");
    } else {
      expect(continuation).toContain("EXECUTE_RECEIVED:");
      expect(continuation).toContain("T3_DELEGATE_RESULT:one-child-only");
    }
    const delegated = calls.filter((call) => call.method === "tools/call");
    expect(delegated).toHaveLength(1);
    expect(delegated[0]?.params).toEqual({ name: "delegate_task", arguments: { task: "one-child-only", mode: "wait" } });
    expect(calls.every((call) => call.authorization === "Bearer secret-fixture-token")).toBe(true);
    expect(JSON.stringify(output)).not.toContain("secret-fixture-token");
  } finally {
    child.kill();
    await child.exited;
    await Promise.all([reader, errorReader]);
  }
}, 30_000);
