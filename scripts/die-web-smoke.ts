#!/usr/bin/env -S node --experimental-strip-types
/** One isolated, real-browser acceptance for the die -> T3 -> die RPC bridge. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";

const repo = resolve(import.meta.dirname, "..");
const t3Source = process.env.DIE_T3_SOURCE ?? join(repo, "node_modules/.cache/die-t3code");
const playwrightRoot = join(t3Source, "node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core");
const chromiumPath =
  process.env.DIE_WEB_CHROMIUM ??
  join(process.env.HOME ?? "", ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome");
const die = resolve(process.env.DIE_WEB_SMOKE_BINARY ?? join(repo, "dist/die"));
const backendPath = join(dirname(die), "die-web/t3");
const artifacts = join(repo, "artifacts");
const temp = await mkdtemp("/var/tmp/die-web-smoke-");
await chmod(temp, 0o700);
const home = join(temp, "home");
const baseDir = join(home, ".die", "web");
const agentDir = join(temp, "pi-agent");
await Promise.all([
  mkdir(join(baseDir, "userdata"), { recursive: true }),
  mkdir(join(agentDir, "extensions"), { recursive: true }),
  mkdir(artifacts, { recursive: true }),
]);

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error("die web smoke assertion failed: " + message);
}
function redact(text: string) {
  return text.replace(/^(Token:).*$/gm, "$1 <redacted>").replace(/(token=)[^\s#]+/gi, "$1<redacted>");
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil<T>(probe: () => T | Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await probe();
    if (value) return value;
    await sleep(100);
  } while (Date.now() < deadline);
  throw new Error("timed out waiting for " + label);
}
function sse(response: ServerResponse, delta: Record<string, unknown>, finishReason: string) {
  const base = {
    id: "die-web-smoke",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "loopback-model",
  };
  const chunks = [
    { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
  ];
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(chunks.map((x) => "data: " + JSON.stringify(x) + "\n\n").join("") + "data: [DONE]\n\n");
}
async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as { port: number }).port;
}
async function reservePort() {
  const server = createServer();
  const port = await listen(server);
  server.close();
  await once(server, "close");
  return port;
}
async function body(request: IncomingMessage) {
  let value = "";
  for await (const chunk of request) value += chunk;
  return JSON.parse(value);
}

const requests: unknown[] = [];
let t3Output = "";
let backend: ChildProcess | undefined;
let browser: any;
let page: any;
let passed = false;
const modelServer = createServer(async (request, response) => {
  try {
    const payload: any = await body(request);
    requests.push(payload);
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const last = messages.at(-1) ?? {};
    const serialized = JSON.stringify(payload);
    const hasLaunch = serialized.includes("die_web_background_launch");
    if (!hasLaunch && serialized.includes("DIE_WEB_BROWSER_WORKER_PROMPT")) {
      await sleep(700);
      return sse(response, { role: "assistant", content: "DIE_WEB_BROWSER_WORKER_OK" }, "stop");
    }
    if (!hasLaunch) {
      const code = [
        'const task = await subagent({ type: "fast", prompt: "DIE_WEB_BROWSER_WORKER_PROMPT: reply exactly DIE_WEB_BROWSER_WORKER_OK", waitSeconds: 0, timeoutSeconds: 20 });',
        'let result; for (let i = 0; i < 80; i++) { result = await jobs.inspect(task.id); if (result.status !== "running") break; await new Promise((r) => setTimeout(r, 100)); }',
        "console.log(JSON.stringify({ started: task, completed: result }));",
      ].join("\n");
      return sse(
        response,
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "die_web_background_launch",
              type: "function",
              function: {
                name: "execute",
                arguments: JSON.stringify({ code }),
              },
            },
          ],
        },
        "tool_calls",
      );
    }
    return sse(response, { role: "assistant", content: "DIE_WEB_BROWSER_PARENT_OK" }, "stop");
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
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
  JSON.stringify({ defaultProvider: "loopback", defaultModel: "loopback-model", defaultThinkingLevel: "off" }),
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

let outputReaders: Promise<void>[] = [];
try {
  await Promise.all([access(die), access(backendPath), access(chromiumPath)]);
  const backendPort = await reservePort();
  backend = spawn(die, ["web", "--no-browser", "--port", String(backendPort), "--auto-bootstrap-project-from-cwd"], {
    cwd: repo,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      LANG: "C.UTF-8",
      TMPDIR: temp,
      HOME: home,
      PI_CODING_AGENT_DIR: agentDir,
      DIE_CODING_AGENT_DIR: agentDir,
      HERDR_ENV: "0",
      DIE_SUBAGENT_TYPE: "",
      DIE_SUBAGENT_DEPTH: "0",
      DIE_WEB_SERVER: backendPath,
      DIE_WEB_TASK_EVENTS: "1",
      DIE_WEB_DIE_BINARY: die,
    },
  });
  const consume = async (stream: NodeJS.ReadableStream) => {
    for await (const chunk of stream) {
      t3Output += chunk.toString();
      await writeFile(join(temp, "server.log"), t3Output, { mode: 0o600 });
    }
  };
  outputReaders = [consume(backend.stdout!), consume(backend.stderr!)];
  console.log("Backend spawned; waiting for HTTP");
  const appUrl = "http://127.0.0.1:" + backendPort;
  await waitUntil(
    async () => {
      try {
        return (await fetch(appUrl, { signal: AbortSignal.timeout(2000) })).ok;
      } catch {
        return false;
      }
    },
    20_000,
    "local HTTP listener",
  );
  console.log("HTTP checks passed; launching browser");
  process.env.TMPDIR = temp;
  const { chromium } = await import(playwrightRoot + "/index.mjs");
  browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    env: { ...process.env, TMPDIR: temp },
  });
  console.log("Browser launched");
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  console.log("Opening direct app URL");
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });

  await page.waitForTimeout(3000);
  check(!page.url().includes("/pair") && !page.url().includes("token="), "unexpected web authentication redirect");
  const setup = page.getByRole("dialog").filter({ has: page.getByText("Set up T3 Code", { exact: true }) });
  if (await setup.getByText("Connect your computers", { exact: true }).count()) {
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    await setup.getByRole("button", { name: "Do not import projects", exact: true }).click();
    await setup.waitFor({ state: "hidden", timeout: 15000 });
  }
  if (!(await page.locator('[data-chat-provider-model-picker="true"]').count())) {
    await page.getByText("New thread", { exact: true }).first().click();
  }
  // Fresh packaged startup creates the project/thread with the real Pi model.
  await writeFile(join(artifacts, "die-web-startup.txt"), await page.locator("body").innerText());
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.fill("Run the isolated browser background-agent acceptance.");
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByText("DIE_WEB_BROWSER_PARENT_OK", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: "Toggle right panel" }).click();
  await page.getByText("Agents", { exact: true }).last().click();
  await page.waitForTimeout(750);
  const visibleText = await page.locator("body").innerText();
  const launchToolResult = (
    requests.find(
      (r: any) => JSON.stringify(r).includes("die_web_background_launch") && r.messages?.at(-1)?.role === "tool",
    ) as any
  )?.messages?.at(-1)?.content;
  await writeFile(
    join(artifacts, "die-web-task-result.json"),
    JSON.stringify({ content: launchToolResult }, null, 2) + "\n",
    { mode: 0o600 },
  );
  const taskId = JSON.stringify(launchToolResult).match(/task_[a-f0-9]{8}/)?.[0];
  check(taskId, "no real background task ID appeared in model traffic");
  check(visibleText.includes("Agents"), "Agents surface is not visible");
  check(visibleText.toLowerCase().includes("direct spawns"), "Agents panel omitted the real direct spawn");
  check(visibleText.includes("Completed"), "Agents panel omitted completed status");
  check(visibleText.includes("settled"), "Agents panel omitted settled status");

  check(requests.length >= 3, "expected parent/tool/subagent loopback requests");
  await page.screenshot({ path: join(artifacts, "die-web-smoke.png"), fullPage: true });
  await writeFile(join(artifacts, "die-web-smoke.txt"), visibleText + "\n", { mode: 0o600 });
  await writeFile(
    join(artifacts, "die-web-requests.json"),
    JSON.stringify(
      { total: requests.length, backgroundTaskId: taskId, parentTurns: requests.length - 1, subagentTurns: 1 },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  await writeFile(
    join(artifacts, "die-web-summary.json"),
    JSON.stringify(
      {
        passed: true,
        browser: "chromium-1228",
        taskId,
        assertions: [
          "real browser chat completed",
          "real execute tool ran",
          "background subagent completed",
          "Agents panel showed real agent and settled status",
        ],
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  passed = true;
  console.log("die web browser smoke passed; task " + taskId + "; requests " + requests.length);
} catch (error) {
  await writeFile(join(artifacts, "die-web-server.log"), redact(t3Output), { mode: 0o600 });
  console.error(error);
  console.error(
    "loopback request count:",
    requests.length,
    "routes:",
    requests.map((r: any) => {
      const x = JSON.stringify(r);
      return {
        last: r.messages?.at(-1)?.role,
        launch: x.includes("die_web_background_launch"),
        worker: x.includes("DIE_WEB_BROWSER_WORKER_PROMPT"),
      };
    }),
  );
  if (page && !page.isClosed()) {
    await writeFile(join(artifacts, "die-web-smoke.txt"), await page.locator("body").innerText(), { mode: 0o600 });
    await page.screenshot({ path: join(artifacts, "die-web-smoke.png"), fullPage: true });
  }
  await writeFile(
    join(artifacts, "die-web-requests.json"),
    JSON.stringify({ total: requests.length, passed: false }, null, 2) + "\n",
    { mode: 0o600 },
  );
  await writeFile(
    join(artifacts, "die-web-summary.json"),
    JSON.stringify(
      { passed: false, browser: "chromium-1228", blocker: String(error), requestCount: requests.length },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (backend?.pid && backend.exitCode === null) {
    try {
      process.kill(-backend.pid, "SIGTERM");
    } catch {}
    await once(backend, "exit").catch(() => {});
  }
  await Promise.all(outputReaders);
  modelServer.close();
  await once(modelServer, "close").catch(() => {});
  if (process.env.DIE_WEB_KEEP_TEMP !== "1") await rm(temp, { recursive: true, force: true });
}
