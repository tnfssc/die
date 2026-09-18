#!/usr/bin/env node
/**
 * Isolated black-box lifecycle/retention probe for the bundled T3 web server.
 * No product files or real user state are touched. Requires Node >= 22 on Linux.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";

const ROOT = resolve(import.meta.dirname, "../..");
const SERVER = resolve(ROOT, ".cache/die-t3code/apps/server/dist/bin.mjs");
const opts = {
  sequential: Number(process.env.LEAK_SEQUENTIAL ?? 600),
  concurrentRounds: Number(process.env.LEAK_CONCURRENT_ROUNDS ?? 20),
  concurrentWidth: Number(process.env.LEAK_CONCURRENT_WIDTH ?? 20),
  held: Number(process.env.LEAK_HELD ?? 80),
  http: Number(process.env.LEAK_HTTP ?? 300),
  subscribe: process.env.LEAK_SUBSCRIBE !== "0",
};
const state = await mkdtemp(join(tmpdir(), "t3-web-leak-probe-"));
let child;
let inspector;
let accessToken;
let stopping = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`timeout: ${label}`);
    }),
  ]);

async function freePort() {
  const server = net.createServer();
  await new Promise((ok, no) => server.once("error", no).listen(0, "127.0.0.1", ok));
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port;
}
async function descendants(pid) {
  const seen = new Set(),
    queue = [pid];
  while (queue.length) {
    const p = queue.shift();
    let text = "";
    try {
      text = await readFile(`/proc/${p}/task/${p}/children`, "utf8");
    } catch {}
    for (const raw of text.trim().split(/\s+/))
      if (raw) {
        const n = Number(raw);
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
  }
  return [...seen];
}
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    inspector?.close();
  } catch {}
  if (child?.pid && child.exitCode == null) {
    const owned = await descendants(child.pid);
    try {
      child.kill("SIGTERM");
    } catch {}
    await Promise.race([new Promise((r) => child.once("exit", r)), sleep(5000)]);
    if (child.exitCode == null)
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {}
    // Only exact PIDs discovered beneath our exact child are considered owned.
    for (const pid of owned.reverse()) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  }
  if (process.env.LEAK_KEEP_STATE !== "1") await rm(state, { recursive: true, force: true });
}
process.once("SIGINT", async () => {
  await stop();
  process.exit(130);
});
process.once("SIGTERM", async () => {
  await stop();
  process.exit(143);
});

class Inspector {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }
  async open() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    };
    await withTimeout(
      new Promise((ok, no) => {
        this.ws.onopen = ok;
        this.ws.onerror = no;
      }),
      5000,
      "inspector open",
    );
  }
  call(method, params = {}) {
    const id = ++this.id;
    return withTimeout(
      new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.ws.send(JSON.stringify({ id, method, params }));
      }),
      10000,
      method,
    );
  }
  async eval(expression) {
    const r = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  close() {
    this.ws?.close();
  }
}
async function procStats(pid) {
  let fd = -1,
    tasks = -1,
    smaps = "";
  try {
    fd = (await readdir(`/proc/${pid}/fd`)).length;
  } catch {}
  try {
    tasks = (await readdir(`/proc/${pid}/task`)).length;
  } catch {}
  try {
    smaps = await readFile(`/proc/${pid}/smaps_rollup`, "utf8");
  } catch {}
  const kb = (key) => Number(smaps.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] ?? -1);
  return {
    fd,
    tasks,
    rssKb: kb("Rss"),
    pssKb: kb("Pss"),
    privateDirtyKb: kb("Private_Dirty"),
    descendants: await descendants(pid),
  };
}
async function sample(label) {
  await inspector.call("HeapProfiler.collectGarbage");
  await inspector.eval("global.gc(); global.gc(); true");
  await sleep(250);
  await inspector.call("HeapProfiler.collectGarbage");
  const runtime = await inspector.eval(`(() => ({
    memory: process.memoryUsage(),
    handles: Object.entries(process._getActiveHandles().reduce((a,h) => { const k=h?.constructor?.name || typeof h; a[k]=(a[k]||0)+1; return a }, {})),
    requests: Object.entries(process._getActiveRequests().reduce((a,h) => { const k=h?.constructor?.name || typeof h; a[k]=(a[k]||0)+1; return a }, {})),
    resources: process.getActiveResourcesInfo().reduce((a,k) => { a[k]=(a[k]||0)+1; return a }, {}),
  }))()`);
  const row = { label, at: new Date().toISOString(), ...runtime, proc: await procStats(child.pid) };
  results.samples.push(row);
  console.log(JSON.stringify(row));
  return row;
}
function socket(openSubscription = true) {
  return withTimeout(
    (async () => {
      const ticketResponse = await fetch(`http://127.0.0.1:${port}/api/auth/websocket-ticket`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!ticketResponse.ok) throw new Error(`ticket failed ${ticketResponse.status}: ${await ticketResponse.text()}`);
      const { ticket } = await ticketResponse.json();
      return await new Promise((resolveSocket, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/ws?wsTicket=${encodeURIComponent(ticket)}&clientOrigin=leak-audit`,
        );
        let settled = false;
        ws.onerror = (e) => {
          if (!settled) {
            settled = true;
            reject(e.error ?? new Error("websocket error"));
          }
        };
        ws.onopen = () => {
          if (!openSubscription) {
            settled = true;
            resolveSocket(ws);
            return;
          }
          ws.send(JSON.stringify({ _tag: "Request", id: 1, tag: "subscribeServerConfig", payload: {}, headers: [] }));
        };
        ws.onmessage = (e) => {
          if (!settled) {
            settled = true;
            results.subscriptionFrames++;
            results.firstFrame ??= String(e.data).slice(0, 500);
            resolveSocket(ws);
          }
        };
      });
    })(),
    8000,
    "application websocket + subscription",
  );
}
async function closeSocket(ws) {
  if (ws.readyState === WebSocket.CLOSED) return;
  try {
    ws.send(JSON.stringify({ _tag: "Interrupt", requestId: 1, interruptors: [] }));
  } catch {}
  const done = new Promise((r) => ws.addEventListener("close", r, { once: true }));
  ws.close();
  await Promise.race([done, sleep(1000)]);
}
async function churnOne() {
  const ws = await socket(opts.subscribe);
  await closeSocket(ws);
}

const port = await freePort();
const results = {
  version: 1,
  options: opts,
  state,
  port,
  pid: null,
  inspectorUrl: null,
  subscriptionFrames: 0,
  firstFrame: null,
  errors: [],
  samples: [],
};
try {
  const env = {
    ...process.env,
    HOME: state,
    XDG_CONFIG_HOME: join(state, "xdg-config"),
    XDG_STATE_HOME: join(state, "xdg-state"),
    XDG_CACHE_HOME: join(state, "xdg-cache"),
    T3CODE_HOME: state,
  };
  child = spawn(
    process.execPath,
    [
      "--expose-gc",
      "--inspect=127.0.0.1:0",
      SERVER,
      "serve",
      "--mode",
      "web",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--base-dir",
      state,
      "--no-browser",
      "--log-level",
      "error",
    ],
    { cwd: state, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  results.pid = child.pid;
  let stderr = "",
    stdout = "",
    inspectorUrl;
  child.stdout.on("data", (b) => {
    stdout += b;
    if (stdout.length > 65536) stdout = stdout.slice(-65536);
  });
  child.stderr.on("data", (b) => {
    stderr += b;
    if (stderr.length > 65536) stderr = stderr.slice(-65536);
    inspectorUrl ??= stderr.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];
  });
  child.once("exit", (code, sig) => {
    if (!stopping) results.errors.push(`server exited early: code=${code} signal=${sig}; stderr=${stderr}`);
  });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      if (r.ok && inspectorUrl) break;
    } catch {}
    await sleep(100);
  }
  if (!inspectorUrl) throw new Error(`no inspector URL: ${stderr}`);
  results.inspectorUrl = inspectorUrl;
  const bootstrap = stdout.match(/Token: ([A-Z0-9]+)/)?.[1];
  if (!bootstrap) throw new Error(`serve did not print bootstrap token: ${stdout}`);
  const tokenForm = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: bootstrap,
    subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    client_label: "isolated leak audit",
    client_device_type: "bot",
    client_os: process.platform,
  });
  const tokenResponse = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenForm,
    signal: AbortSignal.timeout(5000),
  });
  if (!tokenResponse.ok)
    throw new Error(`token exchange failed ${tokenResponse.status}: ${await tokenResponse.text()}`);
  accessToken = (await tokenResponse.json()).access_token;
  inspector = new Inspector(inspectorUrl);
  await inspector.open();
  await inspector.call("Runtime.enable");
  await inspector.call("HeapProfiler.enable");

  // Warm all per-WebSocket layer acquisition and subscription paths before baseline.
  for (let i = 0; i < 10; i++) await churnOne();
  await sample("baseline-after-warmup");

  for (let i = 0; i < opts.http; i += 20)
    await Promise.all(
      Array.from({ length: Math.min(20, opts.http - i) }, () =>
        fetch(`http://127.0.0.1:${port}/`).then((r) => r.arrayBuffer()),
      ),
    );
  await sample(`after-http-${opts.http}`);

  const checkpoints = new Set([Math.floor(opts.sequential / 2), opts.sequential]);
  for (let i = 1; i <= opts.sequential; i++) {
    await churnOne();
    if (checkpoints.has(i)) await sample(`after-sequential-ws-${i}`);
  }

  for (let round = 1; round <= opts.concurrentRounds; round++)
    await Promise.all(Array.from({ length: opts.concurrentWidth }, churnOne));
  await sample(`after-concurrent-ws-${opts.concurrentRounds * opts.concurrentWidth}`);

  const held = await Promise.all(Array.from({ length: opts.held }, () => socket(opts.subscribe)));
  await sample(`while-held-ws-${opts.held}`);
  await Promise.all(held.map(closeSocket));
  await sample(`after-held-ws-close-${opts.held}`);
  await sleep(5000);
  await sample(`after-quiescence-5s`);

  results.serverStdoutTail = stdout.slice(-4000);
  results.serverStderrTail = stderr.slice(-4000);
  const out = process.env.LEAK_OUTPUT || resolve(ROOT, ".agents/notes/leak-audit-web-runtime-results.json");
  await writeFile(out, JSON.stringify(results, null, 2) + "\n");
  console.log(`RESULT ${out}`);
} catch (error) {
  results.errors.push(error?.stack ?? String(error));
  console.error(error);
  process.exitCode = 1;
  const out = process.env.LEAK_OUTPUT || resolve(ROOT, ".agents/notes/leak-audit-web-runtime-results.json");
  await writeFile(out, JSON.stringify(results, null, 2) + "\n");
} finally {
  await stop();
}
