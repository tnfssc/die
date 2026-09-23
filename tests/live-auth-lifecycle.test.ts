import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
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
  const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
  return { dir, runtime, service: createLiveCredentialService(runtime) };
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
