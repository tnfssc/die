import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { executeIsolated } from "../../src/typescript/execution";
const binary = resolve(import.meta.dir, "../../dist/die"),
  root = await mkdtemp(join(tmpdir(), "die-leak-execution-")),
  sessionFile = join(root, "session.jsonl");
const owned = new Set<number>(),
  samples: any[] = [];
async function rss(pid = process.pid) {
  try {
    const s = await readFile("/proc/" + pid + "/status", "utf8");
    return Number(s.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
  } catch {
    return 0;
  }
}
async function snap(label: string) {
  Bun.gc(true);
  await Bun.sleep(25);
  const x = {
    label,
    rssKb: await rss(),
    heap: process.memoryUsage().heapUsed,
    fds: (await readdir("/proc/" + process.pid + "/fd")).length,
  };
  samples.push(x);
  console.log(JSON.stringify(x));
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function run(code: string, signal?: AbortSignal, timeoutMs = 2000, jobHandler?: any) {
  return executeIsolated(code, root, signal, timeoutMs, {
    executablePath: binary,
    killGraceMs: 30,
    sessionFile,
    jobHandler,
  });
}
try {
  await snap("baseline");
  for (let i = 0; i < 5; i++) await run("console.log(" + i + ")");
  await snap("warm");
  for (let i = 0; i < 80; i++) {
    const r = await run(i % 2 ? 'console.error("e' + i + '")' : 'console.log("o' + i + '")');
    if (r.exitCode !== 0) throw Error("short failed " + i);
  }
  await snap("80-short");
  for (let i = 0; i < 24; i++) {
    const r = await run('process.stdout.write("x".repeat(1_000_000));process.stderr.write("y".repeat(250_000))');
    if (!r.stdoutLost || !r.stderrLost || !r.stdoutPath || !r.stderrPath) throw Error("spill failed " + i);
  }
  await snap("24-spill-30MB");
  for (let i = 0; i < 24; i++) {
    const r = await run('process.on("SIGTERM",()=>{});await new Promise(()=>{})', undefined, 25);
    if (!r.timedOut) throw Error("timeout failed " + i);
  }
  await snap("24-timeout");
  for (let i = 0; i < 24; i++) {
    const c = new AbortController();
    setTimeout(() => c.abort("audit"), 15);
    const r = await run('process.on("SIGTERM",()=>{});await new Promise(()=>{})', c.signal);
    if (!r.cancelled) throw Error("abort failed " + i);
  }
  await snap("24-abort");
  for (let i = 0; i < 50; i++) {
    const r = await run(
      'const x=await shell("synthetic");if(x.n!==' + i + ')throw Error("bad bridge")',
      undefined,
      2000,
      async () => ({ n: i }),
    );
    if (r.exitCode !== 0) throw Error("bridge failed " + i + ":" + r.stderr);
  }
  await snap("50-bridge");
  let bridgeAborts = 0;
  for (let i = 0; i < 6; i++) {
    const r = await run(
      'await shell("never")',
      undefined,
      400,
      async (_m: string, _p: unknown, signal: AbortSignal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              bridgeAborts++;
              resolve();
            },
            { once: true },
          ),
        );
        throw Error("aborted");
      },
    );
    if (!r.timedOut) throw Error("bridge timeout failed " + i);
  }
  await Bun.sleep(50);
  await snap("6-bridge-timeout");
  for (let i = 0; i < 10; i++) {
    const r = await run(
      'import {spawn} from "node:child_process";const c=spawn("/bin/sh",["-c","trap \'\' TERM; while :; do sleep 1; done"],{stdio:"ignore"});console.log(c.pid);c.unref();process.exit(0)',
    );
    const pid = Number(r.stdout.trim());
    owned.add(pid);
    for (let n = 0; n < 50 && alive(pid); n++) await Bun.sleep(10);
    if (alive(pid)) throw Error("descendant survived " + pid);
  }
  await snap("10-descendant-cleanups");
  for (let i = 0; i < 120; i++) await run("void 0");
  await snap("120-final-short");
  console.log(
    "RESULT " +
      JSON.stringify({
        ok: true,
        bridgeAborts,
        ownedDescendants: [...owned],
        stillAlive: [...owned].filter(alive),
        samples,
      }),
  );
} finally {
  for (const pid of owned)
    if (alive(pid))
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
  await rm(root, { recursive: true, force: true });
}
