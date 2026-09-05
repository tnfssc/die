import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeIsolated, formatResult } from "./execution";

const ExecuteParameters = Type.Object({
  code: Type.String({ description: "TypeScript source to transpile and execute" }),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0.1, description: "Optional execution timeout" })),
});

export function registerExecuteTool(pi: ExtensionAPI): void {
  const shutdown = new AbortController();
  const active = new Set<Promise<unknown>>();
  pi.on("session_shutdown", async () => {
    shutdown.abort();
    await Promise.allSettled([...active]);
  });

  pi.registerTool({
    name: "execute",
    label: "Execute",
    description:
      "Transpile and execute TypeScript as a module in an isolated child process in the current working directory. Use this single code tool for filesystem reads, writes, edits, and synchronous command execution. Top-level await, static imports, dynamic imports, exports, CommonJS require(), Bun APIs, Web APIs, Node built-ins, local modules, and installed packages are supported. Print results with console.log. Output retains only the last 24,000 bytes or 900 lines per stream; discarded output is not saved. No temporary source file is written. Subprocesses in the execution process group are terminated when execution ends; use task for background work.",
    promptSnippet: "Execute code for filesystem, process, and general coding operations",
    promptGuidelines: [
      "Use execute instead of read, edit, write, bash, or powershell.",
      "Submit TypeScript with top-level await when useful.",
      "Use import, dynamic import(), or require() for Node built-ins, packages, and local modules.",
      "Use Bun.file and Bun.write or node:fs APIs for files, and Bun.spawn/Bun.spawnSync for commands.",
      "Print information needed by the agent with console.log because module exports are not returned.",
      "Keep execute output selective; do not rerun side-effecting code just to recover discarded output.",
      "Use task when command execution specifically needs to continue asynchronously in the background.",
      "Do not use execute for no-op calls, waiting messages, or sleeps solely to wait for pending task or subagent work. When no useful independent work remains, acknowledge once and end the turn; automatic completion will resume you.",
    ],
    parameters: ExecuteParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const execution = executeIsolated(
        params.code,
        ctx.cwd,
        signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal,
        params.timeoutSeconds ? params.timeoutSeconds * 1_000 : undefined,
      );
      active.add(execution);
      try {
        const result = await execution;
        const text = formatResult(result);
        // Pi marks tool failures only when execute throws, not via isError in
        // the returned object. Include bounded diagnostics in that exception.
        if (result.exitCode !== 0 || result.timedOut || result.cancelled) throw new Error(text);
        return { content: [{ type: "text", text }], details: result };
      } finally {
        active.delete(execution);
      }
    },
  });
}
