#!/usr/bin/env bun
/**
 * Run deterministic T3-v2 browser acceptance against one server.
 *
 * Refuse to run without a named candidate. Make fresh state, start one candidate
 * backend, and drive its browser UI. Never import or edit an existing T3 database.
 */
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sourcePin from "../../web/t3-source.json";

type OwnedProcess = { pid: number; startTime: string };

const ROOT = resolve(import.meta.dirname, "../..");
const CANDIDATE = resolve(process.env.T3_V2_CANDIDATE ?? join(ROOT, ".cache/die-t3code-" + sourcePin.revision));
const DIE = resolve(process.env.T3_V2_DIE_BINARY ?? "");
const EXPECT_HEAD = process.env.T3_V2_EXPECT_CHECKOUT_HEAD ?? "";
const EXPECT_BINARY_SHA256 = process.env.T3_V2_EXPECT_BINARY_SHA256 ?? "";
const ARTIFACTS = resolve(process.env.T3_V2_BROWSER_ARTIFACTS ?? join(ROOT, "artifacts/t3-v2-production-browser"));
const MARK = {
  start: "T3V2_START_COMPLETE_CHILD",
  completePrompt: "T3V2_COMPLETE_CHILD_PROMPT",
  completeDone: "T3V2_COMPLETE_CHILD_DONE",
  parentArmed: "T3V2_PARENT_ARMED",
  parentWake: "T3V2_PARENT_WAKE_OBSERVED",
  startStop: "T3V2_START_STOP_CHILD",
  stopPrompt: "T3V2_STOP_CHILD_PROMPT",
  stopArmed: "T3V2_STOP_PARENT_ARMED",
  forbiddenStopDone: "T3V2_STOP_CHILD_SHOULD_NOT_FINISH",
} as const;

