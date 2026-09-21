#!/usr/bin/env bun
/** Black-box preservation gates for an isolated packaged candidate. */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sourcePin from "../../web/t3-source.json";
const ROOT = resolve(import.meta.dirname, "../..");
const DIE = resolve(process.env.T3_V2_PACKAGED_BINARY || join(ROOT, "dist/die-t3-v2-candidate"));
const EXPECT = process.env.T3_V2_EXPECT_BINARY_SHA256 || "";
const CANDIDATE = resolve(process.env.T3_V2_CANDIDATE || join(ROOT, ".cache/die-t3code-" + sourcePin.revision));
const ARTIFACT = resolve(
  process.env.T3_V2_PRESERVATION_PROOF || join(ROOT, "artifacts/t3-v2-preservation-acceptance.json"),
);
const KEEP = process.env.T3_V2_KEEP_TEMP === "1";
const M = {
  completePrompt: "PRESERVE_LOCAL_SHELL_COMPLETE",
  completeStart: "PRESERVE_COMPLETE_START",
  completeDone: "PRESERVE_COMPLETE_DONE",
  completeSettled: "PRESERVE_COMPLETE_SETTLED",
  completeWake: "PRESERVE_COMPLETION_WAKE_RECEIVED",
  racePrompt: "PRESERVE_COMPLETION_RACING_USER",
  raceResponse: "PRESERVE_RACING_USER_ACCEPTED",
  nextPrompt: "PRESERVE_POST_COMPLETION_USER",
  nextResponse: "PRESERVE_POST_COMPLETION_ACCEPTED",
  pendingPrompt: "PRESERVE_LOCAL_SHELL_HANDOFF",
  pendingStart: "PRESERVE_PENDING_START",
  handoff: "PRESERVE_PENDING_HANDOFF",
  forbidden: "PRESERVE_PENDING_SHOULD_NOT_FINISH",
} as const;
function check(v: unknown, m: string): asserts v {
  if (!v) throw new Error("preservation acceptance: " + m);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => T | Promise<T>, ms: number, label: string): Promise<T> {
  const end = Date.now() + ms;
  let last;
  do {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(100);
  } while (Date.now() < end);
  throw new Error("preservation acceptance: timed out waiting for " + label + (last ? ": " + last : ""));
}
async function listen(s: ReturnType<typeof createServer>) {
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  return (s.address() as { port: number }).port;
}
async function requestBody(req: IncomingMessage) {
  let text = "";
  for await (const c of req) text += c;
  return JSON.parse(text);
}
function sse(res: ServerResponse, delta: Record<string, unknown>, finish: string) {
  const b = { id: "preservation", object: "chat.completion.chunk", created: 1, model: "preservation-deterministic" };
  const chunks = [
    { ...b, choices: [{ index: 0, delta, finish_reason: null }] },
    { ...b, choices: [{ index: 0, delta: {}, finish_reason: finish }] },
  ];
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  res.end(chunks.map((x) => "data: " + JSON.stringify(x) + "\n\n").join("") + "data: [DONE]\n\n");
}
function tool(res: ServerResponse, id: string, code: string) {
  sse(
    res,
    {
      role: "assistant",
      tool_calls: [
        { index: 0, id, type: "function", function: { name: "execute", arguments: JSON.stringify({ code }) } },
      ],
    },
    "tool_calls",
  );
}
async function playwrightRoot() {
  const p = join(CANDIDATE, "node_modules/.pnpm");
  const e = (await readdir(p))
    .filter((x) => x.startsWith("playwright-core@"))
    .sort()
    .reverse()[0];
  check(e, "playwright-core missing");
  return join(p, e, "node_modules/playwright-core");
}
async function chromiumPath() {
  if (process.env.T3_V2_CHROMIUM) return resolve(process.env.T3_V2_CHROMIUM);
  const p = join(process.env.HOME || "", ".cache/ms-playwright");
  for (const d of (await readdir(p).catch(() => []))
    .filter((x) => x.startsWith("chromium-"))
    .sort()
    .reverse()) {
    const c = join(p, d, "chrome-linux64/chrome");
    try {
      await access(c);
      return c;
    } catch {}
  }
  throw new Error("preservation acceptance: Chromium unavailable; set T3_V2_CHROMIUM");
}
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const redact = (s: string) => s.replace(/(token|authorization|api[_-]?key)([\s:=\"']+)[^\s\"']+/gi, "$1$2<redacted>");
check(process.env.T3_V2_ACCEPT_CANDIDATE === "1", "set T3_V2_ACCEPT_CANDIDATE=1 after selecting candidate");
const source = await Bun.file(DIE).bytes(),
  binarySha256 = hash(source);
check(!EXPECT || EXPECT === binarySha256, "binary digest mismatch: expected " + EXPECT + ", got " + binarySha256);
const temp = await mkdtemp(join(tmpdir(), "die-t3-v2-preservation-"));
await chmod(temp, 0o700);
const home = join(temp, "home"),
  baseDir = join(home, ".die/web"),
  agentDir = join(temp, "agent"),
  workspace = join(temp, "workspace"),
  bin = join(temp, "bin"),
  runtimeDie = join(bin, "die");
await Promise.all([
  mkdir(join(baseDir, "userdata"), { recursive: true }),
  mkdir(join(agentDir, "extensions"), { recursive: true }),
  mkdir(workspace, { recursive: true }),
  mkdir(bin, { recursive: true }),
  mkdir(resolve(ARTIFACT, ".."), { recursive: true }),
]);
await copyFile(DIE, runtimeDie);
await chmod(runtimeDie, 0o700);
check(hash(await Bun.file(runtimeDie).bytes()) === binarySha256, "relocated digest changed");
for (const n of ["sh", "bash", "fish", "git", "sleep", "printf", "env", "uname"]) {
  const p = Bun.which(n);
  if (p) await symlink(p, join(bin, n));
}
for (const n of ["node", "bun", "npm", "pnpm", "npx"])
  check(Bun.which(n, { PATH: bin }) === null, "external JS runtime on packaged PATH: " + n);
check(Bun.spawnSync([Bun.which("git")!, "init", "--quiet", workspace]).exitCode === 0, "temporary git init failed");
const requests: string[] = [];
const requestTimeline: Array<{ at: string; route: string }> = [];
function recordRequest(route: string) {
  requests.push(route);
  requestTimeline.push({ at: new Date().toISOString(), route });
}
const model = createServer(async (req, res) => {
  try {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: [] }));
    }
    const p = await requestBody(req),
      all = JSON.stringify(p),
      last = JSON.stringify(p.messages?.at(-1) || {});
    if (last.includes(M.racePrompt)) {
      recordRequest("racing-user");
      return sse(res, { role: "assistant", content: M.raceResponse }, "stop");
    }
    if (last.includes(M.nextPrompt)) {
      recordRequest("next-user");
      return sse(res, { role: "assistant", content: M.nextResponse }, "stop");
    }
    if (last.includes(M.pendingPrompt) && !all.includes("preserve_pending_tool")) {
      recordRequest("pending-tool");
      return tool(
        res,
        "preserve_pending_tool",
        "const job=await shell(\"printf '" +
          M.pendingStart +
          "\\\\n'; sleep 120; printf '" +
          M.forbidden +
          '\\\\n\'", { waitSeconds: 0 }); await handoff("' +
          M.handoff +
          ' job="+job.id);',
      );
    }
    if (last.includes(M.completePrompt) && !all.includes("preserve_complete_tool")) {
      recordRequest("complete-tool");
      return tool(
        res,
        "preserve_complete_tool",
        "const job=await shell(\"printf '" +
          M.completeStart +
          "\\\\n'; sleep 5; printf '" +
          M.completeDone +
          "\\\\n'\", { waitSeconds: 1 }); console.log(JSON.stringify(job));",
      );
    }
    if (last.includes("asynchronous task completed") && last.includes(M.completeDone)) {
      recordRequest("complete-wake");
      return sse(res, { role: "assistant", content: M.completeWake }, "stop");
    }
    if (all.includes("preserve_complete_tool")) {
      recordRequest("complete-settled");
      return sse(res, { role: "assistant", content: M.completeSettled }, "stop");
    }
    recordRequest("unexpected");
    return sse(res, { role: "assistant", content: "PRESERVE_UNEXPECTED_ROUTE" }, "stop");
  } catch (e) {
    res.writeHead(500);
    res.end(redact(String(e)));
  }
});
const modelPort = await listen(model);
await writeFile(
  join(agentDir, "models.json"),
  JSON.stringify(
    {
      providers: {
        deterministic: {
          baseUrl: "http://127.0.0.1:" + modelPort + "/v1",
          api: "openai-completions",
          apiKey: "isolated-fixture",
          models: [
            {
              id: "preservation-deterministic",
              name: "Preservation deterministic",
              contextWindow: 32000,
              maxTokens: 2000,
            },
          ],
        },
      },
    },
    null,
    2,
  ),
);
await writeFile(
  join(agentDir, "settings.json"),
  JSON.stringify({
    defaultProvider: "deterministic",
    defaultModel: "preservation-deterministic",
    defaultThinkingLevel: "off",
  }),
);
await writeFile(
  join(baseDir, "userdata/settings.json"),
  JSON.stringify(
    {
      preservationSentinel: { keep: true },
      providerInstances: {
        pi: {
          driver: "pi",
          enabled: true,
          config: { binaryPath: runtimeDie, customModels: ["deterministic/preservation-deterministic"] },
        },
      },
    },
    null,
    2,
  ),
);
let backend: ChildProcess | undefined,
  browser: any,
  page: any,
  output = "";
