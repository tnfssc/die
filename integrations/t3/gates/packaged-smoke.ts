#!/usr/bin/env bun
/**
 * Smoke-test a relocated packaged Die executable as a black box.
 *
 * Do not import application source. Copy the candidate before launch, then run it
 * with an unusable PATH and isolated HOME, XDG, TMP, and state.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../../..");
const source = resolve(process.env.T3_V2_PACKAGED_BINARY ?? join(repo, "dist/die-t3-v2-candidate"));
const expectedSha = process.env.T3_V2_EXPECT_BINARY_SHA256;
const buildManifestPath = resolve(process.env.T3_V2_PACKAGED_MANIFEST ?? join(repo, "dist/t3-v2-candidate-build.json"));
const keep = process.env.T3_V2_KEEP_TEMP === "1";
const artifactPath = resolve(process.env.T3_V2_PACKAGED_PROOF ?? join(repo, "artifacts/t3-v2-packaged-smoke.json"));
const tmpRoot = process.env.TMPDIR ?? tmpdir();
const temp = await mkdtemp(join(tmpRoot, "die-t3-v2-packaged-"));
await chmod(temp, 0o700);
const home = join(temp, "home");
const xdgCache = join(temp, "cache");
const xdgConfig = join(temp, "config");
const xdgState = join(temp, "state");
const runtimeTmp = join(temp, "tmp");
const baseDir = join(temp, "state with spaces", "web");
const relocatedDir = join(temp, "relocated package");
const relocated = join(relocatedDir, "die-renamed");
await Promise.all(
  [home, xdgCache, xdgConfig, xdgState, runtimeTmp, baseDir, relocatedDir].map((p) => mkdir(p, { recursive: true })),
);

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error("packaged smoke assertion failed: " + message);
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
function sha(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}
async function fileSha(path: string): Promise<string> {
  return sha(await Bun.file(path).bytes());
}
async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  server.close();
  await once(server, "close");
  return port;
}
async function waitFor<T>(probe: () => Promise<T | undefined>, ms: number, label: string): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) {
      last = error;
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${label}${last ? ": " + String(last) : ""}`);
}
function redact(text: string): string {
  return text
    .replace(/([?&](?:token|pairing)[:=])[^&\s]+/gi, "$1<redacted>")
    .replace(/^(Token:).*$/gim, "$1 <redacted>");
}
async function http(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; text: string; headers: Record<string, string | string[] | undefined> }>(
    (done, fail) => {
      const req = httpRequest({ hostname: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (part) => (text += part));
        res.on("end", () => done({ status: res.statusCode ?? 0, text, headers: res.headers }));
      });
      req.setTimeout(5_000, () => req.destroy(new Error("HTTP timeout")));
      req.once("error", fail);
      req.end();
    },
  );
}
type BunWebSocketConstructor = typeof WebSocket & {
  new (url: string, options: { headers: Record<string, string> }): WebSocket;
};

async function wsUpgrade(port: number, host: string, origin?: string): Promise<number> {
  return new Promise((done) => {
    // Bun supports request headers in its built-in WebSocket client; the DOM lib bundled with TypeScript omits this overload.
    const socket = new (WebSocket as BunWebSocketConstructor)(`ws://127.0.0.1:${port}/ws?orchestrationProtocol=2`, {
      headers: {
        Host: host,
        ...(origin === undefined ? {} : { Origin: origin }),
      },
    });
    let settled = false;
    const timeout = setTimeout(() => finish(0), 10_000);
    const finish = (status: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      done(status);
    };
    socket.addEventListener("open", () => finish(101), { once: true });
    socket.addEventListener("error", () => finish(0), { once: true });
    socket.addEventListener("close", () => finish(0), { once: true });
  });
}

async function descendants(root: number): Promise<number[]> {
  const entries = await readdir("/proc");
  const parent = new Map<number, number>();
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const text = await readFile(`/proc/${name}/status`, "utf8");
      const value = Number(text.match(/^PPid:\s+(\d+)/m)?.[1]);
      if (Number.isFinite(value)) parent.set(Number(name), value);
    } catch {}
  }
  const found: number[] = [];
  let frontier = [root];
  while (frontier.length) {
    const next: number[] = [];
    for (const [pid, ppid] of parent)
      if (frontier.includes(ppid) && !found.includes(pid)) {
        found.push(pid);
        next.push(pid);
      }
    frontier = next;
  }
  return found;
}
async function proc(pid: number) {
  let executable = "";
  try {
    executable = await Bun.file(`/proc/${pid}/cmdline`).text();
  } catch {}
  let link = "";
  try {
    link = await (await import("node:fs/promises")).readlink(`/proc/${pid}/exe`);
  } catch {}
  return { pid, exe: link, cmdline: executable.replaceAll("\0", " ").trim() };
}
async function gone(pid: number): Promise<boolean> {
  try {
    await stat(`/proc/${pid}`);
    return false;
  } catch {
    return true;
  }
}
async function extractedRuntimeManifest(root: string) {
  const webRuntime = join(root, "web-runtime");
  const versions = (await readdir(webRuntime)).sort();
  const entrypoints: Array<{ directory: string; bootstrapSha256: string }> = [];
  for (const directory of versions) {
    const bootstrap = join(webRuntime, directory, "bootstrap.mjs");
    entrypoints.push({ directory, bootstrapSha256: await fileSha(bootstrap) });
  }
  return { versions, entrypoints };
}

let child: ChildProcess | undefined;
let output = "";
const proof: Record<string, unknown> = { passed: false, startedAt: new Date().toISOString(), source, temp };
try {
  const before = await Bun.file(source).bytes();
  const sourceSha = sha(before);
  check(!expectedSha || sourceSha === expectedSha, `expected SHA ${expectedSha}, got ${sourceSha}`);
  await copyFile(source, relocated);
  await chmod(relocated, 0o700);
  check((await fileSha(relocated)) === sourceSha, "relocated copy hash differs");
  // Detect a concurrent candidate replacement while taking the owned snapshot.
  check((await fileSha(source)) === sourceSha, "candidate changed while being snapshotted; rerun");
  const buildManifestBytes = await Bun.file(buildManifestPath).bytes();
  const buildManifest = JSON.parse(new TextDecoder().decode(buildManifestBytes));
  check(
    (buildManifest.executableHash ?? buildManifest.binarySha256) === sourceSha,
    "build manifest binary SHA does not match candidate",
  );
  Object.assign(proof, {
    sourceSha256: sourceSha,
    sourceBytes: before.length,
    relocated,
    buildManifestPath,
    buildManifestSha256: sha(buildManifestBytes),
    buildManifest,
  });

  const seeded = {
    preservationSentinel: { nested: ["keep", 7] },
    providerInstances: {
      pi: {
        driver: "pi",
        enabled: true,
        config: { binaryPath: "/must/be/replaced", customModels: ["loopback/smoke"] },
        sentinel: "keep-pi",
      },
    },
    providers: { sentinel: { enabled: false } },
  };
  await mkdir(join(baseDir, "userdata"), { recursive: true });
  await writeFile(join(baseDir, "userdata/settings.json"), JSON.stringify(seeded, null, 2) + "\n", { mode: 0o600 });
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    HOME: home,
    XDG_CACHE_HOME: xdgCache,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_STATE_HOME: xdgState,
    TMPDIR: runtimeTmp,
    PATH: join(temp, "intentionally-empty-path"),
    LANG: "C.UTF-8",
    PI_OFFLINE: "1",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  };
  child = spawn(
    relocated,
    ["web", "--no-browser", "--host", "127.0.0.1", "--port", String(port), "--base-dir", baseDir],
    {
      cwd: temp,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  check(child.stdout && child.stderr, "candidate output pipes unavailable");
  for (const stream of [child.stdout, child.stderr])
    void (async () => {
      for await (const part of stream) output += part.toString();
    })();
  await waitFor(
    async () => {
      const r = await http(port, "/");
      return r.status === 200 ? r : undefined;
    },
    30_000,
    "packaged HTTP server",
  );
  check(output.includes(origin), "startup output did not contain plain loopback URL");
  check(!/[?&](token|pairing)=/i.test(output), "no-auth startup emitted a pairing/token URL");

  const safeHost = `127.0.0.1:${port}`;
  const same = JSON.parse((await http(port, "/api/auth/session", { Host: safeHost, Origin: origin })).text);
  const headerless = JSON.parse((await http(port, "/api/auth/session", { Host: safeHost })).text);
  check(same.authenticated === true, "same-origin no-auth request rejected");
  check(headerless.authenticated === true, "headerless local client rejected");
  const blockedHttp: Array<{ name: string; status: number; authenticated?: boolean }> = [];
  for (const item of [
    ["cross-origin", { Host: safeHost, Origin: "http://evil.invalid" }],
    ["opaque-origin", { Host: safeHost, Origin: "null" }],
    ["wrong-port-origin", { Host: safeHost, Origin: `http://127.0.0.1:${port + 1}` }],
    ["alternate-host", { Host: `localhost:${port}`, Origin: origin }],
    ["rebinding-host", { Host: "attacker.invalid", Origin: origin }],
    ["cross-site", { Host: safeHost, "Sec-Fetch-Site": "cross-site" }],
  ] as const) {
    const r = await http(port, "/api/auth/session", item[1]);
    let authenticated: boolean | undefined;
    try {
      authenticated = JSON.parse(r.text).authenticated;
    } catch {}
    check(r.status >= 400 || authenticated === false, item[0] + " HTTP request accepted");
    blockedHttp.push({ name: item[0], status: r.status, authenticated });
  }
  const sameWs = await wsUpgrade(port, safeHost, origin);
  const headerlessWs = await wsUpgrade(port, safeHost);
  check(sameWs === 101, `same-origin WebSocket rejected (${sameWs})`);
  check(headerlessWs === 101, `headerless local WebSocket rejected (${headerlessWs})`);
  const blockedWs = {
    crossOrigin: await wsUpgrade(port, safeHost, "http://evil.invalid"),
    wrongPort: await wsUpgrade(port, safeHost, `http://127.0.0.1:${port + 1}`),
    alternateHost: await wsUpgrade(port, `localhost:${port}`, origin),
    rebindingHost: await wsUpgrade(port, "attacker.invalid", origin),
  };
  for (const [name, status] of Object.entries(blockedWs)) check(status !== 101, name + " WebSocket accepted");

  const settings = JSON.parse(await readFile(join(baseDir, "userdata/settings.json"), "utf8"));
  check(
    JSON.stringify(settings.preservationSentinel) === JSON.stringify(seeded.preservationSentinel),
    "top-level settings lost",
  );
  check(settings.providerInstances.pi.sentinel === "keep-pi", "Pi provider metadata lost");
  check(settings.providerInstances.pi.config.customModels?.[0] === "loopback/smoke", "Pi model configuration lost");
  check(
    settings.providerInstances.pi.config.binaryPath === relocated,
    "relocated executable was not seeded as Pi runtime",
  );

  const childPid = child.pid;
  check(childPid !== undefined, "candidate PID unavailable");
  const pids = [childPid, ...(await descendants(childPid))];
  const processes = await Promise.all(pids.map(proc));
  check(processes.length >= 2, "embedded backend child was not observed");
  check(
    processes.every((p) => !/(^|[\s/])(node|npm|npx|bun)([\s]|$)/i.test(p.cmdline)),
    "external node/npm/bun runtime observed",
  );
  check(
    processes.slice(1).some((p) => p.exe === relocated),
    "embedded backend is not executing the relocated package runtime",
  );
  const runtimeRoot = join(xdgCache, "die");
  const runtimeManifest = await extractedRuntimeManifest(runtimeRoot);

  child.kill("SIGTERM");
  const exit = await Promise.race([
    once(child, "exit").then(([code, signal]) => ({ code, signal })),
    sleep(10_000).then(() => undefined),
  ]);
  check(exit !== undefined, "launcher did not exit after SIGTERM");
  await waitFor(
    async () => ((await Promise.all(pids.map(gone))).every(Boolean) ? true : undefined),
    8_000,
    "exact owned PID teardown",
  );
  child = undefined;
  Object.assign(proof, {
    passed: true,
    completedAt: new Date().toISOString(),
    origin,
    noAuth: true,
    http: { sameOrigin: true, headerless: true, blocked: blockedHttp },
    websocket: { sameOrigin: sameWs, headerless: headerlessWs, blocked: blockedWs },
    settingsPreserved: true,
    runtimeManifest,
    processes,
    pids,
    exit,
    runtimePath: env.PATH,
    serverOutput: redact(output),
    coverage: {
      proven: [
        "relocation",
        "embedded-runtime-without-PATH",
        "HTTP-host-origin",
        "WebSocket-host-origin",
        "settings/model-config-preservation",
        "owned-process-shutdown",
      ],
      notProven: [
        "browser-rendered-shell-cards",
        "interactive-model-mode-session-history-accounting",
        "terminal-delayed-input-resize",
      ],
    },
  });
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  console.log(`packaged smoke: PASS sha256=${sourceSha} proof=${artifactPath}`);
} catch (error) {
  Object.assign(proof, { error: String(error), serverOutput: redact(output), completedAt: new Date().toISOString() });
  await mkdir(dirname(artifactPath), { recursive: true }).catch(() => {});
  await writeFile(artifactPath, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 }).catch(() => {});
  throw error;
} finally {
  if (child?.pid && child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
    await Promise.race([once(child, "exit").catch(() => {}), sleep(5_000)]);
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  if (!keep) await rm(temp, { recursive: true, force: true });
}
