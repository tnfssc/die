#!/usr/bin/env node
// Audit the shipped Bun executable and its embedded web backend. Linux /proc only.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";

const ROOT = resolve(import.meta.dirname, "../..");
const BINARY = resolve(ROOT, "dist/die");
const PINNED_TREE = resolve(ROOT, ".cache/die-t3code-v0042");
const EXPECTED_PIN = "719a76ca1dbf5490f1aa33ffb9966301e02be9a9";
const OUT = process.env.LEAK_OUTPUT || resolve(ROOT, ".agents/notes/leak-audit-bundled-web-results.json");
const opts = { cycles: Number(process.env.LEAK_CYCLES ?? 600), held: Number(process.env.LEAK_HELD ?? 64) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeout = (p, ms, what) =>
  Promise.race([
    p,
    sleep(ms).then(() => {
      throw new Error("timeout: " + what);
    }),
  ]);
const sha256 = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

async function freePort() {
  const server = net.createServer();
  await new Promise((ok, no) => server.once("error", no).listen(0, "127.0.0.1", ok));
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port;
}
async function identity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
    return {
      pid,
      ppid: Number(fields[1]),
      startTime: fields[19],
      cmdline: (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " ").trim(),
    };
  } catch {
    return null;
  }
}
async function descendants(rootPid) {
  const found = new Map(),
    queue = [rootPid];
  while (queue.length) {
    const parent = queue.shift();
    let raw = "";
    try {
      raw = await readFile(`/proc/${parent}/task/${parent}/children`, "utf8");
    } catch {}
    for (const text of raw.trim().split(/\s+/))
      if (text) {
        const child = await identity(Number(text));
        if (child && !found.has(child.pid)) {
          found.set(child.pid, child);
          queue.push(child.pid);
        }
      }
  }
  return [...found.values()];
}
async function procStats(proc) {
  if ((await identity(proc.pid))?.startTime !== proc.startTime) return { pid: proc.pid, exited: true };
  let smaps = "";
  try {
    smaps = await readFile(`/proc/${proc.pid}/smaps_rollup`, "utf8");
  } catch {}
  const kb = (key) => Number(smaps.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] ?? -1);
  return {
    pid: proc.pid,
    ppid: proc.ppid,
    startTime: proc.startTime,
    cmdline: proc.cmdline,
    rssKb: kb("Rss"),
    pssKb: kb("Pss"),
    privateDirtyKb: kb("Private_Dirty"),
    fd: await readdir(`/proc/${proc.pid}/fd`).then(
      (x) => x.length,
      () => -1,
    ),
    threads: await readdir(`/proc/${proc.pid}/task`).then(
      (x) => x.length,
      () => -1,
    ),
  };
}

const state = await mkdtemp(join(tmpdir(), "die-bundled-web-audit-"));
const port = await freePort();
let launcher,
  backend,
  stdout = "",
  stderr = "",
  stopping = false,
  sockets = new Set();
const initialOwned = new Map();
const results = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  options: opts,
  isolation: { state, port },
  provenance: {
    binary: BINARY,
    binarySha256: await sha256(BINARY),
    binaryVersion: null,
    gitHead: null,
    pinnedTree: PINNED_TREE,
    expectedPinnedHead: EXPECTED_PIN,
    actualPinnedHead: null,
    embeddedBootstrap: null,
    embeddedBootstrapSha256: null,
  },
  launcher: null,
  backend: null,
  auth: null,
  subscriptionFrames: 0,
  firstFrame: null,
  samples: [],
  shutdown: null,
  errors: [],
};
function exactAlive(proc) {
  return identity(proc.pid).then((x) => x?.startTime === proc.startTime);
}
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const ws of sockets)
    try {
      ws.close();
    } catch {}
  const discovered = launcher ? await descendants(launcher.pid) : [];
  for (const p of discovered) initialOwned.set(p.pid, p);
  if (launcher && (await exactAlive(results.launcher)))
    try {
      launcher.kill("SIGTERM");
    } catch {}
  if (launcher) await Promise.race([new Promise((r) => launcher.once("exit", r)), sleep(5000)]);
  // Signal only identities observed below our launcher, and only if the PID was not recycled.
  for (const p of [...initialOwned.values()].reverse())
    if (await exactAlive(p))
      try {
        process.kill(p.pid, "SIGTERM");
      } catch {}
  await sleep(500);
  const survivors = [];
  for (const p of [results.launcher, ...initialOwned.values()].filter(Boolean))
    if (await exactAlive(p)) survivors.push(p);
  for (const p of survivors)
    if (await exactAlive(p))
      try {
        process.kill(p.pid, "SIGKILL");
      } catch {}
  await sleep(100);
  results.shutdown = {
    launcherExitCode: launcher?.exitCode ?? null,
    exactIdentitySurvivorsBeforeKill: survivors.map((p) => p.pid),
    allOwnedStopped: !(
      await Promise.all([results.launcher, ...initialOwned.values()].filter(Boolean).map(exactAlive))
    ).some(Boolean),
  };
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

