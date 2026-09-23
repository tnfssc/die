#!/usr/bin/env bun
/**
 * Soak the real Die RPC lifecycle against a local OpenAI-compatible fake. Touch
 * only this run's temporary HOME, loopback listener, and spawned Die PID.
 */
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const cycles = Number(process.env.DIE_SOAK_CYCLES ?? 120);
const newOnly = process.env.DIE_SOAK_NEW_ONLY === "1";
const root = await mkdtemp("/var/tmp/die-cli-runtime-soak-");
await chmod(root, 0o700);
const home = join(root, "home");
const agentDir = join(root, "agent");
await mkdir(home, { recursive: true, mode: 0o700 });
await mkdir(agentDir, { recursive: true, mode: 0o700 });
await mkdir(join(home, ".die"), { recursive: true, mode: 0o700 });
let requestCount = 0;
let server: ReturnType<typeof Bun.serve> | undefined;

function completion(text: string) {
  const chunk = (delta: object, finish_reason: string | null) => ({
    id: "soak",
    object: "chat.completion.chunk",
    created: 1,
    model: "soak-model",
    choices: [{ index: 0, delta, finish_reason }],
  });
  const body =
    [chunk({ role: "assistant", content: text }, null), chunk({}, "stop")]
      .map((x) => "data: " + JSON.stringify(x) + "\n\n")
      .join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

async function procSample(pid: number, label: string) {
  const status = await readFile(`/proc/${pid}/status`, "utf8");
  const get = (key: string) => Number(status.match(new RegExp("^" + key + ":\\s+(\\d+)", "m"))?.[1] ?? 0);
  const children = new Set<number>();
  async function walk(parent: number) {
    let dirs: string[] = [];
    try {
      dirs = await readdir("/proc");
    } catch {
      return;
    }
    for (const d of dirs) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const s = await readFile(`/proc/${d}/status`, "utf8");
        if (Number(s.match(/^PPid:\s+(\d+)/m)?.[1]) === parent && !children.has(Number(d))) {
          children.add(Number(d));
          await walk(Number(d));
        }
      } catch {
        /* exited */
      }
    }
  }
  await walk(pid);
  return {
    label,
    at: Date.now(),
    rssKiB: get("VmRSS"),
    hwmKiB: get("VmHWM"),
    vmKiB: get("VmSize"),
    threads: get("Threads"),
    fds: (await readdir(`/proc/${pid}/fd`)).length,
    children: [...children],
  };
}

server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    requestCount++;
    const body = await req.text();
    let latestUser = "";
    try {
      const parsed = JSON.parse(body);
      latestUser = [...(parsed.messages ?? [])].reverse().find((m: any) => m.role === "user")?.content ?? "";
      if (typeof latestUser !== "string") latestUser = JSON.stringify(latestUser);
    } catch {
      /* malformed requests should still receive a harmless completion */
    }
    // Only the current abort turn is delayed; do not match historical messages.
    if (latestUser.includes("SOAK_ABORT_ME")) await Bun.sleep(10_000);
    return completion(body.includes("Summarize") || body.includes("summary") ? "compact summary" : "ok");
  },
});
await writeFile(
  join(agentDir, "settings.json"),
  JSON.stringify({ compaction: { enabled: true, reserveTokens: 256, keepRecentTokens: 128 } }, null, 2) + "\n",
  { mode: 0o600 },
);
await writeFile(
  join(agentDir, "models.json"),
  JSON.stringify(
    {
      providers: {
        soak: {
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          api: "openai-completions",
          apiKey: "local",
          models: [{ id: "soak-model", name: "Local soak", contextWindow: 8192, maxTokens: 128 }],
        },
      },
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);

const binary = resolve(import.meta.dir, "../../dist/die");
if (!(await Bun.file(binary).exists())) throw new Error("dist/die missing; run bun run build");
const child = Bun.spawn([binary, "--mode", "rpc", "--offline", "--provider", "soak", "--model", "soak-model"], {
  cwd: root,
  env: {
    ...process.env,
    HOME: home,
    PI_CODING_AGENT_DIR: agentDir,
    DIE_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    HERDR_ENV: "0",
    DIE_SUBAGENT_DEPTH: "0",
    DIE_SUBAGENT_TYPE: "",
  },
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});
const events: any[] = [];
const waiters = new Map<string, { resolve: (e: any) => void; reject: (e: Error) => void; timer: Timer }>();
let agentEnds: (() => void)[] = [];
const stdoutTask = (async () => {
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines)
      if (line.trim()) {
        let e: any;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        events.push(e);
        if (e.type === "response" && e.id && waiters.has(e.id)) {
          const w = waiters.get(e.id)!;
          clearTimeout(w.timer);
          waiters.delete(e.id);
          w.resolve(e);
        }
        if (e.type === "agent_end") agentEnds.shift()?.();
      }
  }
})();
const stderrTask = new Response(child.stderr).text();
let serial = 0;
function send(type: string, extra: object = {}, timeout = 15_000) {
  const id = `c${++serial}`;
  child.stdin.write(JSON.stringify({ id, type, ...extra }) + "\n");
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(id);
      reject(new Error(`timeout ${type}`));
    }, timeout);
    waiters.set(id, { resolve, reject, timer });
  });
}
function nextAgentEnd(timeout = 15_000) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout agent_end")), timeout);
    agentEnds.push(() => {
      clearTimeout(t);
      resolve();
    });
  });
}
async function turn(message: string) {
  const end = nextAgentEnd();
  const response = await send("prompt", { message });
  if (!response.success) throw new Error(JSON.stringify(response));
  await end;
}
const samples: any[] = [];
try {
  await send("get_state");
  samples.push(await procSample(child.pid, "start"));
  for (let i = 1; i <= cycles; i++) {
    if (newOnly) {
      await send("new_session");
    } else if (i % 12 === 0) {
      const end = nextAgentEnd();
      await send("prompt", { message: `SOAK_ABORT_ME ${i}` });
      await Bun.sleep(50);
      await send("abort");
      await end;
    } else await turn(`soak turn ${i} ` + "padding ".repeat(80));
    if (!newOnly && i % 15 === 0) await send("compact", { customInstructions: "Return a tiny summary." }, 20_000);
    if (i % 20 === 0) {
      if (!newOnly) await send("new_session");
      await Bun.sleep(30);
      samples.push(await procSample(child.pid, `post-new-${i}`));
    }
  }
  samples.push(await procSample(child.pid, "final"));
  child.stdin.end();
  const code = await child.exited;
  await stdoutTask;
  const stderr = await stderrTask;
  const report = {
    root,
    cycles,
    requestCount,
    exitCode: code,
    samples,
    eventCount: events.length,
    failedResponses: events.filter((e) => e.type === "response" && e.success === false),
    stderr,
  };
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  const unexpectedFailures = report.failedResponses.filter(
    (e: any) => e.command !== "compact" || !/Nothing to compact|Compaction cancelled/.test(e.error ?? ""),
  );
  if (code !== 0 || unexpectedFailures.length) process.exitCode = 1;
} catch (error) {
  // Kill only the exact PID spawned above; never use process-name matching.
  child.kill();
  console.error(error);
  console.error("artifacts: " + root);
  process.exitCode = 1;
} finally {
  server?.stop(true);
}
