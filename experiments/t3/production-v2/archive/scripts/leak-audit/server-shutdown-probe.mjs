#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
const signal = process.argv[2] || "SIGTERM";
const root = resolve(import.meta.dirname, "../..");
const state = await mkdtemp(join(tmpdir(), "t3-shutdown-probe-"));
const srv = net.createServer();
await new Promise((r, j) => srv.once("error", j).listen(0, "127.0.0.1", r));
const port = srv.address().port;
await new Promise((r) => srv.close(r));
const child = spawn(
  process.execPath,
  [
    resolve(root, ".cache/die-t3code/apps/server/dist/bin.mjs"),
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
  { cwd: state, env: { ...process.env, HOME: state, T3CODE_HOME: state }, stdio: ["ignore", "pipe", "pipe"] },
);
let out = "",
  err = "";
child.stdout.on("data", (b) => (out += b));
child.stderr.on("data", (b) => (err += b));
try {
  const deadline = Date.now() + 60000;
  while (!out.includes("server is ready") && Date.now() < deadline && child.exitCode == null)
    await new Promise((r) => setTimeout(r, 50));
  if (!out.includes("server is ready")) throw new Error("not ready: " + err);
  const start = performance.now();
  child.kill(signal);
  const exited = await Promise.race([
    new Promise((r) => child.once("exit", (code, sig) => r({ code, sig }))),
    new Promise((r) => setTimeout(() => r(null), 15000)),
  ]);
  const result = {
    signal,
    pid: child.pid,
    exitedWithin15s: Boolean(exited),
    elapsedMs: Math.round(performance.now() - start),
    exit: exited,
  };
  console.log(JSON.stringify(result));
  if (!exited) child.kill("SIGKILL");
} finally {
  if (child.exitCode == null) child.kill("SIGKILL");
  await rm(state, { recursive: true, force: true });
}
