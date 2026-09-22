#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const evidence = process.env.CLOCK_EVENTS;
const die = process.env.CLOCK_DIE_BIN;
if (!evidence || !die) process.exit(64);
const start = (pid) => {
  try { return readFileSync("/proc/" + pid + "/stat", "utf8").split(") ")[1].split(" ")[19]; }
  catch { return null; }
};
const write = (event, extra = {}) => {
  const line = JSON.stringify({ event, pid: process.pid, start: start(process.pid), ...extra }) + "\n";
  appendFileSync(evidence, line);
  if (process.env.CLOCK_PIN_FILE) appendFileSync(process.env.CLOCK_PIN_FILE, line);
};
write("launcher-start");
const child = spawn(die, process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
write("die-start", { childPid: child.pid, childStart: start(child.pid) });
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
process.stdin.once("end", () => write("stdin-end"));
process.once("SIGTERM", () => {
  write("sigterm", { childPid: child.pid });
  process.stdin.unpipe(child.stdin);
  child.stdin.end();
  write("stdin-close-requested", { childPid: child.pid });
});
process.once("SIGINT", () => write("sigint", { childPid: child.pid }));
child.once("exit", (code, signal) => {
  write("die-exit", { childPid: child.pid, code, signal, stdinReadableEnded: process.stdin.readableEnded });
  write("launcher-exit", { code });
  process.exit(code ?? 0);
});
