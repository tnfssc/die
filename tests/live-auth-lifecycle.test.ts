import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
// Pinned Pi 0.87.1 storage seam: not re-exported by the package root. Static import is bundled by Bun.
import { AuthStorage } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";
import { createLiveCredentialService } from "../src/live/credentials";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(initialAuth?: object) {
  const dir = await mkdtemp(join(tmpdir(), "die-live-auth-"));
  dirs.push(dir);
  const authPath = join(dir, "auth.json");
  if (initialAuth) await writeFile(authPath, JSON.stringify(initialAuth), { mode: 0o600 });
  const credentials = AuthStorage.create(authPath);
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
  return { dir, runtime, credentials, service: createLiveCredentialService(runtime, credentials) };
}

async function storeKey(runtime: ModelRuntime, provider: string, key: string) {
  await runtime.login(provider, "api_key", {
    async prompt(prompt) {
      if (prompt.type !== "secret") throw new Error("unexpected prompt");
      return key;
    },
    notify() {},
  });
}

describe("Live credential lifecycle", () => {
  test("explicitly imports into ModelRuntime auth storage and preserves unrelated providers", async () => {
    const { dir, runtime, service } = await fixture();
    const anthropicKey = "fake-anthropic-key-123";
    const googleKey = "fake-google-key-456";
    await storeKey(runtime, "anthropic", anthropicKey);
    const envPath = join(dir, "live.env");
    await writeFile(envPath, "GEMINI_API_KEY=" + googleKey + "\n", { mode: 0o600 });

    expect(await service.status()).toEqual({ state: "missing", canImport: true });
    expect(await service.importLiveEnv(envPath)).toEqual({
      imported: true,
      status: { state: "stored_api_key", canImport: false },
    });
    expect(await service.loadKey()).toBe(googleKey);
    expect((await runtime.getAuth("anthropic"))?.auth.apiKey).toBe(anthropicKey);
    expect(await runtime.listCredentials()).toEqual(
      expect.arrayContaining([
        { providerId: "anthropic", type: "api_key" },
        { providerId: "google", type: "api_key" },
      ]),
    );
  });

  test("does not read live.env or overwrite an existing Google API key", async () => {
    const { dir, runtime, service } = await fixture();
    const existing = "existing-google-key-123";
    await storeKey(runtime, "google", existing);

    expect(await service.importLiveEnv(join(dir, "does-not-exist"))).toEqual({
      imported: false,
      status: { state: "stored_api_key", canImport: false },
    });
    expect(await service.loadKey()).toBe(existing);
  });

  test("reports OAuth without secrets, refuses it, and never replaces it", async () => {
    const oauth = {
      type: "oauth",
      refresh: "fake-refresh-token-never-returned",
      access: "fake-access-token-never-returned",
      expires: Date.now() + 3_600_000,
    } as const;
    const { dir, runtime, service } = await fixture({
      google: oauth,
      anthropic: { type: "api_key", key: "unrelated-key-123" },
    });

    expect(await service.status()).toEqual({ state: "oauth", canImport: false });
    await expect(service.loadKey()).rejects.toThrow("API key");
    expect(await service.importLiveEnv(join(dir, "does-not-exist"))).toEqual({
      imported: false,
      status: { state: "oauth", canImport: false },
    });
    expect(await runtime.listCredentials()).toEqual(
      expect.arrayContaining([
        { providerId: "google", type: "oauth" },
        { providerId: "anthropic", type: "api_key" },
      ]),
    );
  });
});

test("atomic import preserves a Google OAuth credential installed by another writer after review", async () => {
  const { dir, runtime, credentials } = await fixture();
  const path = join(dir, "live.env");
  await writeFile(path, "GEMINI_API_KEY=fake-import-key-123", { mode: 0o600 });
  const oauth = { type: "oauth" as const, access: "fake-access", refresh: "fake-refresh", expires: 123 };
  const other = AuthStorage.create(join(dir, "auth.json"));
  const service = createLiveCredentialService(runtime, {
    read: credentials.read.bind(credentials),
    list: credentials.list.bind(credentials),
    delete: credentials.delete.bind(credentials),
    modify: async (provider, fn, options) => {
      await other.modify("google", async () => oauth);
      return credentials.modify(provider, fn, options);
    },
  });
  expect(await service.importLiveEnv(path)).toEqual({ imported: false, status: { state: "oauth", canImport: false } });
  expect(await other.read("google")).toEqual(oauth);
});
test("concurrent imports have one winner and leave migration files intact", async () => {
  const { dir, runtime, credentials, service } = await fixture();
  const paths = [join(dir, "one.env"), join(dir, "two.env")];
  await Promise.all(paths.map((path, i) => writeFile(path, "GEMINI_API_KEY=fake-import-key-" + i, { mode: 0o600 })));
  const second = createLiveCredentialService(runtime, credentials);
  const results = await Promise.all([service.importLiveEnv(paths[0]), second.importLiveEnv(paths[1])]);
  expect(results.filter((result) => result.imported)).toHaveLength(1);
  expect(await service.loadKey()).toMatch(/^fake-import-key-[01]$/);
  expect((await stat(paths[0]!)).mode & 0o777).toBe(0o600);
  expect((await stat(join(dir, "auth.json"))).mode & 0o777).toBe(0o600);
});
test("cancel before import and before locked write cannot persist a key", async () => {
  const { dir, runtime, credentials, service } = await fixture();
  const stopped = new AbortController();
  stopped.abort();
  await expect(service.importLiveEnv(join(dir, "missing"), stopped.signal)).rejects.toThrow();
  const path = join(dir, "live.env");
  await writeFile(path, "GEMINI_API_KEY=fake-import-key-123", { mode: 0o600 });
  const controller = new AbortController();
  const interrupted = createLiveCredentialService(runtime, {
    read: credentials.read.bind(credentials),
    list: credentials.list.bind(credentials),
    delete: credentials.delete.bind(credentials),
    modify: async (provider, fn, options) => {
      controller.abort();
      return credentials.modify(provider, fn, options);
    },
  });
  await expect(interrupted.importLiveEnv(path, controller.signal)).rejects.toThrow();
  expect(await credentials.read("google")).toBeUndefined();
});
test("ambient Google API key is reused without migrating or persisting it", async () => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "fake-ambient-google-key";
  try {
    const { dir, service, credentials } = await fixture();
    expect(await service.status()).toEqual({ state: "configured_api_key", canImport: false });
    expect(await service.loadKey()).toBe("fake-ambient-google-key");
    expect((await service.importLiveEnv(join(dir, "missing"))).imported).toBe(false);
    expect(await credentials.read("google")).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});
test("corrupt canonical storage is not overwritten by migration", async () => {
  const { dir, service } = await fixture();
  const path = join(dir, "live.env");
  await writeFile(path, "GEMINI_API_KEY=fake-import-key-123", { mode: 0o600 });
  const authPath = join(dir, "auth.json");
  await writeFile(authPath, "{invalid fake auth");
  await expect(service.importLiveEnv(path)).rejects.toThrow();
  expect(await readFile(authPath, "utf8")).toBe("{invalid fake auth");
});
test("stored key status is metadata only and does not resolve command references", async () => {
  const { runtime, service } = await fixture({ google: { type: "api_key", key: "!never-run-me" } });
  runtime.getAuth = async () => {
    throw new Error("must not resolve");
  };
  runtime.checkAuth = async () => {
    throw new Error("must not resolve");
  };
  expect(await service.status()).toEqual({ state: "stored_api_key", canImport: false });
});
