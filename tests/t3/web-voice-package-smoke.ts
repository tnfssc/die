#!/usr/bin/env bun
/** Real packaged HTTP/auth and shipped asset smoke, no provider session or microphone. */
import { mkdtemp, mkdir, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import net from "node:net";
import { strict as assert } from "node:assert";
const archive = resolve(process.env.DIE_WEB_PACKAGE ?? "dist/die-web");
const base = await mkdtemp(join(tmpdir(), "die-web-smoke-"));
const home = join(base, "home");
await mkdir(home);
const socket = net.createServer();
await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
const port = (socket.address() as net.AddressInfo).port;
await new Promise<void>((done) => socket.close(() => done()));
const child = Bun.spawn(
  [
    process.execPath,
    join(archive, "bootstrap.mjs"),
    "serve",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--base-dir",
    base,
  ],
  {
    env: { PATH: dirname(process.execPath) + ":" + process.env.PATH, HOME: home, TMPDIR: base, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "ignore",
  },
);
const origin = "http://127.0.0.1:" + port;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      ready = response.ok;
      await response.body?.cancel();
      if (ready) break;
    } catch {}
    if (child.exitCode !== null) break;
    await Bun.sleep(100);
  }
  assert(ready, "packaged server did not start");
  for (const [headers, status] of [
    [{}, 403],
    [{ origin: "https://evil.invalid" }, 403],
    [{ origin }, 401],
  ] as const) {
    const response = await fetch(origin + "/api/voice/ws?threadId=missing-owner", {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, status);
    await response.body?.cancel();
  }
  const assets = join(archive, "dist/client/assets");
  let delivered = false;
  for (const file of await readdir(assets)) {
    if (!file.endsWith(".js")) continue;
    const source = await readFile(join(assets, file), "utf8");
    if (!source.includes("Voice provider") || !source.includes("Start voice")) continue;
    const served = await fetch(origin + "/assets/" + file, { signal: AbortSignal.timeout(3000) });
    assert.equal(served.status, 200);
    assert.equal(await served.text(), source);
    delivered = true;
    break;
  }
  assert(delivered, "packaged server did not serve its voice UI asset");
  console.log(
    JSON.stringify({
      packagedRoute: true,
      missingOrigin: 403,
      crossOrigin: 403,
      unauthenticated: 401,
      servedVoiceAsset: true,
      providerSessionsOpened: 0,
    }),
  );
} finally {
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
  await child.exited;
  clearTimeout(timer);
  await rm(base, { recursive: true, force: true });
}
