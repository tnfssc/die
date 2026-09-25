#!/usr/bin/env bun
/** Installed die-web Stop smoke: real Chromium, Pi provider, loopback OpenAI fixture. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { once } from "node:events";

const repo = resolve(import.meta.dirname, "..");
const t3Source = process.env.DIE_T3_SOURCE ?? join(repo, ".cache/die-t3code");
const playwrightRoot = join(t3Source, "node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core");
const chromiumPath =
  process.env.DIE_WEB_CHROMIUM ??
  join(process.env.HOME ?? "", ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome");
const die = resolve(process.env.DIE_WEB_STOP_BINARY ?? process.env.DIE_WEB_BINARY ?? join(repo, "dist/die-bundled"));
const artifacts = join(repo, "artifacts");
const temp = await mkdtemp("/var/tmp/die-web-stop-");
await chmod(temp, 0o700);
const home = join(temp, "home");
const baseDir = join(home, ".die", "web");
const agentDir = join(temp, "pi-agent");
const processPidFile = join(temp, "owned-shell.pid");
const processSignalFile = join(temp, "owned-shell.signal");
await Promise.all([
  mkdir(join(baseDir, "userdata"), { recursive: true }),
  mkdir(join(agentDir, "extensions"), { recursive: true }),
  mkdir(artifacts, { recursive: true }),
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(v: unknown, message: string): asserts v {
  if (!v) throw new Error("die web Stop smoke assertion failed: " + message);
}
async function waitUntil<T>(probe: () => T | Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const end = Date.now() + timeoutMs;
  do {
    const value = await probe();
    if (value) return value;
    await sleep(100);
  } while (Date.now() < end);
  throw new Error("timed out waiting for " + label);
}
async function listen(server: ReturnType<typeof createServer>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  if (port === 13773) {
    server.close();
    await once(server, "close");
    return listen(server);
  }
  return port;
}
async function reservePort() {
  const s = createServer();
  const p = await listen(s);
  s.close();
  await once(s, "close");
  return p;
}
async function requestBody(req: IncomingMessage) {
  let value = "";
  for await (const c of req) value += c;
  return JSON.parse(value);
}
function eventChunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: "die-web-stop",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "loopback-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}
function finishSse(res: ServerResponse, delta: Record<string, unknown>, reason = "stop") {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  res.end(
    "data: " +
      JSON.stringify(eventChunk(delta)) +
      "\n\n" +
      "data: " +
      JSON.stringify(eventChunk({}, reason)) +
      "\n\ndata: [DONE]\n\n",
  );
}
function lastUser(payload: any): string {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const msg = [...messages].reverse().find((m: any) => m?.role === "user");
  if (typeof msg?.content === "string") return msg.content;
  return JSON.stringify(msg?.content ?? "");
}
async function alive(pid: number) {
  try {
    await stat("/proc/" + pid);
    return true;
  } catch {
    return false;
  }
}
async function procSnapshot(pid: number | undefined) {
  if (!pid) return { pid, alive: false };
  let status = "",
    cmdline = "";
  try {
    status = await readFile(`/proc/${pid}/status`, "utf8");
    cmdline = (await readFile(`/proc/${pid}/cmdline`)).toString().replace(/\0/g, " ");
  } catch {}
  return {
    pid,
    alive: await alive(pid),
    status: status.split("\n").filter((x) => /^(Name|State|Pid|PPid|NSpgid|NSsid):/.test(x)),
    cmdline,
  };
}

const requests: Array<{ at: string; latestUser: string; lastRole?: string; body: any }> = [];
const connections: Array<{ kind: string; opened: string; closed?: string; writableEnded?: boolean }> = [];
const heldResponses = new Set<ServerResponse>();
let serverOutput = "";
let backend: ChildProcess | undefined;
let browser: any;
let page: any;
const modelServer = createServer(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.writeHead(404);
      return res.end();
    }
    const payload: any = await requestBody(req);
    const user = lastUser(payload);
    const lastRole = payload.messages?.at(-1)?.role;
    requests.push({ at: new Date().toISOString(), latestUser: user, lastRole, body: payload });
    if (user.includes("STREAM_STOP_CASE")) {
      const c: (typeof connections)[number] = { kind: "stream", opened: new Date().toISOString() };
      connections.push(c);
      heldResponses.add(res);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(
        "data: " + JSON.stringify(eventChunk({ role: "assistant", content: "STREAM_BEGAN_AND_IS_HELD" })) + "\n\n",
      );
      res.once("close", () => {
        c.closed = new Date().toISOString();
        c.writableEnded = res.writableEnded;
        heldResponses.delete(res);
      });
      return;
    }
    if (user.includes("AFTER_STREAM_STOP"))
      return finishSse(res, { role: "assistant", content: "AFTER_STREAM_STOP_OK" });
    if (user.includes("TOOL_STOP_CASE")) {
      if (lastRole === "tool")
        return finishSse(res, { role: "assistant", content: "TOOL_RETURNED_NORMALLY_UNEXPECTED" });
      const command = `bash -c 'echo $$ > ${processPidFile}; trap "echo TERM >> ${processSignalFile}; exit 143" TERM; trap "echo INT >> ${processSignalFile}; exit 130" INT; sleep 120 & wait'`;
      const code = `const result = await shell(${JSON.stringify(command)}, { waitSeconds: 130, timeoutSeconds: 140 }); console.log(JSON.stringify(result));`;
      return finishSse(
        res,
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "die_web_stop_shell",
              type: "function",
              function: { name: "execute", arguments: JSON.stringify({ code }) },
            },
          ],
        },
        "tool_calls",
      );
    }
    if (user.includes("AFTER_TOOL_STOP")) return finishSse(res, { role: "assistant", content: "AFTER_TOOL_STOP_OK" });
    if (user.includes("BACKGROUND_WORKER_HOLD")) {
      const c: (typeof connections)[number] = { kind: "background-worker", opened: new Date().toISOString() };
      connections.push(c);
      heldResponses.add(res);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(
        "data: " + JSON.stringify(eventChunk({ role: "assistant", content: "BACKGROUND_WORKER_STREAM_HELD" })) + "\n\n",
      );
      res.once("close", () => {
        c.closed = new Date().toISOString();
        c.writableEnded = res.writableEnded;
        heldResponses.delete(res);
      });
      return;
    }
    if (user.includes("BACKGROUND_IDLE_CASE")) {
      if (lastRole === "tool") return finishSse(res, { role: "assistant", content: "BACKGROUND_PARENT_IDLE_OK" });
      const code =
        'const task = await subagent({ type: "fast", prompt: "BACKGROUND_WORKER_HOLD", waitSeconds: 0, timeoutSeconds: 120 }); console.log(JSON.stringify(task));';
      return finishSse(
        res,
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "die_web_stop_background",
              type: "function",
              function: { name: "execute", arguments: JSON.stringify({ code }) },
            },
          ],
        },
        "tool_calls",
      );
    }
    if (user.includes("AFTER_BACKGROUND_IDLE"))
      return finishSse(res, { role: "assistant", content: "AFTER_BACKGROUND_IDLE_OK" });
    return finishSse(res, { role: "assistant", content: "FIXTURE_UNMATCHED" });
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end(String(e));
  }
});

const modelPort = await listen(modelServer);
await writeFile(
  join(agentDir, "models.json"),
  JSON.stringify(
    {
      providers: {
        loopback: {
          baseUrl: `http://127.0.0.1:${modelPort}/v1`,
          api: "openai-completions",
          apiKey: "loopback-not-a-secret",
          models: [{ id: "loopback-model", name: "Loopback fixture", contextWindow: 32000, maxTokens: 2000 }],
        },
      },
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
await writeFile(
  join(agentDir, "settings.json"),
  JSON.stringify({ defaultProvider: "loopback", defaultModel: "loopback-model", defaultThinkingLevel: "off" }) + "\n",
  { mode: 0o600 },
);
await writeFile(
  join(agentDir, "subagents.json"),
  JSON.stringify({ fast: { model: "loopback/loopback-model", thinking: "off" } }, null, 2) + "\n",
  { mode: 0o600 },
);
await writeFile(
  join(baseDir, "userdata/settings.json"),
  JSON.stringify(
    {
      providerInstances: {
        pi: { driver: "pi", enabled: true, config: { binaryPath: die, customModels: ["loopback/loopback-model"] } },
      },
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);

const results: any = { candidateBinary: die, backend: "EMBEDDED", temp, scenarios: {} };
let readers: Promise<void>[] = [];
try {
  await Promise.all([access(die), access(chromiumPath), access(join(playwrightRoot, "index.mjs"))]);
  const port = await reservePort();
  const safeEnv: any = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    LANG: "C.UTF-8",
    HOME: home,
    TMPDIR: temp,
    PI_CODING_AGENT_DIR: agentDir,
    DIE_CODING_AGENT_DIR: agentDir,
    HERDR_ENV: "0",
    DIE_SUBAGENT_TYPE: "",
    DIE_SUBAGENT_DEPTH: "0",
    DIE_WEB_TASK_EVENTS: "1",
    DIE_WEB_DIE_BINARY: die,
  };
  backend = spawn(die, ["web", "--no-browser", "--port", String(port), "--auto-bootstrap-project-from-cwd"], {
    cwd: repo,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: safeEnv,
  });
  const consume = async (stream: NodeJS.ReadableStream) => {
    for await (const chunk of stream) serverOutput += chunk.toString();
  };
  readers = [consume(backend.stdout!), consume(backend.stderr!)];
  const appUrl = `http://127.0.0.1:${port}`;
  await waitUntil(
    async () => {
      try {
        return (await fetch(appUrl, { signal: AbortSignal.timeout(1500) })).ok;
      } catch {
        return false;
      }
    },
    20000,
    "installed web HTTP",
  );
  process.env.TMPDIR = temp;
  const { chromium } = await import(playwrightRoot + "/index.mjs");
  browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    env: safeEnv,
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  check(!page.url().includes("/pair") && !page.url().includes("token="), "unexpected auth redirect");
  const setup = page.getByRole("dialog").filter({ has: page.getByText("Set up T3 Code", { exact: true }) });
  if (await setup.getByText("Connect your computers", { exact: true }).count()) {
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    await setup.getByRole("button", { name: "Do not import projects", exact: true }).click();
    await setup.waitFor({ state: "hidden", timeout: 15000 });
  }
  if (!(await page.locator('[data-chat-provider-model-picker="true"]').count()))
    await page.getByText("New thread", { exact: true }).first().click();
  const composer = page.locator('[contenteditable="true"]').first();
  const send = async (text: string) => {
    await composer.fill(text);
    await page.getByRole("button", { name: "Send message" }).click();
  };
  const stop = page.getByRole("button", { name: "Stop generation", exact: true });

  await send("STREAM_STOP_CASE");
  await waitUntil(() => connections.some((x) => x.kind === "stream"), 10000, "held streaming model connection");
  await stop.waitFor({ state: "visible", timeout: 5000 });
  const streamBefore = {
    stopLabel: await stop.getAttribute("aria-label"),
    buttonTitle: await stop.getAttribute("title"),
    text: await page.locator("body").innerText(),
  };
  await stop.click();
  await stop.waitFor({ state: "hidden", timeout: 10000 });
  await waitUntil(() => connections.find((x) => x.kind === "stream")?.closed, 10000, "stream model connection close");
  await send("AFTER_STREAM_STOP");
  await page.getByText("AFTER_STREAM_STOP_OK", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  results.scenarios.streaming = {
    stopControl: streamBefore.stopLabel,
    visibleTextBeforeStop: streamBefore.text,
    connection: connections.find((x) => x.kind === "stream"),
    subsequentPrompt: "ok",
  };
  await page.screenshot({ path: join(artifacts, "die-web-stop-stream.png"), fullPage: true });

  await send("TOOL_STOP_CASE");
  const ownedPid = Number(
    await waitUntil(
      async () => {
        try {
          return (await readFile(processPidFile, "utf8")).trim();
        } catch {
          return "";
        }
      },
      15000,
      "owned shell pid",
    ),
  );
  await stop.waitFor({ state: "visible", timeout: 5000 });
  check(Number.isInteger(ownedPid) && ownedPid > 1, "owned shell marker did not contain a PID");
  const beforeProc = await procSnapshot(ownedPid);
  check(beforeProc.alive, "owned shell was not alive before Stop");
  await stop.click();
  await stop.waitFor({ state: "hidden", timeout: 10000 });
  await sleep(1500);
  const afterProc = await procSnapshot(ownedPid);
  let signalLog = "";
  try {
    signalLog = await readFile(processSignalFile, "utf8");
  } catch {}
  const stopControlsAfterParentInterrupt = await page.getByRole("button").evaluateAll((els: any[]) =>
    els
      .map((e: any) => ({
        text: (e.innerText || "").trim(),
        aria: e.getAttribute("aria-label"),
        title: e.getAttribute("title"),
      }))
      .filter((x: any) => JSON.stringify(x).toLowerCase().includes("stop")),
  );
  await page.screenshot({ path: join(artifacts, "die-web-stop-tool-parent-interrupt.png"), fullPage: true });
  let backgroundStopClicked = false;
  if (afterProc.alive) {
    const backgroundStop = page.getByRole("button", { name: "Stop", exact: true });
    await backgroundStop.first().waitFor({ state: "visible", timeout: 5000 });
    await backgroundStop.first().click();
    backgroundStopClicked = true;
    await waitUntil(
      async () => !(await procSnapshot(ownedPid)).alive,
      10000,
      "owned shell termination after background Stop",
    );
  }
  const afterBackgroundStopProc = await procSnapshot(ownedPid);
  check(!afterBackgroundStopProc.alive, "background Stop left owned shell running");
  try {
    signalLog = await readFile(processSignalFile, "utf8");
  } catch {}
  await send("AFTER_TOOL_STOP");
  await page.getByText("AFTER_TOOL_STOP_OK", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const followup = requests.find((r) => r.latestUser.includes("AFTER_TOOL_STOP"));
  check(JSON.stringify(followup?.body.messages).includes("TOOL_STOP_CASE"), "history was lost after background Stop");
  results.scenarios.tool = {
    ownedPid,
    beforeProc,
    afterParentStopProc: afterProc,
    terminatedByParentStop: !afterProc.alive,
    stopControlsAfterParentInterrupt,
    backgroundStopClicked,
    afterBackgroundStopProc,
    terminatedByBackgroundStop: !afterBackgroundStopProc.alive,
    signalLog,
    subsequentPrompt: "ok",
    uiText: await page.locator("body").innerText(),
  };
  await page.screenshot({ path: join(artifacts, "die-web-stop-tool.png"), fullPage: true });

  await send("BACKGROUND_IDLE_CASE");
  await page.getByText("BACKGROUND_PARENT_IDLE_OK", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await waitUntil(
    () => connections.some((x) => x.kind === "background-worker"),
    10000,
    "background worker model stream",
  );
  await page.waitForTimeout(500);
  const stopCount = await stop.count();
  const bgBody = await page.locator("body").innerText();
  results.scenarios.backgroundIdle = {
    parentText: "BACKGROUND_PARENT_IDLE_OK",
    stopGenerationControlCount: stopCount,
    workerConnection: connections.find((x) => x.kind === "background-worker"),
    exactUiBehavior: stopCount
      ? "Stop generation remains available"
      : "no Stop generation control while parent is idle",
  };
  await page.screenshot({ path: join(artifacts, "die-web-stop-background-idle.png"), fullPage: true });
  const backgroundStop = page.getByRole("button", { name: "Stop", exact: true }).first();
  await backgroundStop.waitFor({ state: "visible", timeout: 5000 });
  await backgroundStop.click();
  await waitUntil(
    () => connections.some((c) => c.kind === "background-worker" && c.closed),
    10000,
    "background worker connection abort",
  );
  check(
    connections.find((c) => c.kind === "background-worker")?.writableEnded === false,
    "worker stream was not aborted",
  );
  results.scenarios.backgroundIdle.stoppedByBackgroundControl = true;
  await send("AFTER_BACKGROUND_IDLE");
  await page.getByText("AFTER_BACKGROUND_IDLE_OK", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  results.scenarios.backgroundIdle.subsequentPrompt = "ok";
  results.scenarios.backgroundIdle.uiText = bgBody;

  results.passed = true;
  results.requestCount = requests.length;
  await writeFile(join(artifacts, "die-web-stop-ui.txt"), (await page.locator("body").innerText()) + "\n", {
    mode: 0o600,
  });
  console.log(
    "installed die web Stop smoke completed",
    JSON.stringify({
      stream: results.scenarios.streaming.connection,
      toolTerminatedByParentStop: results.scenarios.tool.terminatedByParentStop,
      toolTerminatedByBackgroundStop: results.scenarios.tool.terminatedByBackgroundStop,
      backgroundStopCount: stopCount,
    }),
  );
} catch (e) {
  results.passed = false;
  results.blocker = String(e);
  process.exitCode = 1;
  console.error(e);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(artifacts, "die-web-stop-failure.png"), fullPage: true }).catch(() => {});
    await writeFile(join(artifacts, "die-web-stop-ui.txt"), await page.locator("body").innerText()).catch(() => {});
  }
} finally {
  results.connections = connections;
  await writeFile(
    join(artifacts, "die-web-stop-requests.json"),
    JSON.stringify(
      requests.map((r) => ({
        at: r.at,
        latestUser: r.latestUser,
        lastRole: r.lastRole,
        model: r.body.model,
        messageCount: r.body.messages?.length,
      })),
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  await writeFile(
    join(artifacts, "die-web-stop-process.json"),
    JSON.stringify(results.scenarios.tool ?? {}, null, 2) + "\n",
    { mode: 0o600 },
  );
  await writeFile(join(artifacts, "die-web-stop-summary.json"), JSON.stringify(results, null, 2) + "\n", {
    mode: 0o600,
  });
  await writeFile(
    join(artifacts, "die-web-stop-server.log"),
    serverOutput.replace(/^(Token:).*$/gm, "$1 <redacted>").replace(/(token=)[^\s#]+/gi, "$1<redacted>"),
    { mode: 0o600 },
  );
  if (browser) await browser.close().catch(() => {});
  if (backend && backend.exitCode === null) {
    backend.kill("SIGTERM");
    await once(backend, "exit").catch(() => {});
  }
  for (const res of heldResponses) res.destroy();
  modelServer.close();
  await once(modelServer, "close").catch(() => {});
  await Promise.all(readers);
  if (process.env.DIE_WEB_KEEP_TEMP !== "1") await rm(temp, { recursive: true, force: true });
}
