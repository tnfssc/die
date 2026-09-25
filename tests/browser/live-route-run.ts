/** One-command opt-in browser acceptance; owns both fixture and Chromium lifetimes. */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";

assert(process.env.DIE_T3_SOURCE, "Set DIE_T3_SOURCE to the canonical upstream checkout");
const chrome = process.env.DIE_CHROMIUM;
const playwright = process.env.DIE_PLAYWRIGHT_CORE;
assert(chrome && playwright, "Set DIE_CHROMIUM and DIE_PLAYWRIGHT_CORE for the offline browser gate");
const child = spawn(process.execPath, [resolve(import.meta.dir, "live-route-bootstrap.ts")], {
  env: process.env,
  stdio: ["ignore", "pipe", "inherit"],
});
let settled = false;
const boot = new Promise<{ url: string; missingUrl: string; evidencePath: string }>((yes, no) => {
  child.once("exit", (code) => {
    if (!settled) no(new Error("fixture exited before ready: " + code));
  });
  createInterface({ input: child.stdout! }).on("line", (line) => {
    try {
      const value = JSON.parse(line);
      if (value.url && value.missingUrl && value.evidencePath && !settled) {
        settled = true;
        yes(value);
      }
    } catch {
      process.stderr.write("[fixture] " + line + "\n");
    }
  });
});
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  const fixture = await Promise.race([
    boot,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("fixture startup timeout")), 30000);
    }),
  ]);
  if (timer) clearTimeout(timer);
  const gate = spawn(process.execPath, [resolve(import.meta.dir, "live-route-offline.ts")], {
    env: {
      ...process.env,
      DIE_LIVE_BROWSER_URL: fixture.url,
      DIE_LIVE_BROWSER_MISSING_URL: fixture.missingUrl,
      DIE_LIVE_BROWSER_WS_PATH: "/api/voice/ws",
      DIE_LIVE_BROWSER_FAKE_IPC_EVIDENCE: fixture.evidencePath,
      DIE_CHROMIUM: chrome,
      DIE_PLAYWRIGHT_CORE: playwright,
    },
    stdio: "inherit",
  });
  const exit = await new Promise<number>((done) => gate.on("exit", (code, signal) => done(code ?? (signal ? 1 : 0))));
  if (exit) process.exitCode = exit;
} finally {
  if (timer) clearTimeout(timer);
  if (child.exitCode === null) {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(killTimer);
    if (child.exitCode !== 0) throw new Error("Fixture teardown failed: " + (child.signalCode ?? child.exitCode));
  }
}