const wsReceived: string[] = [],
  wsSent: string[] = [];
const proof: any = { passed: false, startedAt: new Date().toISOString(), binarySha256, temp };
function lifecycleTrace() {
  const db = new Database(join(baseDir, "userdata/statev2.sqlite"), { readonly: true });
  try {
    const events = db
      .query("SELECT occurred_at, event_type, payload_json FROM orchestration_events ORDER BY sequence")
      .all() as Array<{ occurred_at: string; event_type: string; payload_json: string }>;
    return events.map((event) => {
      const payload = JSON.parse(event.payload_json);
      return {
        at: event.occurred_at,
        event: event.event_type,
        status: payload.status,
        id: payload.id,
        lastError: payload.lastError,
      };
    });
  } finally {
    db.close();
  }
}
try {
  const reserve = createServer(),
    port = await listen(reserve);
  reserve.close();
  await once(reserve, "close");
  backend = spawn(
    runtimeDie,
    [
      "web",
      "--no-browser",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--base-dir",
      baseDir,
      "--auto-bootstrap-project-from-cwd",
    ],
    {
      cwd: workspace,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        HOME: home,
        TMPDIR: temp,
        PATH: bin,
        LANG: "C.UTF-8",
        PI_CODING_AGENT_DIR: agentDir,
        DIE_CODING_AGENT_DIR: agentDir,
        HERDR_ENV: "0",
        DIE_SUBAGENT_TYPE: "",
        DIE_SUBAGENT_DEPTH: "0",
        DIE_WEB_TASK_EVENTS: "1",
        DIE_WEB_DIE_BINARY: runtimeDie,
      },
    },
  );
  for (const stream of [backend.stdout!, backend.stderr!])
    void (async () => {
      for await (const c of stream) {
        output += c.toString();
        if (output.length > 1000000) output = output.slice(-1000000);
      }
    })();
  const origin = "http://127.0.0.1:" + port;
  await waitFor(
    async () => {
      try {
        return (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        return false;
      }
    },
    30000,
    "packaged HTTP listener",
  );
  const [pw, chrome] = await Promise.all([playwrightRoot(), chromiumPath()]);
  process.env.TMPDIR = temp;
  const { chromium } = await import(pw + "/index.mjs");
  browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    env: { ...process.env, TMPDIR: temp },
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("websocket", (socket: any) => {
    const text = (x: any) => (typeof x.payload === "string" ? x.payload : Buffer.from(x.payload).toString("utf8"));
    socket.on("framereceived", (x: any) => wsReceived.push(text(x)));
    socket.on("framesent", (x: any) => wsSent.push(text(x)));
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const setup = page.getByRole("dialog").filter({ has: page.getByText("Set up T3 Code", { exact: true }) });
  if (await setup.count()) {
    for (const label of ["Continue", "Continue", "Do not import projects"]) {
      const b = setup.getByRole("button", { name: label, exact: true });
      if (await b.count()) await b.click();
    }
    await setup.waitFor({ state: "hidden", timeout: 15000 });
  }
  if (!(await page.locator('[data-chat-provider-model-picker="true"]').count()))
    await page.getByText("New thread", { exact: true }).first().click();
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.waitFor({ state: "visible", timeout: 15000 });
  const send = async (text: string) => {
      await composer.fill(text);
      await page.locator('[data-chat-composer-surface="true"] button[type="submit"]').last().click();
    },
    bodyText = () => page.locator("body").innerText();
  await page.getByRole("button", { name: "Toggle terminal drawer", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Terminal input", exact: true });
  await input.waitFor({ state: "visible", timeout: 15000 });
  const canvas = page.locator(".thread-terminal-drawer canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 10000 });
  const before = await canvas.evaluate((e: HTMLCanvasElement) => ({ width: e.width, height: e.height }));
  await page.waitForTimeout(900);
  const terminalMarker = "PRESERVE_PTY_" + crypto.randomUUID().replaceAll("-", "");
  const octal = [...Buffer.from(terminalMarker)].map((b) => "\\" + b.toString(8).padStart(3, "0")).join("");
  await input.focus();
  await input.pressSequentially("sleep 1; printf '" + octal + "\\n'", { delay: 15 });
  await input.press("Enter");
  const terminalOutput = () =>
    wsReceived
      .flatMap((f) => {
        try {
          return (JSON.parse(f).values || []).filter((x: any) => x.type === "output").map((x: any) => x.data);
        } catch {
          return [];
        }
      })
      .join("");
  await waitFor(() => terminalOutput().includes(terminalMarker), 15000, "delayed PTY output marker");
  await page.setViewportSize({ width: 1170, height: 760 });
  const after = await waitFor(
    async () => {
      const a = await canvas.evaluate((e: HTMLCanvasElement) => ({ width: e.width, height: e.height }));
      return before.width !== a.width || before.height !== a.height ? a : false;
    },
    10000,
    "terminal canvas resize",
  );
  await page.getByRole("button", { name: "Toggle terminal drawer", exact: true }).click();
  await send(M.completePrompt);
  const runningCardObserved = await waitFor(
    async () => {
      const t = await bodyText();
      return t.includes(M.completePrompt) && /Running printf/i.test(t);
    },
    12000,
    "running local-shell card",
  ).then(
    () => true,
    () => false,
  );
  const runningCardText = await bodyText();
  const completedOutputObserved = await waitFor(
    async () => /Ran printf/i.test(await bodyText()),
    10000,
    "terminal local-shell card",
  ).then(
    () => true,
    () => false,
  );
  await page
    .getByText(M.completeSettled, { exact: true })
    .waitFor({ state: "visible", timeout: 10000 })
    .catch(() => {});
  const completedCardText = await bodyText();
  const completedCardRetained = completedOutputObserved && completedCardText.includes(M.completePrompt);

  await send(M.racePrompt);
  await page.getByText(M.raceResponse, { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  const completionWakeObserved = await page
    .getByText(M.completeWake, { exact: true })
    .waitFor({ state: "visible", timeout: 15000 })
    .then(
      () => true,
      () => false,
    );
  check(completionWakeObserved, "local shell completion did not reach an owned parent wake");
  check(requests.filter((route) => route === "complete-wake").length === 1, "completion wake must be exactly once");

  await send(M.nextPrompt);
  await page.getByText(M.nextResponse, { exact: true }).waitFor({ state: "visible", timeout: 15000 });

  await send(M.pendingPrompt);
  const handoffObserved = await page
    .getByText(M.handoff, { exact: false })
    .waitFor({ state: "visible", timeout: 15000 })
    .then(
      () => true,
      () => false,
    );
  const pendingStartObserved = await page
    .getByText(M.pendingStart, { exact: false })
    .waitFor({ state: "visible", timeout: 10000 })
    .then(
      () => true,
      () => false,
    );
  await page.waitForTimeout(2500);
  const pendingText = await bodyText();
  const handoffRequested = requests.includes("pending-tool");
  const pendingAfterHandoff =
    handoffRequested && /Running printf/i.test(pendingText) && !pendingText.includes(M.forbidden);
  const historyUrl = page.url();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const reloaded = await bodyText();
  const historyAfterReload =
    reloaded.includes(M.pendingPrompt) && /Running printf/i.test(reloaded) && page.url() === historyUrl;
  const settings = JSON.parse(await readFile(join(baseDir, "userdata/settings.json"), "utf8"));
  const settingsPreserved =
    settings.preservationSentinel?.keep === true && settings.providerInstances?.pi?.config?.binaryPath === runtimeDie;
  const lifecycleTimeline = lifecycleTrace();
  const unsolicitedActivity = lifecycleTimeline.some((event) => event.lastError?.includes("outside an active T3 turn"));
  const failedRuns = lifecycleTimeline.filter((event) => event.event === "run.updated" && event.status === "failed");
  const requiredGatesPassed =
    runningCardObserved &&
    completedCardRetained &&
    completionWakeObserved &&
    pendingAfterHandoff &&
    historyAfterReload &&
    settingsPreserved &&
    !unsolicitedActivity &&
    failedRuns.length === 0;
  Object.assign(proof, {
    passed: requiredGatesPassed,
    completedAt: new Date().toISOString(),
    origin,
    requests,
    requestTimeline,
    ownership: {
      completionWakeObserved,
      unsolicitedActivity,
      failedRuns: failedRuns.length,
      racingUserAccepted: requests.includes("racing-user"),
      nextUserAccepted: requests.includes("next-user"),
    },
    lifecycleTimeline,
    terminal: {
      marker: terminalMarker,
      delayedInputMs: 1000,
      before,
      after,
      receivedFrameCount: wsReceived.length,
      sentFrameCount: wsSent.length,
      transport: "production browser WebSocket terminal APIs",
      passed: true,
    },
    localShell: {
      runningCardObserved,
      completedOutputObserved,
      completedCardRetained,
      handoffObserved,
      handoffRequested,
      pendingStartObserved,
      pendingAfterHandoff,
      historyAfterReload,
      runningVisibleText: runningCardText.slice(-4000),
      completedVisibleText: completedCardText.slice(-4000),
      pendingVisibleText: pendingText.slice(-4000),
      reloadedVisibleText: reloaded.slice(-4000),
    },
    runtimeModel: {
      provider: "deterministic",
      model: "preservation-deterministic",
      thinking: "off",
      settingsPreserved,
    },
    coverage: {
      proven: [
        "terminal-delayed-input-output",
        "terminal-resize",
        "isolated-runtime-model-settings",
        ...(runningCardObserved ? ["execute-shell-running-card-observable"] : []),
        ...(pendingAfterHandoff ? ["pending-local-shell-liveness-after-handoff"] : []),
        ...(historyAfterReload ? ["pending-shell-history-after-reload"] : []),
      ],
      failed: [
        ...(!runningCardObserved ? ["execute-shell-running-card-observable"] : []),
        ...(!completedCardRetained ? ["execute-shell-completed-card-retained"] : []),
        ...(!pendingAfterHandoff ? ["pending-local-shell-liveness-after-handoff"] : []),
        ...(!historyAfterReload ? ["thread-card-history-after-reload"] : []),
      ],
      notProven: ["manual-or-automatic-compaction", "token-or-cost-accounting", "mode-switch-history"],
    },
  });
  await writeFile(ARTIFACT, JSON.stringify(proof, null, 2) + "\n", { mode: 0o600 });
  if (!requiredGatesPassed) throw new Error("required local-shell adoption gates failed; see proof artifact");
  console.log("preservation acceptance: PASS sha256=" + binarySha256 + " proof=" + ARTIFACT);
} catch (e) {
  proof.error = redact(String(e));
  proof.requests = requests;
  proof.requestTimeline = requestTimeline;
  try {
    proof.lifecycleTimeline = lifecycleTrace();
  } catch {}
  if (page && !page.isClosed())
    proof.visibleText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
  proof.serverOutput = redact(output);
  await writeFile(ARTIFACT, JSON.stringify(proof, null, 2) + "\n", { mode: 0o600 });
  throw e;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (backend?.pid) {
    try {
      process.kill(-backend.pid, "SIGTERM");
    } catch {}
    await Promise.race([once(backend, "exit"), sleep(8000)]).catch(() => {});
    try {
      process.kill(-backend.pid, "SIGKILL");
    } catch {}
  }
  model.close();
  await once(model, "close").catch(() => {});
  if (!KEEP) await rm(temp, { recursive: true, force: true });
  else console.error("preserved temp: " + temp);
}