function fail(message: string): never {
  throw new Error("t3-v2 browser acceptance: " + message);
}
function check(value: unknown, message: string): asserts value {
  if (!value) fail(message);
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function waitUntil<T>(probe: () => T | Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await probe();
    if (value) return value;
    await sleep(100);
  } while (Date.now() < deadline);
  fail("timed out waiting for " + label);
}
async function command(argv: string[], cwd = ROOT) {
  const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "" } });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) fail(argv.join(" ") + " failed: " + stderr.trim());
  return stdout.trim();
}
async function sha256(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
async function worktreeSha256() {
  const [status, diff] = await Promise.all([
    command(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"], CANDIDATE),
    command(["git", "diff", "--binary", "HEAD", "--"], CANDIDATE),
  ]);
  const hash = createHash("sha256").update(status).update("\0").update(diff);
  for (const record of status
    .split("\0")
    .filter((item) => item.startsWith("?? "))
    .sort()) {
    const relative = record.slice(3);
    hash.update("\0" + relative + "\0").update(await readFile(join(CANDIDATE, relative)));
  }
  return hash.digest("hex");
}
function evidenceUrl(value: string) {
  const url = new URL(value);
  check(
    !/[?&#](?:token|access_token|auth|key|secret)=/i.test(value),
    "browser route contains private authentication material",
  );
  return url.toString();
}
function redact(value: string) {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1<redacted>")
    .replace(/((?:token|api[_-]?key|secret)\s*[:=]\s*)[^\s"']+/gi, "$1<redacted>")
    .replace(/^(Token:).*$/gim, "$1 <redacted>");
}
async function body(request: IncomingMessage) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return JSON.parse(text);
}
function sse(response: ServerResponse, delta: Record<string, unknown>, finishReason: string) {
  const base = {
    id: "t3-v2-production-browser",
    object: "chat.completion.chunk",
    created: 1,
    model: "t3-v2-deterministic",
  };
  const chunks = [
    { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
  ];
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  response.end(chunks.map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n").join("") + "data: [DONE]\n\n");
}
function tool(response: ServerResponse, id: string, code: string) {
  return sse(
    response,
    {
      role: "assistant",
      tool_calls: [
        { index: 0, id, type: "function", function: { name: "execute", arguments: JSON.stringify({ code }) } },
      ],
    },
    "tool_calls",
  );
}
async function listen(server: ReturnType<typeof createServer>) {
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
async function findPlaywrightRoot() {
  if (process.env.T3_V2_PLAYWRIGHT_ROOT) {
    const root = resolve(process.env.T3_V2_PLAYWRIGHT_ROOT);
    await access(join(root, "index.mjs"));
    return root;
  }
  const pnpm = join(CANDIDATE, "node_modules/.pnpm");
  const entries = await readdir(pnpm).catch(() => []);
  const entry = entries
    .sort()
    .reverse()
    .find((name) => name.startsWith("playwright-core@"));
  check(entry, "candidate dependencies are absent; coordinator must prepare them (harness will not install)");
  return join(pnpm, entry, "node_modules/playwright-core");
}
async function findChromium() {
  if (process.env.T3_V2_CHROMIUM) return resolve(process.env.T3_V2_CHROMIUM);
  const cache = join(process.env.HOME ?? "", ".cache/ms-playwright");
  for (const dir of (await readdir(cache).catch(() => []))
    .filter((x) => x.startsWith("chromium-"))
    .sort()
    .reverse()) {
    const path = join(cache, dir, "chrome-linux64/chrome");
    try {
      await access(path);
      return path;
    } catch {}
  }
  fail("Chromium not found; set T3_V2_CHROMIUM (harness will not download it)");
}
async function processIdentity(pid: number): Promise<OwnedProcess | undefined> {
  try {
    const statLine = await Bun.file(`/proc/${pid}/stat`).text();
    // comm may contain spaces and parentheses; fields after its final ") " start at field 3.
    const fields = statLine
      .slice(statLine.lastIndexOf(") ") + 2)
      .trim()
      .split(/\s+/);
    return { pid, startTime: fields[19] ?? "" };
  } catch {
    return undefined;
  }
}
async function directChildren(pid: number): Promise<number[]> {
  try {
    const value = await Bun.file(`/proc/${pid}/task/${pid}/children`).text();
    return value.trim() ? value.trim().split(/\s+/).map(Number).filter(Number.isSafeInteger) : [];
  } catch {
    return [];
  }
}
async function processTree(roots: number[]): Promise<OwnedProcess[]> {
  const pending = [...roots];
  const seen = new Set<number>();
  const result: OwnedProcess[] = [];
  while (pending.length) {
    const pid = pending.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const identity = await processIdentity(pid);
    if (!identity) continue;
    result.push(identity);
    pending.push(...(await directChildren(pid)));
  }
  return result;
}
async function assertExited(processes: OwnedProcess[]) {
  const live: OwnedProcess[] = [];
  for (const expected of processes) {
    const current = await processIdentity(expected.pid);
    if (current?.startTime === expected.startTime) live.push(expected);
  }
  check(live.length === 0, `owned processes survived teardown: ${live.map((item) => item.pid).join(", ")}`);
}

async function killOwned(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid!, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([once(child, "exit"), sleep(5_000)]).catch(() => {});
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await once(child, "exit").catch(() => {});
  }
}

// Fail closed before allocating state or starting any process.
check(
  process.env.T3_V2_ACCEPT_CANDIDATE === "1",
  "set T3_V2_ACCEPT_CANDIDATE=1 only after web/root workers declare a coherent candidate",
);
check(DIE && DIE !== ROOT, "set T3_V2_DIE_BINARY to the exact candidate executable");
check(EXPECT_HEAD, "set T3_V2_EXPECT_CHECKOUT_HEAD to the reviewed candidate commit");
check(EXPECT_BINARY_SHA256, "set T3_V2_EXPECT_BINARY_SHA256 to the reviewed executable digest");
await Promise.all([access(join(CANDIDATE, ".git")), access(DIE)]);
const [candidateReal, dieReal, checkoutHead, binaryHash, candidateWorktreeSha256] = await Promise.all([
  realpath(CANDIDATE),
  realpath(DIE),
  command(["git", "rev-parse", "HEAD"], CANDIDATE),
  sha256(DIE),
  worktreeSha256(),
]);
check(checkoutHead === EXPECT_HEAD, `candidate HEAD mismatch: expected ${EXPECT_HEAD}, got ${checkoutHead}`);
check(
  binaryHash === EXPECT_BINARY_SHA256,
  `candidate executable digest mismatch: expected ${EXPECT_BINARY_SHA256}, got ${binaryHash}`,
);
const bridgeHits = await command(["git", "grep", "-l", "T3_MCP_URL", "--", "apps", "packages"], CANDIDATE).catch(
  () => "",
);
check(bridgeHits, "candidate has no T3_MCP_URL bridge integration; migration is not coherent");
const [playwrightRoot, chromiumPath] = await Promise.all([findPlaywrightRoot(), findChromium()]);
await access(chromiumPath);

const temp = await mkdtemp(join(tmpdir(), "die-t3-v2-production-browser-"));
await chmod(temp, 0o700);
const home = join(temp, "home");
const baseDir = join(home, ".die/web");
const agentDir = join(temp, "agent");
await Promise.all([
  mkdir(join(baseDir, "userdata"), { recursive: true }),
  mkdir(join(agentDir, "extensions"), { recursive: true }),
  mkdir(ARTIFACTS, { recursive: true }),
]);
// Prove packaging with only the executable relocated. The backend/provider PATH
// contains ordinary OS tools but deliberately no node, bun, npm, pnpm or npx.
const runtimeBin = join(temp, "runtime-bin");
const workspace = join(temp, "workspace");
await Promise.all([mkdir(runtimeBin), mkdir(workspace)]);
const runtimeDie = join(runtimeBin, "die");
await copyFile(dieReal, runtimeDie);
await chmod(runtimeDie, 0o700);
for (const tool of ["sh", "bash", "fish", "git", "uname", "sleep", "mkdir", "printenv", "env", "ps", "cat"]) {
  const path = Bun.which(tool);
  if (path) await symlink(path, join(runtimeBin, tool));
}
for (const tool of ["node", "bun", "npm", "pnpm", "npx"])
  check(Bun.which(tool, { PATH: runtimeBin }) === null, "external runtime leaked into packaged PATH: " + tool);
await command(["git", "init", "--quiet", workspace]);
check((await sha256(runtimeDie)) === binaryHash, "relocated executable digest changed");
const requestKinds: string[] = [];
const modelTurnSummaries: string[] = [];
const modelServer = createServer(async (request, response) => {
  try {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ data: [] }));
    }
    const payload = await body(request);
    const serialized = JSON.stringify(payload);
    check(
      !/T3_MCP_(?:URL|BEARER_TOKEN|TOKEN)|authorization[\"']?\s*:\s*[\"']?bearer/i.test(serialized),
      "bridge credential/context leaked to model payload",
    );
    const lastMessage = payload.messages?.at(-1) ?? {};
    const last = JSON.stringify(lastMessage);
    const lastContent =
      typeof lastMessage.content === "string"
        ? lastMessage.content
        : Array.isArray(lastMessage.content)
          ? lastMessage.content.map((part: any) => (typeof part?.text === "string" ? part.text : "")).join("\n")
          : "";
    modelTurnSummaries.push(redact(last).slice(0, 4000));
    let kind = "unknown";
    // Classify by the newest message first: parent history deliberately contains
    // child prompt markers after launch and must not be mistaken for the child.
    if (lastContent.includes("reached a terminal state")) {
      const taskId = /jobs\.inspect\("([^"\n]+)"\)/.exec(lastContent)?.[1];
      check(taskId, "terminal notification omitted jobs.inspect task id");
      kind = serialized.includes("t3v2_launch_stop") ? "stop-parent-inspect" : "parent-inspect";
      requestKinds.push(kind);
      return tool(
        response,
        "t3v2_parent_inspect",
        `console.log(JSON.stringify(await jobs.inspect(${JSON.stringify(taskId)})));`,
      );
    }
    if (serialized.includes("t3v2_launch_stop") && /cancelled|canceled|interrupted/i.test(last)) {
      kind = "stop-parent-observed";
      requestKinds.push(kind);
      return sse(response, { role: "assistant", content: "T3V2_STOP_PARENT_CANCEL_OBSERVED" }, "stop");
    }
    if (last.includes(MARK.startStop)) {
      kind = "launch-stop";
      requestKinds.push(kind);
      return tool(
        response,
        "t3v2_launch_stop",
        `const child = await subagent({ type: "orchestrator", prompt: "${MARK.stopPrompt}: remain active until stopped by the browser acceptance", waitSeconds: 0 }); console.log(JSON.stringify({ marker: "T3V2_STOP_LAUNCHED", child }));`,
      );
    }
    if (last.includes(MARK.start)) {
      kind = "launch-complete";
      requestKinds.push(kind);
      return tool(
        response,
        "t3v2_launch_complete",
        `const child = await subagent({ type: "orchestrator", prompt: "${MARK.completePrompt}: run the deterministic delayed tool", waitSeconds: 0 }); console.log(JSON.stringify({ marker: "T3V2_COMPLETE_LAUNCHED", child }));`,
      );
    }
    if (last.includes(MARK.completeDone) && serialized.includes("t3v2_launch_complete")) {
      kind = "parent-wake";
      requestKinds.push(kind);
      return sse(response, { role: "assistant", content: MARK.parentWake }, "stop");
    }
    if (last.includes(MARK.completeDone)) {
      kind = "complete-child-finished";
      requestKinds.push(kind);
      return sse(response, { role: "assistant", content: MARK.completeDone }, "stop");
    }
    if (serialized.includes("t3v2_launch_stop") && !serialized.includes(MARK.stopArmed)) {
      kind = "stop-armed";
      requestKinds.push(kind);
      return sse(response, { role: "assistant", content: MARK.stopArmed }, "stop");
    }
    if (serialized.includes("t3v2_launch_complete") && !serialized.includes(MARK.parentArmed)) {
      kind = "complete-armed";
      requestKinds.push(kind);
      return sse(response, { role: "assistant", content: MARK.parentArmed }, "stop");
    }
    if (last.includes(MARK.stopPrompt) && !serialized.includes("t3v2_stop_wait")) {
      kind = "stop-child";
      requestKinds.push(kind);
      return tool(
        response,
        "t3v2_stop_wait",
        `await new Promise((done) => setTimeout(done, 120000)); console.log("T3V2_STOP_CHILD_" + "SHOULD_NOT_FINISH");`,
      );
    }
    if (last.includes(MARK.completePrompt) && !serialized.includes("t3v2_complete_wait")) {
      kind = "complete-child";
      requestKinds.push(kind);
      return tool(
        response,
        "t3v2_complete_wait",
        `console.log("T3V2_CHILD_RUNNING"); await new Promise((done) => setTimeout(done, 12000)); console.log("T3V2_COMPLETE_CHILD_" + "DONE");`,
      );
    }
    requestKinds.push(kind);
    return sse(response, { role: "assistant", content: "T3V2_UNEXPECTED_MODEL_ROUTE" }, "stop");
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end(redact(String(error)));
  }
});
const modelPort = await listen(modelServer);
await writeFile(
  join(agentDir, "models.json"),
  JSON.stringify(
    {
      providers: {
        deterministic: {
          baseUrl: `http://127.0.0.1:${modelPort}/v1`,
          api: "openai-completions",
          apiKey: "local-fixture",
          models: [{ id: "t3-v2-deterministic", name: "T3 v2 deterministic", contextWindow: 32000, maxTokens: 2000 }],
        },
      },
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
await writeFile(
  join(agentDir, "settings.json"),
  JSON.stringify({
    defaultProvider: "deterministic",
    defaultModel: "t3-v2-deterministic",
    defaultThinkingLevel: "off",
  }),
  { mode: 0o600 },
);
await writeFile(
  join(agentDir, "subagents.json"),
  JSON.stringify({ orchestrator: { model: "deterministic/t3-v2-deterministic", thinking: "off" } }),
  { mode: 0o600 },
);
await writeFile(
  join(baseDir, "userdata/settings.json"),
  JSON.stringify(
    {
      providerInstances: {
        pi: {
          driver: "pi",
          enabled: true,
          config: { binaryPath: runtimeDie, customModels: ["deterministic/t3-v2-deterministic"] },
        },
      },
    },
    null,
    2,
  ),
  { mode: 0o600 },
);

let backend: ChildProcess | undefined;
let browser: any;
let page: any;
let serverOutput = "";
let readers: Promise<void>[] = [];
let proof: any;
let browserRoots: number[] = [];
let observedBrowserProcesses: OwnedProcess[] = [];
let observedBackendProcesses: OwnedProcess[] = [];
try {
  const port = await reservePort();
  backend = spawn(runtimeDie, ["web", "--no-browser", "--port", String(port), "--auto-bootstrap-project-from-cwd"], {
    cwd: workspace,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: runtimeBin,
      LANG: "C.UTF-8",
      HOME: home,
      TMPDIR: temp,
      PI_CODING_AGENT_DIR: agentDir,
      DIE_CODING_AGENT_DIR: agentDir,
      HERDR_ENV: "0",
      DIE_SUBAGENT_TYPE: "",
      DIE_SUBAGENT_DEPTH: "0",
      DIE_WEB_TASK_EVENTS: "1",
      DIE_WEB_DIE_BINARY: runtimeDie,
    },
  });
  const consume = async (stream: NodeJS.ReadableStream) => {
    for await (const chunk of stream) {
      serverOutput += chunk.toString();
      if (serverOutput.length > 2_000_000) serverOutput = serverOutput.slice(-2_000_000);
    }
  };
  readers = [consume(backend.stdout!), consume(backend.stderr!)];
  const appUrl = `http://127.0.0.1:${port}`;
  await waitUntil(
    async () => {
      try {
        return (await fetch(appUrl, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        return false;
      }
    },
    30_000,
    "candidate HTTP listener",
  );
  process.env.TMPDIR = temp;
  const childrenBeforeBrowser = new Set(await directChildren(process.pid));
  const { chromium } = await import(playwrightRoot + "/index.mjs");
  browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    env: { ...process.env, TMPDIR: temp },
  });
  browserRoots = (await directChildren(process.pid)).filter(
    (pid) => !childrenBeforeBrowser.has(pid) && pid !== backend?.pid,
  );
  check(browserRoots.length > 0, "could not identify the owned Chromium process");
  observedBrowserProcesses = await processTree(browserRoots);
  check(observedBrowserProcesses.length > 0, "owned Chromium process exited before browser acceptance");
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const setup = page.getByRole("dialog").filter({ has: page.getByText("Set up T3 Code", { exact: true }) });
  if (await setup.count()) {
    for (const label of ["Continue", "Continue", "Do not import projects"]) {
      const button = setup.getByRole("button", { name: label, exact: true });
      if (await button.count()) await button.click();
    }
    await setup.waitFor({ state: "hidden", timeout: 15_000 });
  }
  if (!(await page.locator('[data-chat-provider-model-picker="true"]').count()))
    await page.getByText("New thread", { exact: true }).first().click();
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  const send = async (text: string) => {
    await composer.fill(text);
    const submit = page.locator('[data-chat-composer-surface="true"] button[type="submit"]').last();
    await submit.waitFor({ state: "visible", timeout: 10_000 });
    await submit.click();
  };
  const bodyText = () => page.locator("body").innerText();
  const clickChild = async (marker: string) => {
    const clickVisibleMatch = async (root: any) => {
      const matches = root.getByRole("button", { name: new RegExp(marker, "i") });
      for (let index = 0; index < (await matches.count()); index++) {
        const match = matches.nth(index);
        if (await match.isVisible().catch(() => false)) {
          await match.click();
          return true;
        }
      }
      return false;
    };
    if (await clickVisibleMatch(page)) return;
    const detailsToggles = page.getByRole("button", { name: "Toggle thread details panel" });
    for (let index = 0; index < (await detailsToggles.count()); index++) {
      const detailsToggle = detailsToggles.nth(index);
      if (!(await detailsToggle.isVisible().catch(() => false))) continue;
      if ((await detailsToggle.getAttribute("aria-pressed")) !== "true") await detailsToggle.click();
      break;
    }
    await page.getByText(/^Lineage/).waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForTimeout(500);
    if (await clickVisibleMatch(page)) return;
    const panel = page.locator("[data-thread-relationships-panel]");
    const runningRows = panel.locator("li").filter({ hasText: /Working|Running/i });
    const runningCount = await runningRows.count();
    const panelCount = await panel.count();
    const panelText = await panel.allInnerTexts();
    check(
      runningCount === 1,
      `could not uniquely locate live child ${marker} (panels=${panelCount}, runningRows=${runningCount}, text=${JSON.stringify(panelText)})`,
    );
    await runningRows.first().getByRole("button").first().click();
  };

  await send(MARK.start);
  await page.getByText(MARK.parentArmed, { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  const parentUrl = evidenceUrl(page.url());
  await clickChild(MARK.completePrompt);
  await page.waitForTimeout(500);
  const completeChildUrl = evidenceUrl(page.url());
  check(completeChildUrl !== parentUrl, "child relationship did not navigate");
  const runningText = await bodyText();
  check(runningText.includes(MARK.completePrompt), "actual running child transcript prompt is not rendered");
  check(/stop|running|working/i.test(runningText), "child was not visibly running when opened");
  await page.screenshot({ path: join(ARTIFACTS, "complete-child-running.png"), fullPage: true });
  await page.getByText(MARK.completeDone, { exact: false }).waitFor({ state: "visible", timeout: 30_000 });
  await page.goto(parentUrl, { waitUntil: "domcontentloaded" });
  await page.getByText(MARK.parentWake, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await send(MARK.startStop);
  await page.getByText(MARK.stopArmed, { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  await clickChild(MARK.stopPrompt);
  await page.waitForTimeout(500);
  const stopChildUrl = evidenceUrl(page.url());
  const beforeStop = await bodyText();
  check(beforeStop.includes(MARK.stopPrompt), "stop-child transcript is not rendered");
  const stop = page.getByRole("button", { name: /^Stop generation$/i }).first();
  await stop.waitFor({ state: "visible", timeout: 10_000 });
  await stop.click();
  await page
    .getByText(/^(Stopped|Cancelled|Canceled|Interrupted|Run interrupted)(?: by user)?$/i)
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
  check(!(await bodyText()).includes(MARK.forbiddenStopDone), "stopped child completed its blocked tool");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const refreshedStopUrl = evidenceUrl(page.url());
  check(
    new URL(refreshedStopUrl).origin === new URL(stopChildUrl).origin &&
      new URL(refreshedStopUrl).pathname === new URL(stopChildUrl).pathname,
    `refresh did not preserve exact child route: before=${stopChildUrl} after=${refreshedStopUrl}`,
  );
  const refreshedText = await bodyText();
  check(refreshedText.includes(MARK.stopPrompt), "refresh lost child transcript");
  check(
    await page.getByText(/^(Stopped|Cancelled|Canceled|Interrupted|Run interrupted)(?: by user)?$/i).count(),
    "refresh lost stopped state",
  );
  await page.screenshot({ path: join(ARTIFACTS, "stopped-child-refreshed.png"), fullPage: true });
  await page.waitForTimeout(1500);
  const expectedKinds = [
    "launch-complete",
    "complete-armed",
    "complete-child",
    "complete-child-finished",
    "parent-inspect",
    "parent-wake",
    "launch-stop",
    "stop-armed",
    "stop-child",
    "stop-parent-inspect",
    "stop-parent-observed",
  ];
  for (const kind of expectedKinds)
    check(requestKinds.filter((value) => value === kind).length === 1, `expected exactly one ${kind} model turn`);
  check(!requestKinds.includes("unknown"), "deterministic model received an unexpected route");
  check((await worktreeSha256()) === candidateWorktreeSha256, "candidate worktree changed during acceptance");
  observedBackendProcesses = await processTree([backend.pid!]);
  check(observedBackendProcesses.length > 0, "candidate backend exited before proof capture");
  proof = {
    passed: true,
    executable: dieReal,
    executableSha256: binaryHash,
    packagedRuntime: {
      executable: runtimeDie,
      relocatedOnlyExecutable: true,
      externalJavascriptRuntimesOnPath: false,
      workspace,
    },
    candidateCheckout: candidateReal,
    candidateHead: checkoutHead,
    candidateWorktreeSha256,
    backendPid: backend.pid,
    backendOrigin: appUrl,
    parentUrl,
    completeChildUrl,
    stopChildUrl,
    sameLiveServer: [parentUrl, completeChildUrl, stopChildUrl].every((url) => new URL(url).origin === appUrl),
    freshStateDirectory: temp,
    requestKinds,
    ownedPids: {
      backend: observedBackendProcesses.map((item) => item.pid),
      browser: observedBrowserProcesses.map((item) => item.pid),
    },
    assertions: [
      "fresh unseeded state",
      "one live candidate backend and browser origin",
      "native orchestrator child opened while running",
      "completion woke parent exactly once",
      "second live child stopped from browser",
      "exact stopped child route/transcript survived refresh",
    ],
    screenshots: ["complete-child-running.png", "stopped-child-refreshed.png"],
  };
  check(proof.sameLiveServer, "browser routes did not stay on candidate backend origin");
  await writeFile(join(ARTIFACTS, "proof.json"), JSON.stringify(proof, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(proof, null, 2));
} catch (error) {
  await writeFile(
    join(ARTIFACTS, "failure.json"),
    JSON.stringify(
      {
        passed: false,
        executable: dieReal,
        executableSha256: binaryHash,
        candidateCheckout: candidateReal,
        candidateHead: checkoutHead,
        candidateWorktreeSha256,
        backendPid: backend?.pid ?? null,
        error: redact(String(error)),
        requestKinds,
        modelTurnSummaries,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  await writeFile(join(ARTIFACTS, "server.redacted.log"), redact(serverOutput), { mode: 0o600 });
  if (page && !page.isClosed()) {
    await writeFile(join(ARTIFACTS, "failure-visible.txt"), await page.locator("body").innerText(), { mode: 0o600 });
    await page.screenshot({ path: join(ARTIFACTS, "failure.png"), fullPage: true });
  }
  throw error;
} finally {
  if (backend?.pid) observedBackendProcesses = await processTree([backend.pid]);
  if (browserRoots.length) {
    const finalBrowserTree = await processTree(browserRoots);
    const identities = new Map(observedBrowserProcesses.map((item) => [item.pid + ":" + item.startTime, item]));
    for (const item of finalBrowserTree) identities.set(item.pid + ":" + item.startTime, item);
    observedBrowserProcesses = [...identities.values()];
  }
  if (browser) await browser.close().catch(() => {});
  await killOwned(backend);
  await Promise.all(readers);
  await waitUntil(
    async () => {
      const all = [...observedBrowserProcesses, ...observedBackendProcesses];
      for (const expected of all) {
        const current = await processIdentity(expected.pid);
        if (current?.startTime === expected.startTime) return false;
      }
      return true;
    },
    10_000,
    "owned browser/backend process teardown",
  );
  await assertExited([...observedBrowserProcesses, ...observedBackendProcesses]);
  modelServer.close();
  await once(modelServer, "close").catch(() => {});
  if (process.env.T3_V2_KEEP_TEMP !== "1") await rm(temp, { recursive: true, force: true });
}
