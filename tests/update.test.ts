import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UPDATE_ASSETS, isCompiledInvocation, updateAssetFor, updateDie } from "../src/update";

const body = new TextEncoder().encode("new compiled die");
const hash = createHash("sha256").update(body).digest("hex");
const releaseUrl = "https://api.github.com/repos/tnfssc/die/releases/latest";
const dirs = new Set<string>();
const root = (tag: string) => "https://github.com/tnfssc/die/releases/download/" + tag + "/";
const deps = (fetch: typeof globalThis.fetch, executable: string, extra: Record<string, unknown> = {}) => ({
  fetch,
  executable,
  currentVersion: "0.2.15",
  platform: "linux" as const,
  arch: "x64",
  compiled: true,
  ...extra,
});
async function target(kind = "file") {
  const dir = await mkdtemp("/var/tmp/die-update-test-");
  dirs.add(dir);
  const path = join(dir, "die");
  if (kind === "directory") {
    await mkdir(path);
    await writeFile(join(path, "old"), "old");
  } else await writeFile(path, "old", { mode: 0o754 });
  return { dir, path };
}
function fixture(tag = "v0.3.0", opts: any = {}) {
  const asset = opts.asset || "die-linux-x64";
  const bin = root(tag) + asset,
    sum = bin + ".sha256",
    calls: string[] = [];
  const release = opts.release || {
    tag_name: tag,
    assets: [
      { name: asset, browser_download_url: bin },
      { name: asset + ".sha256", browser_download_url: sum },
    ],
  };
  const fetch = (async (url: RequestInfo | URL) => {
    const u = String(url);
    calls.push(u);
    if (u === releaseUrl) return Response.json(release);
    if (u === bin) return new Response(opts.binaryBody || body, { status: opts.binaryStatus || 200 });
    if (u === sum) {
      if (opts.mutate) await opts.mutate();
      return new Response((opts.checksum || hash) + "  " + (opts.checksumFile || asset) + "\n", {
        status: opts.checksumStatus || 200,
      });
    }
    throw new Error("unexpected URL " + u);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}
afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  dirs.clear();
});

