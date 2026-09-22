/** Mock-fixture extension only. Real T3 loads its generated upstream extension instead. */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { T3ExecuteBridgeClient, T3_MCP_URL_ENV, T3_MCP_BEARER_ENV } from "./bridge-client";
export { T3_MCP_URL_ENV, T3_MCP_BEARER_ENV };
type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };
export class T3McpClient extends T3ExecuteBridgeClient {
  connect(signal?: AbortSignal) { return this.initialize(signal); }
  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.request("tools/list", cursor ? { cursor } : {}, signal);
      tools.push(...(result?.tools ?? []));
      cursor = result?.nextCursor;
    } while (cursor);
    return tools;
  }
}

function schema(value: Record<string, unknown> | undefined) {
  const unsafe = (Type as unknown as { Unsafe?: (x: unknown) => any }).Unsafe;
  return unsafe && value ? unsafe(value) : Type.Object({}, { additionalProperties: true });
}
function textOf(result: any): string {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content.map((part: any) => part?.type === "text" ? part.text : JSON.stringify(part)).join("\n") || JSON.stringify(result);
}

export default async function bridgeExtension(pi: ExtensionAPI) {
  const endpoint = process.env[T3_MCP_URL_ENV];
  const bearer = process.env[T3_MCP_BEARER_ENV];
  if (!endpoint || !bearer) return;
  const client = new T3McpClient(endpoint, bearer);
  await client.connect(AbortSignal.timeout(10_000));
  const tools = await client.listTools(AbortSignal.timeout(10_000));
  pi.on("session_shutdown", () => client.close());
  const registeredNames: string[] = [];
  for (const tool of tools) {
    const registeredName = `mcp__t3-code__${tool.name}`;
    registeredNames.push(registeredName);
    const definition: ToolDefinition<any, any> = {
      name: registeredName,
      label: tool.name,
      description: tool.description ?? tool.name,
      promptSnippet: tool.description ?? tool.name,
      promptGuidelines: [
        `Use ${registeredName} for T3-owned delegation. Do not also launch a local execute subagent for the same task.`,
      ],
      parameters: schema(tool.inputSchema),
      async execute(_id, params, signal) {
        const result = await client.callTool(tool.name, (params ?? {}) as Record<string, unknown>, signal);
        return {
          content: [{ type: "text", text: textOf(result) }],
          details: { server: "t3-code", tool: tool.name },
          ...(result?.isError ? { isError: true } : {}),
        };
      },
    };
    pi.registerTool(definition);
  }
  pi.on("before_agent_start", (event) => ({
    systemPrompt: event.systemPrompt +
      "\n\nT3 owns delegated child creation in this session. Use the mcp__t3-code__ tools for delegation; never duplicate that work with execute's local subagent().",
  }));
}
