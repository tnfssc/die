#!/usr/bin/env bun
/** Real die RPC smoke backed by a loopback OpenAI-compatible model. */
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const fixtureRoot = await mkdtemp("/var/tmp/die-web-rpc-smoke-");
await chmod(fixtureRoot, 0o700);
const home = join(fixtureRoot, "home");
const agentDir = join(fixtureRoot, "pi-agent");
await mkdir(home, { recursive: true, mode: 0o700 });
await mkdir(agentDir, { recursive: true, mode: 0o700 });

type RpcEvent = {
  [key: string]: unknown;
  type?: string;
  id?: string;
  command?: string;
  success?: boolean;
  toolName?: string;
  isError?: boolean;
  method?: string;
  statusKey?: string;
  statusText?: unknown;
  event?: string;
  task?: { id?: unknown; kind?: string; status?: string };
  result?: { details?: { stdout?: unknown } };
};

const requests: unknown[] = [];
let server: ReturnType<typeof Bun.serve> | undefined;

function completion(delta: Record<string, unknown>, finishReason: string) {
  const created = Math.floor(Date.now() / 1000);
  const chunks = [
    {
      id: "die-web-rpc-smoke",
      object: "chat.completion.chunk",
      created,
      model: "loopback-model",
      choices: [{ index: 0, delta, finish_reason: null }],
    },
    {
      id: "die-web-rpc-smoke",
      object: "chat.completion.chunk",
      created,
      model: "loopback-model",
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    },
  ];
  return new Response(chunks.map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n").join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("RPC smoke assertion failed: " + message);
}

try {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = await request.json();
      requests.push(body);
      const serialized = JSON.stringify(body);
      if (serialized.includes("die_rpc_loopback_execute"))
        return completion({ role: "assistant", content: "DIE_RPC_LOOPBACK_PARENT_OK" }, "stop");
      if (serialized.includes("DIE_RPC_LOOPBACK_WORKER_PROMPT"))
        return completion({ role: "assistant", content: "DIE_RPC_LOOPBACK_WORKER_OK" }, "stop");
      return completion(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "die_rpc_loopback_execute",
              type: "function",
              function: {
                name: "execute",
                arguments: JSON.stringify({
                  code: [
                    'const shellResult = await shell("printf DIE_RPC_LOOPBACK_SHELL_OK", { waitSeconds: 10 });',
                    'const agentResult = await subagent({ type: "fast", prompt: "DIE_RPC_LOOPBACK_WORKER_PROMPT: reply exactly DIE_RPC_LOOPBACK_WORKER_OK", waitSeconds: 20, timeoutSeconds: 30 });',
                    'console.log(JSON.stringify({ fixture: "die-web-rpc", shellResult, agentResult }));',
                  ].join("\n"),
                }),
              },
            },
          ],
        },
        "tool_calls",
      );
    },
  });
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify(
      {
        providers: {
          loopback: {
            baseUrl: "http://127.0.0.1:" + server.port + "/v1",
            api: "openai-completions",
            apiKey: "loopback-not-a-secret",
            models: [{ id: "loopback-model", name: "RPC loopback fixture", contextWindow: 32000, maxTokens: 2000 }],
          },
        },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  await mkdir(join(home, ".die"), { recursive: true, mode: 0o700 });
  await writeFile(
    join(home, ".die", "subagents.json"),
    JSON.stringify({ fast: { model: "loopback/loopback-model", thinking: "off" } }, null, 2) + "\n",
    { mode: 0o600 },
  );

  // Subagents re-exec process.execPath, so this must be compiled die, not Bun running src/cli.ts.
  const binary = resolve(import.meta.dir, "../dist/die");
  assert(await Bun.file(binary).exists(), "dist/die is missing; run 'bun run build' first");
  // Leave the same isolated loopback model running for the browser smoke.
  if (process.argv.includes("--serve")) {
    const wrapper = join(fixtureRoot, "die-fixture");
    await writeFile(
      wrapper,
      "#!/bin/sh\nexec " + JSON.stringify(binary) + ' --provider loopback --model loopback-model "$@"\n',
      { mode: 0o700 },
    );
    console.log(JSON.stringify({ fixtureRoot, home, agentDir, wrapper, port: server.port }));
    await new Promise(() => {});
  }
  const rpc = Bun.spawn(
    [binary, "--mode", "rpc", "--no-session", "--offline", "--provider", "loopback", "--model", "loopback-model"],
    {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: agentDir,
        DIE_CODING_AGENT_DIR: agentDir,
        HERDR_ENV: "0",
        DIE_WEB_TASK_EVENTS: "1",
        PI_OFFLINE: "1",
        DIE_SUBAGENT_DEPTH: "0",
        DIE_SUBAGENT_TYPE: "",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  rpc.stdin.write(JSON.stringify({ id: "state", type: "get_state" }) + "\n");
  rpc.stdin.write(JSON.stringify({ id: "prompt", type: "prompt", message: "Run the loopback RPC smoke task." }) + "\n");

  let stdout = "";
  let pending = "";
  let finish!: () => void;
  const agentFinished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stdoutPromise = (async () => {
    const reader = rpc.stdout.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      stdout += text;
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        try {
          if (JSON.parse(line).type === "agent_end") finish();
        } catch {
          /* asserted below */
        }
      }
    }
  })();
  const stderrPromise = new Response(rpc.stderr).text();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      agentFinished,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          rpc.kill();
          reject(new Error("RPC smoke timed out after 45 seconds"));
        }, 45_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  rpc.stdin.end();
  const exitCode = await rpc.exited;
  await stdoutPromise;
  const stderr = await stderrPromise;
  await writeFile(join(fixtureRoot, "rpc-events.jsonl"), stdout, { mode: 0o600 });
  await writeFile(join(fixtureRoot, "die-stderr.log"), stderr, { mode: 0o600 });
  await writeFile(join(fixtureRoot, "model-requests.json"), JSON.stringify(requests, null, 2) + "\n", { mode: 0o600 });

  assert(exitCode === 0, "die exited " + exitCode + "; see die-stderr.log");
  const events = stdout
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as RpcEvent;
      } catch {
        throw new Error("stdout line " + (index + 1) + " is not JSON: " + line);
      }
    });
  const state = events.find((event) => event.type === "response" && event.id === "state");
  assert(state?.success === true && state.command === "get_state", "missing successful RPC get_state handshake");
  assert(
    events.some((event) => event.type === "response" && event.id === "prompt" && event.success === true),
    "missing successful RPC prompt response",
  );
  assert(
    events.some((event) => event.type === "tool_execution_start" && event.toolName === "execute"),
    "missing structured execute start event",
  );
  const toolEnd = events.find((event) => event.type === "tool_execution_end" && event.toolName === "execute");
  assert(toolEnd && toolEnd.isError === false, "missing successful structured execute end event");
  assert(typeof toolEnd.result?.details?.stdout === "string", "execute result omitted structured stdout");
  const taskOutput = JSON.parse(toolEnd.result.details.stdout);
  assert(
    taskOutput.shellResult?.kind === "command" && taskOutput.shellResult?.status === "completed",
    "shell task summary is not structured",
  );
  assert(taskOutput.shellResult?.output === "DIE_RPC_LOOPBACK_SHELL_OK", "shell task output was not captured");
  assert(
    taskOutput.agentResult?.kind === "agent" && taskOutput.agentResult?.status === "completed",
    "subagent task summary is not structured",
  );
  assert(taskOutput.agentResult?.output === "DIE_RPC_LOOPBACK_WORKER_OK", "subagent task output was not captured");
  const taskEvents = events.filter((event) => event.type === "die_task_event");
  assert(taskEvents.length === 4, "expected exactly start/completion for command and agent");
  for (const kind of ["command", "agent"]) {
    const records = taskEvents.filter((event) => event.task?.kind === kind);
    assert(records.length === 2, "expected two lifecycle records for " + kind);
    assert(records[0]?.event === "started" && records[1]?.event === "completed", "invalid lifecycle order for " + kind);
    assert(records[0]?.task?.id === records[1]?.task?.id, "task identity changed");
    assert(records[1]?.task?.status === "completed", "task did not complete");
    assert(
      records.every((event) => !("output" in event)),
      "unexpected task output stream",
    );
  }
  assert(
    events.some((event) => JSON.stringify(event).includes("DIE_RPC_LOOPBACK_PARENT_OK")),
    "missing final parent model output",
  );
  assert(requests.length >= 3, "loopback model did not receive parent/tool/subagent turns");
  console.log("die web RPC smoke passed; artifacts: " + fixtureRoot);
} catch (error) {
  console.error(error);
  console.error("die web RPC smoke artifacts: " + fixtureRoot);
  process.exitCode = 1;
} finally {
  server?.stop(true);
}
