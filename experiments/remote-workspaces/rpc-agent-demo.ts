#!/usr/bin/env bun
/** Option A proof: real die RPC + offline fake model, agent owned by controller not viewer.
 * Run bun run build && bun experiments/remote-workspaces/rpc-agent-demo.ts
 */
import { mkdir, mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rootArg = process.argv[3];
if (process.argv[2] === "--viewer" || process.argv[2] === "--reconnect") {
  const mode = process.argv[2];
  if (!rootArg) throw Error("fixture required");
  for (let i = 0; i < 500; i++) {
    const state = JSON.parse(await readFile(join(rootArg, "status.json"), "utf8"));
    if ((mode === "--viewer" && state.stage === "executing") || (mode === "--reconnect" && state.stage === "done")) {
      console.log(
        JSON.stringify({
          state,
          events:
            mode === "--reconnect"
              ? (await readFile(join(rootArg, "events.jsonl"), "utf8"))
                  .trim()
                  .split("\n")
                  .map((line) => JSON.parse(line))
                  .filter((e: any) => ["tool_execution_end", "agent_end"].includes(e.type))
              : [],
        }),
      );
      process.exit(0);
    }
    await sleep(30);
  }
  throw Error("viewer timed out");
}
const root = await mkdtemp("/var/tmp/die-option-a-");
const target = join(root, "target"),
  home = join(root, "home"),
  agentDir = join(root, "agent");
await Promise.all([mkdir(target), mkdir(home), mkdir(agentDir)]);
const marker = "DIE_OPTION_A_TARGET_MARKER";
await writeFile(join(target, "marker.txt"), marker + "\n", { mode: 0o600 });
const journal = join(root, "events.jsonl");
await writeFile(journal, "", { mode: 0o600 });
let stage = "starting";
const events: any[] = [],
  requests: any[] = [];
const status = async () => {
  const path = join(root, "status-" + crypto.randomUUID() + ".tmp");
  await writeFile(path, JSON.stringify({ stage, eventCount: events.length, modelTurns: requests.length }) + "\n", {
    mode: 0o600,
  });
  await rename(path, join(root, "status.json"));
};
await status();
function sse(delta: object, finish: string) {
  const chunk = (d: object, f: string | null) =>
    "data: " +
    JSON.stringify({
      id: "option-a",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "loopback-model",
      choices: [{ index: 0, delta: d, finish_reason: f }],
    }) +
    "\n\n";
  return new Response(chunk(delta, null) + chunk({}, finish) + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    if (new URL(req.url).pathname !== "/v1/chat/completions") throw Error("unexpected path");
    const body = await req.json();
    requests.push(body);
    if (requests.length > 3) throw Error("extra model turn");
    await status();
    const call = (id: string, code: string) =>
      sse(
        {
          role: "assistant",
          tool_calls: [
            { index: 0, id, type: "function", function: { name: "execute", arguments: JSON.stringify({ code }) } },
          ],
        },
        "tool_calls",
      );
    if (requests.length === 1)
      return call(
        "first_execute",
        [
          'const fs = await import("node:fs/promises");',
          'const p = await import("node:path");',
          'const file = p.join(process.cwd(), "marker.txt");',
          "const info = await fs.stat(file); const text = await Bun.file(file).text();",
          'const shellResult = await shell("pwd; sleep 2; printf DIE_OPTION_A_SHELL_OK", { waitSeconds: 5 });',
          "console.log(JSON.stringify({ marker: text.trim(), isFile: info.isFile(), cwd: process.cwd(), shellResult }));",
        ].join("\n"),
      );
    if (requests.length === 2) {
      if (![marker, "DIE_OPTION_A_SHELL_OK", target].every((x) => JSON.stringify(body).includes(x)))
        throw Error("first tool result not fed to model");
      return call(
        "second_execute",
        'console.log("DIE_OPTION_A_SECOND_EXECUTE_OK:" + (await Bun.file("marker.txt").text()).trim())',
      );
    }
    if (!JSON.stringify(body).includes("DIE_OPTION_A_SECOND_EXECUTE_OK:" + marker))
      throw Error("second tool result not fed to model");
    return sse({ role: "assistant", content: "DIE_OPTION_A_FINISHED" }, "stop");
  },
});
let rpc: ReturnType<typeof Bun.spawn> | undefined;
const watchdog = setTimeout(() => rpc?.kill(), 55_000);
try {
  const binary = resolve(import.meta.dir, "../../dist/die");
  if (!(await Bun.file(binary).exists())) throw Error("run bun run build first");
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        loopback: {
          baseUrl: "http://127.0.0.1:" + server.port + "/v1",
          api: "openai-completions",
          apiKey: "loopback-not-a-secret",
          models: [{ id: "loopback-model", name: "offline fixture", contextWindow: 32000, maxTokens: 2000 }],
        },
      },
    }),
    { mode: 0o600 },
  );
  const child = Bun.spawn(
    [binary, "--mode", "rpc", "--no-session", "--offline", "--provider", "loopback", "--model", "loopback-model"],
    {
      cwd: target,
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: agentDir,
        DIE_CODING_AGENT_DIR: agentDir,
        HERDR_ENV: "0",
        PI_OFFLINE: "1",
        DIE_SUBAGENT_DEPTH: "0",
        DIE_SUBAGENT_TYPE: "",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  rpc = child;
  let stderr = "";
  const stderrTask = (async () => {
    for await (const chunk of child.stderr) stderr = (stderr + new TextDecoder().decode(chunk)).slice(-8192);
  })();
  let readError: unknown;
  const reading = (async () => {
    const reader = child.stdout.getReader(),
      decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      if (pending.length > 1_000_000) throw Error("RPC line too long");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        if (events.length >= 256) throw Error("event limit");
        const e = JSON.parse(line);
        events.push(e);
        const short = {
          type: e.type,
          id: e.id,
          toolName: e.toolName,
          isError: e.isError,
          text: e.type === "tool_execution_end" ? JSON.stringify(e.result).slice(0, 4096) : undefined,
        };
        const previous = await readFile(journal, "utf8");
        if (previous.length > 100_000) throw Error("journal limit");
        await writeFile(journal, previous + JSON.stringify(short) + "\n", { mode: 0o600 });
        if (e.type === "tool_execution_start" && stage === "starting") stage = "executing";
        if (e.type === "agent_end") stage = "done";
        await status();
      }
    }
  })();
  void reading.catch((error) => {
    readError = error;
  });
  child.stdin.write(JSON.stringify({ id: "state", type: "get_state" }) + "\n");
  child.stdin.write(
    JSON.stringify({
      id: "only-prompt",
      type: "prompt",
      message: "Inspect the target marker, then complete the follow-up execute.",
    }) + "\n",
  );
  const viewer = Bun.spawn([process.execPath, import.meta.path, "--viewer", root], { stdout: "pipe", stderr: "pipe" });
  const first = await new Response(viewer.stdout).text();
  if ((await viewer.exited) !== 0 || JSON.parse(first).state.stage !== "executing" || stage === "done")
    throw Error("viewer did not detach while agent active: " + first);
  if (events.some((e) => e.type === "tool_execution_end"))
    throw Error("viewer detached too late to prove continued tool work");
  const detachedAt = events.length;
  const deadline = Date.now() + 45_000;
  while (stage !== "done" && Date.now() < deadline) {
    if (readError) throw readError;
    await sleep(30);
  }
  if (stage !== "done") throw Error("agent timed out: " + stderr);
  const tools = events.filter((e) => e.type === "tool_execution_end" && e.toolName === "execute");
  if (
    !(
      events.length > detachedAt &&
      tools.length === 2 &&
      tools.every((e) => !e.isError) &&
      JSON.stringify(tools[0].result).includes(marker) &&
      JSON.stringify(tools[0].result).includes(target) &&
      JSON.stringify(tools[1].result).includes("DIE_OPTION_A_SECOND_EXECUTE_OK:" + marker) &&
      events.filter((e) => e.type === "response" && e.id === "only-prompt" && e.success === true).length === 1 &&
      events.filter((e) => e.type === "agent_end").length === 1 &&
      requests.length === 3
    )
  )
    throw Error("proof assertion failed: " + JSON.stringify({ tools, stderr, requests: requests.length }));
  const viewer2 = Bun.spawn([process.execPath, import.meta.path, "--reconnect", root], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const second = JSON.parse(await new Response(viewer2.stdout).text());
  if (
    (await viewer2.exited) !== 0 ||
    second.state.stage !== "done" ||
    second.events.filter((e: any) => e.type === "tool_execution_end").length !== 2
  )
    throw Error("reconnect failed");
  if (child.exitCode !== null) throw Error("agent exited before viewer reconnected");
  child.stdin.end();
  if ((await child.exited) !== 0) throw Error("die exited nonzero: " + stderr);
  await reading;
  await stderrTask;
  console.log(
    JSON.stringify({
      result: "PASS",
      evidence: "LOCAL actual agent + fake model, no SSH",
      detachedAt,
      agentEvents: events.length,
      modelTurns: requests.length,
      reconnect: second.state,
      toolOutputs: tools.map((e: any) => e.result?.details?.stdout),
    }),
  );
} finally {
  clearTimeout(watchdog);
  rpc?.kill();
  server.stop(true);
  await rm(root, { recursive: true, force: true });
}
