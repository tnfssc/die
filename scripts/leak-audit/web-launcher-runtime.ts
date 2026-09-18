import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { runWeb } from "../../src/web/launcher";
const root = await mkdtemp(join(tmpdir(), "die-leak-web-")),
  quick = join(root, "quick.sh"),
  stubborn = join(root, "stubborn.sh"),
  graceful = join(root, "graceful.sh"),
  binary = resolve(import.meta.dir, "../../dist/die"),
  owned = new Set<number>();
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function waitPid(path: string) {
  for (let i = 0; i < 100; i++) {
    try {
      const n = Number((await readFile(path, "utf8")).trim());
      if (Number.isSafeInteger(n) && n > 0) return n;
    } catch {}
    await Bun.sleep(10);
  }
  throw Error("PID file was not populated: " + path);
}
const rss = async () =>
  Number((await readFile("/proc/" + process.pid + "/status", "utf8")).match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
const snap = async (label: string) => {
  Bun.gc(true);
  await Bun.sleep(25);
  const x = {
    label,
    rssKb: await rss(),
    heap: process.memoryUsage().heapUsed,
    fds: (await readdir("/proc/" + process.pid + "/fd")).length,
    sigint: process.listenerCount("SIGINT"),
    sigterm: process.listenerCount("SIGTERM"),
  };
  console.log(JSON.stringify(x));
  return x;
};
try {
  await writeFile(quick, "#!/bin/sh\nexit 0\n");
  await chmod(quick, 0o700);
  process.env.DIE_WEB_SERVER = quick;
  process.env.HOME = root;
  const before = await snap("baseline");
  for (let i = 0; i < 10; i++) if ((await runWeb(["--no-browser"])) !== 0) throw Error("warm failed " + i);
  const warm = await snap("10-warm");
  for (let i = 0; i < 1000; i++) if ((await runWeb(["--no-browser"])) !== 0) throw Error("quick failed " + i);
  const after = await snap("1010-total");
  await writeFile(
    stubborn,
    "#!/bin/sh\necho $$ > '" +
      join(root, "backend.pid") +
      "'\nsleep 300 &\necho $! > '" +
      join(root, "grandchild.pid") +
      "'\ntrap '' TERM INT\nwhile :; do sleep 1; done\n",
  );
  await chmod(stubborn, 0o700);
  const launcher = spawn(binary, ["web", "--no-browser", "--base-dir", join(root, "base")], {
    env: { ...process.env, DIE_WEB_SERVER: stubborn, HOME: root },
    stdio: "ignore",
  });
  owned.add(launcher.pid!);
  for (let i = 0; i < 100 && !(await Bun.file(join(root, "grandchild.pid")).exists()); i++) await Bun.sleep(10);
  const backend = await waitPid(join(root, "backend.pid")),
    grandchild = await waitPid(join(root, "grandchild.pid"));
  owned.add(backend);
  owned.add(grandchild);
  launcher.kill("SIGTERM");
  await Bun.sleep(500);
  const signalProbe = {
    launcher: launcher.pid,
    backend,
    grandchild,
    aliveAfter500ms: { launcher: alive(launcher.pid!), backend: alive(backend), grandchild: alive(grandchild) },
  };
  console.log("SIGNAL_PROBE " + JSON.stringify(signalProbe));
  await writeFile(
    graceful,
    "#!/bin/sh\necho $$ > '" +
      join(root, "graceful-backend.pid") +
      "'\nsleep 300 &\necho $! > '" +
      join(root, "graceful-grandchild.pid") +
      "'\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n",
  );
  await chmod(graceful, 0o700);
  const launcher2 = spawn(binary, ["web", "--no-browser", "--base-dir", join(root, "base2")], {
    env: { ...process.env, DIE_WEB_SERVER: graceful, HOME: root },
    stdio: "ignore",
  });
  owned.add(launcher2.pid!);
  for (let i = 0; i < 100 && !(await Bun.file(join(root, "graceful-grandchild.pid")).exists()); i++)
    await Bun.sleep(10);
  const backend2 = await waitPid(join(root, "graceful-backend.pid")),
    grandchild2 = await waitPid(join(root, "graceful-grandchild.pid"));
  owned.add(backend2);
  owned.add(grandchild2);
  launcher2.kill("SIGTERM");
  for (let i = 0; i < 100 && alive(launcher2.pid!); i++) await Bun.sleep(10);
  const orphanProbe = {
    launcher: launcher2.pid,
    backend: backend2,
    grandchild: grandchild2,
    aliveAfterLauncherExit: {
      launcher: alive(launcher2.pid!),
      backend: alive(backend2),
      grandchild: alive(grandchild2),
    },
  };
  console.log("ORPHAN_PROBE " + JSON.stringify(orphanProbe));
  console.log("RESULT " + JSON.stringify({ ok: true, before, warm, after, signalProbe, orphanProbe }));
} finally {
  for (const pid of [...owned].reverse())
    if (alive(pid))
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
  await rm(root, { recursive: true, force: true });
}