async function sample(label) {
  await sleep(250); // quiescence only; no inspector and no forced GC in the shipped runtime
  const nowDesc = await descendants(results.launcher.pid);
  for (const p of nowDesc) initialOwned.set(p.pid, p);
  const row = {
    label,
    at: new Date().toISOString(),
    backend: await procStats(backend),
    descendants: await Promise.all(nowDesc.filter((p) => p.pid !== backend.pid).map(procStats)),
  };
  results.samples.push(row);
  console.log(JSON.stringify(row));
}
async function ticket() {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/websocket-ticket`, {
    method: "POST",
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`ticket failed ${response.status}: ${await response.text()}`);
  return (await response.json()).ticket;
}
function openSocket(subscribe = true) {
  return timeout(
    (async () => {
      const wsTicket = await ticket();
      return await new Promise((resolveSocket, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/ws?wsTicket=${encodeURIComponent(wsTicket)}&clientOrigin=leak-audit`,
        );
        sockets.add(ws);
        let settled = false;
        ws.onerror = (event) => {
          if (!settled) {
            settled = true;
            reject(event.error ?? new Error("websocket error"));
          }
        };
        ws.onopen = () => {
          if (!subscribe) {
            settled = true;
            resolveSocket(ws);
            return;
          }
          ws.send(JSON.stringify({ _tag: "Request", id: 1, tag: "subscribeServerConfig", payload: {}, headers: [] }));
        };
        ws.onmessage = (event) => {
          if (!settled) {
            settled = true;
            results.subscriptionFrames++;
            results.firstFrame ??= String(event.data).slice(0, 500);
            resolveSocket(ws);
          }
        };
      });
    })(),
    8000,
    "ticket + websocket + Effect RPC subscription",
  );
}
async function closeSocket(ws) {
  if (ws.readyState === WebSocket.CLOSED) {
    sockets.delete(ws);
    return;
  }
  try {
    ws.send(JSON.stringify({ _tag: "Interrupt", requestId: 1, interruptors: [] }));
  } catch {}
  const closed = new Promise((r) => ws.addEventListener("close", r, { once: true }));
  ws.close();
  await Promise.race([closed, sleep(1000)]);
  sockets.delete(ws);
}
async function churn() {
  const ws = await openSocket(true);
  await closeSocket(ws);
}

try {
  results.provenance.binaryVersion = execFileSync(BINARY, ["--version"], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: state,
      XDG_CONFIG_HOME: join(state, "xdg-config"),
      XDG_STATE_HOME: join(state, "xdg-state"),
      XDG_CACHE_HOME: join(state, "xdg-cache"),
    },
  }).trim();
  results.provenance.gitHead = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  results.provenance.actualPinnedHead = execFileSync("git", ["-C", PINNED_TREE, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (results.provenance.actualPinnedHead !== EXPECTED_PIN) throw new Error("pinned source tree has unexpected HEAD");
  const env = {
    ...process.env,
    HOME: state,
    XDG_CONFIG_HOME: join(state, "xdg-config"),
    XDG_STATE_HOME: join(state, "xdg-state"),
    XDG_CACHE_HOME: join(state, "xdg-cache"),
    T3CODE_HOME: state,
  };
  launcher = spawn(
    BINARY,
    [
      "web",
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
  results.launcher = await identity(launcher.pid);
  launcher.stdout.on("data", (b) => {
    stdout = (stdout + b).slice(-65536);
  });
  launcher.stderr.on("data", (b) => {
    stderr = (stderr + b).slice(-65536);
  });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null) throw new Error(`launcher exited ${launcher.exitCode}: ${stderr}`);
    const direct = (await descendants(launcher.pid)).filter(
      (p) => p.ppid === launcher.pid && p.cmdline.includes("bootstrap.mjs"),
    );
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
      if (response.ok && direct.length === 1) {
        backend = direct[0];
        break;
      }
    } catch {}
    await sleep(100);
  }
  if (!backend) throw new Error("did not discover exactly one direct embedded bootstrap backend child");
  initialOwned.set(backend.pid, backend);
  results.backend = backend;
  const bootstrap = backend.cmdline.split(" ").find((x) => x.endsWith("/bootstrap.mjs"));
  if (bootstrap) {
    results.provenance.embeddedBootstrap = bootstrap;
    results.provenance.embeddedBootstrapSha256 = await sha256(bootstrap);
  }
  results.auth = "shipped die loopback no-auth mode; websocket ticket requested without bearer token";
  for (let i = 0; i < 10; i++) await churn();
  await sample("baseline-after-10-warmup");
  const mid = Math.floor(opts.cycles / 2);
  for (let i = 1; i <= opts.cycles; i++) {
    await churn();
    if (i === mid) await sample(`after-cycles-${i}`);
  }
  await sample(`after-cycles-${opts.cycles}`);
  const held = [];
  for (let i = 0; i < opts.held; i++) held.push(await openSocket(true));
  await sample(`while-held-${opts.held}`);
  await Promise.all(held.map(closeSocket));
  await sample(`after-held-close-${opts.held}`);
  await sleep(5000);
  await sample("after-quiescence-5s");
} catch (error) {
  results.errors.push(error?.stack ?? String(error));
  process.exitCode = 1;
} finally {
  results.finishedAt = new Date().toISOString();
  results.stdoutTail = stdout.slice(-4000);
  results.stderrTail = stderr.slice(-4000);
  await stop();
  await writeFile(OUT, JSON.stringify(results, null, 2) + "\n");
  console.log("RESULT " + OUT);
}