describe("die self-update", () => {
  test("source guard rejects before any network", async () => {
    let calls = 0;
    await expect(
      updateDie({
        compiled: false,
        platform: "linux",
        arch: "x64",
        fetch: (async () => {
          calls++;
          throw Error("network");
        }) as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("source Bun");
    expect(calls).toBe(0);
  });
  test("real private compiled Bun fixture is accepted and lookalikes are rejected", async () => {
    expect(isCompiledInvocation("file:///tmp/$bunfs/source.ts")).toBe(false);
    expect(isCompiledInvocation("file:///project-$bunfs/source.ts")).toBe(false);
    const dir = await mkdtemp("/var/tmp/die-compiled-fixture-");
    dirs.add(dir);
    const out = join(dir, "fixture");
    const build = Bun.spawn(
      [process.execPath, "build", "--compile", "tests/compiled-bun-fixture.ts", "--outfile", out],
      { stdout: "ignore", stderr: "pipe", env: { ...process.env, TMPDIR: "/var/tmp", HERDR_ENV: "0" } },
    );
    expect(await build.exited).toBe(0);
    const run = Bun.spawn([out], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TMPDIR: "/var/tmp", HERDR_ENV: "0" },
    });
    const result = JSON.parse(await new Response(run.stdout).text());
    expect(result.url.startsWith("file:///$bunfs/")).toBe(true);
    expect(result.url.endsWith("/fixture")).toBe(true);
    expect(result.compiled).toBe(true);
    expect(await run.exited).toBe(0);
  });
  test("current and newer fetch only release metadata", async () => {
    for (const [current, tag, status] of [
      ["0.3.0", "v0.3.0", "current"],
      ["0.2.15", "v0.2.14", "newer"],
    ]) {
      const f = fixture(tag);
      await expect(updateDie(deps(f.fetch, "/no-target", { currentVersion: current }))).resolves.toMatchObject({
        status,
      });
      expect(f.calls).toEqual([releaseUrl]);
    }
  });
  test("maps supported update assets", () => {
    expect(updateAssetFor("linux", "x64")).toBe(UPDATE_ASSETS["linux-x64"]);
    expect(updateAssetFor("linux", "arm64")).toBe(UPDATE_ASSETS["linux-arm64"]);
    expect(updateAssetFor("darwin", "arm64")).toBe(UPDATE_ASSETS["darwin-arm64"]);
    expect(updateAssetFor("android", "arm64")).toBe(UPDATE_ASSETS["android-arm64"]);
    expect(updateAssetFor("darwin", "x64")).toBeUndefined();
  });
  test("downloads the matching macOS asset", async () => {
    const f = fixture("v0.3.0", { asset: "die-darwin-arm64" });
    const x = await target();
    await expect(updateDie(deps(f.fetch, x.path, { platform: "darwin", arch: "arm64" }))).resolves.toMatchObject({
      status: "updated",
    });
    expect(await Bun.file(x.path).bytes()).toEqual(body);
    expect(f.calls).toEqual([
      releaseUrl,
      root("v0.3.0") + "die-darwin-arm64",
      root("v0.3.0") + "die-darwin-arm64.sha256",
    ]);
  });
  test("unsupported platform rejects before fetch", async () => {
    let calls = 0;
    await expect(
      updateDie({
        platform: "win32",
        arch: "x64",
        compiled: true,
        fetch: (async () => {
          calls++;
        }) as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("Linux x64/arm64, macOS arm64, and Android/Termux arm64");
    expect(calls).toBe(0);
  });
  test("requires official exact asset URLs", async () => {
    const f = fixture("v0.3.0", {
      release: {
        tag_name: "v0.3.0",
        assets: [
          { name: "die-linux-x64", browser_download_url: "https://example.invalid/die-linux-x64" },
          { name: "die-linux-x64.sha256", browser_download_url: root("v0.3.0") + "die-linux-x64.sha256" },
        ],
      },
    });
    const x = await target();
    await expect(updateDie(deps(f.fetch, x.path))).rejects.toThrow();
    expect(f.calls).toEqual([releaseUrl]);
  });
  test.each([
    ["wrong hash", { checksum: "0".repeat(64), binaryBody: body }, "Checksum verification failed"],
    ["malformed checksum", { checksum: "not-a-sha" }, "Checksum verification failed"],
    ["binary HTTP failure", { binaryStatus: 503 }, "Unable to download"],
    ["checksum HTTP failure", { checksumStatus: 503 }, "Checksum verification failed"],
  ])("rejects %s", async (_n, opts, msg) => {
    const x = await target();
    const f = fixture("v0.3.0", opts);
    await expect(updateDie(deps(f.fetch, x.path))).rejects.toThrow(msg);
    expect(await Bun.file(x.path).text()).toBe("old");
  });
  test("malformed, prerelease, and missing release assets stop before binary", async () => {
    for (const release of [
      { tag_name: "garbage", assets: [] },
      { tag_name: "v0.3.0", prerelease: true, assets: [] },
      { tag_name: "v0.3.0", assets: [] },
    ]) {
      const f = fixture("v0.3.0", { release });
      await expect(updateDie(deps(f.fetch, "/no-target"))).rejects.toThrow();
      expect(f.calls).toEqual([releaseUrl]);
    }
  });
  test("updates and preserves mode", async () => {
    const x = await target();
    await updateDie(deps(fixture().fetch, x.path));
    expect(await Bun.file(x.path).text()).toBe("new compiled die");
    expect((await stat(x.path)).mode & 0o777).toBe(0o754);
  });
  test("updates symlink target and preserves symlink", async () => {
    const x = await target();
    const link = join(x.dir, "link");
    await symlink(x.path, link);
    await updateDie(deps(fixture().fetch, link));
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(new TextDecoder().decode(await readFile(x.path))).toBe("new compiled die");
  });
  test("rejects checksum with a filename that does not match the binary asset", async () => {
    const x = await target();
    const f = fixture("v0.3.0", { checksumFile: "other-binary" });
    await expect(updateDie(deps(f.fetch, x.path))).rejects.toThrow("Checksum verification failed");
    expect(await Bun.file(x.path).text()).toBe("old");
  });
  test("truncated body fails checksum", async () => {
    const x = await target();
    const f = fixture("v0.3.0", { binaryBody: body.slice(0, 3) });
    await expect(updateDie(deps(f.fetch, x.path))).rejects.toThrow("Checksum verification failed");
  });
  test("concurrent target change aborts commit", async () => {
    const x = await target();
    const f = fixture("v0.3.0", { mutate: () => writeFile(x.path, "changed") });
    await expect(updateDie(deps(f.fetch, x.path))).rejects.toThrow();
    expect(await Bun.file(x.path).text()).toBe("changed");
    expect((await readdir(x.dir)).filter((name) => name.startsWith(".die-update-"))).toEqual([]);
  });
  test("replacement failure keeps old target and cleans staging", async () => {
    const x = await target("directory");
    const f = fixture();
    await expect(updateDie(deps(f.fetch, x.path))).rejects.toThrow(/Could not replace|not a regular file/);
    expect(await Bun.file(join(x.path, "old")).text()).toBe("old");
    expect((await readdir(x.dir)).filter((n) => n.startsWith(".die-update-")).length).toBe(0);
  });
});

test.skipIf(process.getuid?.() === 0)("permission failure preserves executable without staging leftovers", async () => {
  const x = await target();
  await chmod(x.dir, 0o500);
  try {
    await expect(updateDie(deps(fixture().fetch, x.path))).rejects.toThrow("permissions");
    expect(await Bun.file(x.path).text()).toBe("old");
    expect((await readdir(x.dir)).filter((name) => name.startsWith(".die-update-"))).toEqual([]);
  } finally {
    await chmod(x.dir, 0o700);
  }
});
test("metadata network failure preserves executable", async () => {
  const x = await target();
  const offline = (async () => {
    throw new Error("offline");
  }) as unknown as typeof globalThis.fetch;
  await expect(updateDie(deps(offline, x.path))).rejects.toThrow("Unable to check");
  expect(await Bun.file(x.path).text()).toBe("old");
});

test("a real compiled executable safely replaces itself", async () => {
  const dir = await mkdtemp("/var/tmp/die-self-update-fixture-");
  dirs.add(dir);
  const current = join(dir, "current");
  const replacement = join(dir, "replacement");
  for (const [source, output] of [
    ["tests/update-self-fixture.ts", current],
    ["tests/compiled-bun-fixture.ts", replacement],
  ]) {
    const build = Bun.spawn([process.execPath, "build", "--compile", source!, "--outfile", output!], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const errors = await new Response(build.stderr).text();
    expect(await build.exited, errors).toBe(0);
  }
  const first = Bun.spawn([current], {
    env: { ...process.env, DIE_TEST_UPDATE_PAYLOAD: replacement },
    stdout: "pipe",
    stderr: "pipe",
  });
  const firstOutput = await new Response(first.stdout).text();
  expect(await first.exited).toBe(0);
  expect(JSON.parse(firstOutput)).toMatchObject({ status: "updated", path: current });
  const second = Bun.spawn([current], { stdout: "pipe", stderr: "pipe" });
  const secondOutput = await new Response(second.stdout).text();
  expect(await second.exited).toBe(0);
  expect(JSON.parse(secondOutput)).toMatchObject({ compiled: true });
  expect(
    createHash("sha256")
      .update(await Bun.file(current).bytes())
      .digest("hex"),
  ).toBe(
    createHash("sha256")
      .update(await Bun.file(replacement).bytes())
      .digest("hex"),
  );
  expect((await readdir(dir)).filter((name) => name.startsWith(".die-update-"))).toEqual([]);
});
