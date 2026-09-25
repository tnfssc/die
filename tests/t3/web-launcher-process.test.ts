import { expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { run } from "../helpers";

const binary = resolve(process.env.DIE_WEB_BINARY ?? resolve(import.meta.dir, "../../dist/die"));

async function waitForPid(path: string): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const pid = Number((await readFile(path, "utf8")).trim());
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch {}
    await Bun.sleep(10);
  }
  throw new Error("PID file was not populated: " + path);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      if (/^State:\s+Z/m.test(status)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function waitNotRunning(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && isRunning(pid); attempt++) await Bun.sleep(10);
  expect(isRunning(pid)).toBe(false);
}

function completion(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveCompletion, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveCompletion({ code, signal }));
  });
}

async function writeBackend(root: string, leaderExitsOnTerm: boolean) {
  const backend = join(root, "backend.mjs");
  const grandchild = join(root, "grandchild.mjs");
  const backendPid = join(root, "backend.pid");
  const grandchildPid = join(root, "grandchild.pid");
  await writeFile(
    grandchild,
    `import { writeFileSync } from "node:fs";
process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});
writeFileSync(${JSON.stringify(grandchildPid)}, String(process.pid));
setInterval(() => {}, 1000);
`,
  );
  await writeFile(
    backend,
    `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(backendPid)}, String(process.pid));
spawn(process.execPath, [${JSON.stringify(grandchild)}], { stdio: "ignore" });
process.on("SIGINT", () => ${leaderExitsOnTerm ? "process.exit(0)" : "{}"});
process.on("SIGTERM", () => ${leaderExitsOnTerm ? "process.exit(0)" : "{}"});
setInterval(() => {}, 1000);
`,
  );
  await chmod(backend, 0o755);
  return { backend, backendPid, grandchildPid };
}

test.skipIf(process.platform === "win32")(
  "POSIX web launcher escalates only its stubborn backend group and preserves TERM status",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "die-web-owned-group-"));
    const tracked = new Set<number>();
    try {
      const fixture = await writeBackend(root, false);
      const launcher = spawn(binary, ["web", "--no-browser", "--base-dir", join(root, "base")], {
        env: { ...process.env, HOME: root, DIE_WEB_SERVER: fixture.backend },
        stdio: "ignore",
      });
      tracked.add(launcher.pid!);
      const exited = completion(launcher);
      const backendPid = await waitForPid(fixture.backendPid);
      const grandchildPid = await waitForPid(fixture.grandchildPid);
      tracked.add(backendPid);
      tracked.add(grandchildPid);

      launcher.kill("SIGTERM");
      const result = await exited;
      expect(result).toEqual({ code: 143, signal: null });
      await Promise.all([waitNotRunning(backendPid), waitNotRunning(grandchildPid)]);
      expect(isRunning(process.pid)).toBe(true);
    } finally {
      for (const pid of [...tracked].reverse()) {
        if (isRunning(pid)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  },
  10_000,
);

test.skipIf(process.platform === "win32")(
  "POSIX web launcher reaps its group when a signalled backend leader exits early",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "die-web-early-leader-"));
    const tracked = new Set<number>();
    try {
      const fixture = await writeBackend(root, true);
      const launcher = spawn(binary, ["web", "--no-browser", "--base-dir", join(root, "base")], {
        env: { ...process.env, HOME: root, DIE_WEB_SERVER: fixture.backend },
        stdio: "ignore",
      });
      tracked.add(launcher.pid!);
      const exited = completion(launcher);
      const backendPid = await waitForPid(fixture.backendPid);
      const grandchildPid = await waitForPid(fixture.grandchildPid);
      tracked.add(backendPid);
      tracked.add(grandchildPid);

      launcher.kill("SIGINT");
      expect(await exited).toEqual({ code: 130, signal: null });
      await Promise.all([waitNotRunning(backendPid), waitNotRunning(grandchildPid)]);
    } finally {
      for (const pid of [...tracked].reverse()) {
        if (isRunning(pid)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  },
  5_000,
);

test.skipIf(process.platform !== "linux")(
  "repeated clean backend exits release signal listeners and file descriptors",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "die-web-clean-exit-"));
    try {
      const probe = join(root, "probe.ts");
      const launcherUrl = pathToFileURL(resolve(import.meta.dir, "../../src/t3/web/launcher.ts")).href;
      await writeFile(
        probe,
        `import { readdirSync } from "node:fs";
import { runWeb } from ${JSON.stringify(launcherUrl)};
const snapshot = () => ({ fds: readdirSync("/proc/" + process.pid + "/fd").length, sigint: process.listenerCount("SIGINT"), sigterm: process.listenerCount("SIGTERM") });
const before = snapshot();
for (let index = 0; index < 100; index++) { if (await runWeb(["--no-browser"]) !== 0) throw new Error("backend failed"); }
await Bun.sleep(20);
console.log(JSON.stringify({ before, after: snapshot() }));
`,
      );
      const result = await run([process.execPath, probe], {
        cwd: root,
        env: { ...process.env, HOME: root, DIE_WEB_SERVER: "/bin/true" },
      });
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      const measured = JSON.parse(result.stdout.trim());
      expect(measured.after).toEqual(measured.before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  10_000,
);
