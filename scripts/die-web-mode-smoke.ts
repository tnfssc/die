#!/usr/bin/env -S node --experimental-strip-types
/** Installed die web: real-browser mode acceptance. */
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";

const repo = resolve(import.meta.dirname, "..");
const t3Source = process.env.DIE_T3_SOURCE ?? join(process.env.HOME ?? "/root", ".cache/die-t3code");
const playwrightRoot = join(t3Source, "node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core");
const chromiumPath =
  process.env.DIE_WEB_CHROMIUM ?? "/home/tnfssc/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";
const die = resolve(process.env.DIE_WEB_MODE_BINARY ?? "/home/tnfssc/.local/bin/die");
const backendPath = join(dirname(die), "die-web/t3");
const artifacts = join(repo, "artifacts");
const temp = await mkdtemp("/var/tmp/die-web-mode-");
await chmod(temp, 0o700);
const home = join(temp, "home");
const baseDir = join(home, ".die", "web");
const agentDir = join(temp, "pi-agent");
await Promise.all([
  mkdir(join(baseDir, "userdata"), { recursive: true }),
  mkdir(join(agentDir, "extensions"), { recursive: true }),
  mkdir(artifacts, { recursive: true }),
]);

const MODEL = "mode-acceptance-fixture";
const MODES = ["fast", "normal", "orchestrator"] as const;
type Mode = (typeof MODES)[number];
const modeRequests: Array<Record<string, any>> = [];
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error("die web model smoke assertion failed: " + message);
}
function redact(text: string) {
  return text.replace(/^(Token:).*$/gm, "$1 <redacted>").replace(/(token=)[^\s#]+/gi, "$1<redacted>");
}
async function wsUpgrade(url: string, origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url + "/ws", {
      headers: {
        Origin: origin,
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
      },
    });
    req.once("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.once("response", (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.once("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("WebSocket upgrade timed out")));
    req.end();
  });
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
function sse(response: ServerResponse, model: string, content: string) {
  const base = {
    id: "die-web-mode-smoke",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
  };
  const chunks = [
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(chunks.map((x) => "data: " + JSON.stringify(x) + "\n\n").join("") + "data: [DONE]\n\n");
}

const requests = modeRequests;
let serverOutput = "";
let backend: ChildProcess | undefined;
let browser: any;
let page: any;
const modelServer = createServer(async (request, response) => {
  try {
    if (request.method !== "POST") {
      response.writeHead(404);
      response.end();
      return;
    }
    const payload = await body(request);
    requests.push(payload);
    const model = String(payload.model ?? "");
    if (model === MODEL) return sse(response, model, "MODE_RESPONSE_RENDERED");
    response.writeHead(400);
    response.end("unexpected fixture model");
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});

const modelPort = await listen(modelServer);
// Test the unmodified die runtime: no fabricated MCP capability extension.
await writeFile(
  join(agentDir, "models.json"),
  JSON.stringify(
    {
      providers: {
        loopback: {
          baseUrl: `http://127.0.0.1:${modelPort}/v1`,
          api: "openai-completions",
          apiKey: "local-fixture-only",
          models: [{ id: MODEL, name: "Mode Fixture", contextWindow: 32000, maxTokens: 2000, reasoning: true }],
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
  JSON.stringify({ defaultProvider: "loopback", defaultModel: MODEL, defaultThinkingLevel: "medium" }) + "\n",
  { mode: 0o600 },
);
await writeFile(
  join(baseDir, "userdata/settings.json"),
  JSON.stringify(
    {
      providerInstances: {
        pi: {
          driver: "pi",
          config: { binaryPath: die, customModels: [`loopback/${MODEL}`] },
        },
      },
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);

let outputReaders: Promise<void>[] = [];
try {
  await Promise.all([
    access(die),
    access(backendPath),
    access(chromiumPath),
    access(join(playwrightRoot, "index.mjs")),
  ]);
  const backendPort = await reservePort();
  const safePath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  const safeEnv = {
    PATH: safePath,
    LANG: "C.UTF-8",
    HOME: home,
    TMPDIR: temp,
  };
  backend = spawn(die, ["web", "--no-browser", "--port", String(backendPort), "--auto-bootstrap-project-from-cwd"], {
    cwd: repo,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...safeEnv,
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
      serverOutput += chunk.toString();
      await writeFile(join(temp, "server.log"), serverOutput, { mode: 0o600 });
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
  const localSession = await (
    await fetch(appUrl + "/api/auth/session", { headers: { Origin: appUrl }, signal: AbortSignal.timeout(5000) })
  ).json();
  check(localSession.authenticated === true, "same-origin HTTP still requires authentication");
  const unsafeHeaders: Record<string, string>[] = [
    { Origin: "http://evil.invalid" },
    { Origin: "null" },
    { Origin: "http://127.0.0.1:" + (backendPort + 1) },
    { Origin: "http://evil.invalid", Host: "evil.invalid" },
    { "Sec-Fetch-Site": "cross-site" },
  ];
  for (const headers of unsafeHeaders) {
    const blocked = await (
      await fetch(appUrl + "/api/auth/session", { headers, signal: AbortSignal.timeout(5000) })
    ).json();
    check(blocked.authenticated === false, "unsafe HTTP origin accepted");
  }
  check((await wsUpgrade(appUrl, appUrl)) === 101, "same-origin WebSocket requires credentials");
  check((await wsUpgrade(appUrl, "http://evil.invalid")) !== 101, "cross-origin WebSocket accepted");
  console.log("HTTP checks passed; launching browser");
  process.env.TMPDIR = temp;
  const { chromium } = await import(playwrightRoot + "/index.mjs");
  browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    env: safeEnv,
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

  // The mode control is intentionally found by its accessible name, not a label-only assertion.
  const modePicker = page.getByLabel("Die mode", { exact: true });
  await modePicker.waitFor({ state: "visible", timeout: 15_000 });
  const initialMode = (await modePicker.innerText()).toLowerCase();
  check(initialMode.includes("orchestrator"), "fresh default mode is orchestrator: " + initialMode);
  check(
    (await page.getByRole("button", { name: "medium", exact: true }).count()) === 1,
    "reasoning control is separate from mode",
  );
  const initialBody = await page.locator("body").innerText();
  check(!initialBody.includes("Full access"), "legacy Access control is absent");
  await modePicker.hover();
  await page.waitForTimeout(900);
  await modePicker.click();
  for (const mode of MODES)
    await page
      .getByText(new RegExp("^" + mode + "$", "i"))
      .last()
      .waitFor({ state: "visible", timeout: 5000 });
  check((await modePicker.getAttribute("aria-expanded")) === "true", "one click expands mode");
  for (const mode of MODES) {
    const option = page.getByRole("option", { name: new RegExp("^" + mode + "$", "i") });
    check(
      await option.evaluate((e: Element) => {
        const r = e.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
      }),
      "mode option is on screen without auto-scroll",
    );
  }
  await page.screenshot({ path: join(artifacts, "die-web-mode-picker.png"), fullPage: true });

  await page.keyboard.press("Escape");
  const composer = page.locator('[contenteditable="true"]').first();
  const systemFor = (request: (typeof requests)[number]) =>
    request.messages
      ?.filter((m: any) => m.role === "system" || m.role === "developer")
      .map((m: any) => m.content)
      .join("\n");
  const choose = async (mode: Mode) => {
    await composer.focus();
    await page.keyboard.press("Escape");
    await modePicker.hover();
    await page.waitForTimeout(900);
    await modePicker.click();
    await page
      .getByText(new RegExp("^" + mode + "$", "i"))
      .last()
      .click();
    await waitUntil(async () => (await modePicker.innerText()).toLowerCase().includes(mode), 5000, mode + " selected");
    const before = requests.length;
    const beforeReplies = await page.getByText("MODE_RESPONSE_RENDERED", { exact: true }).count();
    await composer.fill("Verify actual mode behavior for " + mode + ".");
    await page.getByRole("button", { name: "Send message" }).click();
    await waitUntil(() => requests.length > before, 15000, "actual model request");
    await waitUntil(
      async () => (await page.getByText("MODE_RESPONSE_RENDERED", { exact: true }).count()) > beforeReplies,
      15000,
      "new response rendered",
    );
    await page
      .getByRole("button", { name: "Stop generation", exact: true })
      .waitFor({ state: "hidden", timeout: 10000 });
    check(requests.length === before + 1, "mode preflight did not make an extra model request");
    check(requests.length > before && requests.at(-1)?.model === MODEL, mode + " prompt reached fixture HTTP model");
    return systemFor(requests.at(-1)!);
  };
  const systems: Partial<Record<Mode, unknown>> = {};
  systems.fast = await choose("fast");
  systems.normal = await choose("normal");
  systems.orchestrator = await choose("orchestrator");
  const fixtureModel = requests[0]?.model;
  const fixtureReasoning = requests[0]?.reasoning_effort;
  check(fixtureReasoning === "medium", "fixture requested actual medium reasoning");
  check(
    requests.every((r) => r.model === fixtureModel),
    "mode changes did not rewrite model",
  );
  check(
    requests.every((r) => JSON.stringify(r.reasoning_effort) === JSON.stringify(fixtureReasoning)),
    "mode changes did not rewrite reasoning",
  );
  check(!String(systems.fast).includes("You lead work. Give other agents"), "fast removes orchestrator guidance");
  check(!String(systems.normal).includes("You lead work. Give other agents"), "normal removes orchestrator guidance");
  check(
    String(systems.orchestrator).includes("You lead work. Give other agents"),
    "orchestrator adds distinct guidance to HTTP system instructions",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const reloadedModePicker = page.getByLabel("Die mode", { exact: true });
  await reloadedModePicker.waitFor({ state: "visible", timeout: 15_000 });
  check((await reloadedModePicker.innerText()).toLowerCase().includes("orchestrator"), "mode persisted after reload");
  // Reload a non-default selection: default-only checks can hide lost persistence.
  systems.normal = await choose("normal");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByLabel("Die mode", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  check(
    (await page.getByLabel("Die mode", { exact: true }).innerText()).toLowerCase().includes("normal"),
    "non-default mode persisted",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "More composer controls", exact: true }).click();
  for (const mode of MODES)
    await page
      .getByRole("menuitemradio", { name: new RegExp("^" + mode + "$", "i") })
      .waitFor({ state: "visible", timeout: 5000 });
  check(
    (await page.getByRole("menuitemradio", { name: "Full access", exact: true }).count()) === 0,
    "compact Access hidden",
  );
  await page.screenshot({ path: join(artifacts, "die-web-mode-compact.png"), fullPage: true });

  const beforeCompact = requests.length;
  const compactReplies = await page.getByText("MODE_RESPONSE_RENDERED", { exact: true }).count();
  await page.getByRole("menuitemradio", { name: /^fast$/i }).click();
  await page.keyboard.press("Escape");
  await composer.fill("Verify compact mode choice.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await waitUntil(() => requests.length > beforeCompact, 15000, "compact model request");
  await waitUntil(
    async () => (await page.getByText("MODE_RESPONSE_RENDERED", { exact: true }).count()) > compactReplies,
    15000,
    "compact reply",
  );
  check(requests.length === beforeCompact + 1, "compact selection does not call model separately");
  check(
    !String(systemFor(requests.at(-1)!)).includes("You lead work. Give other agents"),
    "compact fast uses real mode",
  );
  check(
    requests.at(-1)?.model === MODEL && requests.at(-1)?.reasoning_effort === "medium",
    "compact mode preserves model/reasoning",
  );
  const visibleText = await page.locator("body").innerText();
  await page.screenshot({ path: join(artifacts, "die-web-mode-final.png"), fullPage: true });
  await writeFile(join(artifacts, "die-web-mode-visible.txt"), visibleText + "\n", { mode: 0o600 });
  await writeFile(
    join(artifacts, "die-web-mode-requests.json"),
    JSON.stringify(
      {
        requests: requests.map((request, index) => ({
          index: index + 1,
          model: request.model,
          reasoning: request.reasoning_effort,
          system: systemFor(request),
        })),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  await writeFile(
    join(artifacts, "die-web-mode-summary.json"),
    JSON.stringify(
      {
        passed: true,
        installedBinary: die,
        installedBackend: backendPath,
        browser: "playwright 1.60 / chromium-1228",
        modes: MODES,
        systemInstructions: systems,
        persistedMode: "normal",
        requestCount: requests.length,
        screenshots: ["die-web-mode-picker.png", "die-web-mode-compact.png", "die-web-mode-final.png"],
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(`die web mode smoke passed: ${MODES.join(" -> ")}; ${requests.length} fixture requests`);
} catch (error) {
  await writeFile(join(artifacts, "die-web-mode-server.log"), redact(serverOutput), { mode: 0o600 });
  if (page && !page.isClosed()) {
    await writeFile(join(artifacts, "die-web-mode-visible.txt"), await page.locator("body").innerText(), {
      mode: 0o600,
    });
    await page.screenshot({ path: join(artifacts, "die-web-mode-failure.png"), fullPage: true });
  }
  await writeFile(
    join(artifacts, "die-web-mode-requests.json"),
    JSON.stringify(
      { passed: false, requests: requests.map((request, index) => ({ index: index + 1, model: request.model })) },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  await writeFile(
    join(artifacts, "die-web-mode-summary.json"),
    JSON.stringify({ passed: false, blocker: String(error), requestCount: requests.length }, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.error(error);
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
