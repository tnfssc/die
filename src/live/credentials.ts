import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
// Pinned Pi 0.87.1 storage seam: not re-exported by the package root. Static import is bundled by Bun.
import { AuthStorage } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";

const GOOGLE_PROVIDER = "google";
const OPENAI_PROVIDER = "openai";
export type LiveProviderId = "google" | "openai";

export const liveCredentialsPath = () => join(homedir(), ".die", "live.env");

/** Deliberately not a shell/dotenv evaluator. Never include the source in errors. */
export function parseLiveKey(source: string): string {
  const lines = source.split(/\r?\n/).filter((line) => /^\s*(?:export\s+)?GEMINI_API_KEY\s*=/.test(line));
  const line = lines.length === 1 ? lines[0] : undefined;
  if (!line) throw new Error("live.env must contain exactly one GEMINI_API_KEY assignment.");
  let value = line.replace(/^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*/, "").trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    value = value.slice(1, -1);
  if (!/^[A-Za-z0-9._-]{10,256}$/.test(value)) throw new Error("Invalid GEMINI_API_KEY in live.env.");
  return value;
}

/** Read the migration file without following links or exposing its contents in errors. */
export async function loadLiveKey(path = liveCredentialsPath()): Promise<string> {
  let file: FileHandle | undefined;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o777) !== 0o600 ||
      (process.getuid && stat.uid !== process.getuid()) ||
      stat.size > 16_384
    ) {
      throw new Error("unsafe");
    }
    const buffer = Buffer.alloc(16_385);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 16_384) throw new Error("unsafe");
    return parseLiveKey(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    throw new Error("Live key unavailable. Use a user-owned ~/.die/live.env (0600) with GEMINI_API_KEY.");
  } finally {
    await file?.close();
  }
}

export type LiveCredentialStatus =
  | { state: "stored_api_key"; canImport: false }
  | { state: "configured_api_key"; canImport: false }
  | { state: "oauth"; canImport: false }
  | { state: "missing"; canImport: boolean };

export interface LiveCredentialImportResult {
  imported: boolean;
  status: LiveCredentialStatus;
}

type LiveCredentialRuntime = Pick<ModelRuntime, "checkAuth" | "getAuth" | "listCredentials">;

export interface LiveCredentialService {
  /** Credential state suitable for UI; this never returns key or token material. */
  status(signal?: AbortSignal): Promise<LiveCredentialStatus>;
  /** Resolve the selected provider API key through ModelRuntime. OAuth access tokens are never returned. */
  loadKey(signal?: AbortSignal): Promise<string>;
  /** Explicitly migrate live.env into the runtime's existing AuthStorage, if Google is unconfigured. */
  importLiveEnv(path?: string, signal?: AbortSignal): Promise<LiveCredentialImportResult>;
}

function storedProvider(credentials: readonly CredentialInfo[], provider: LiveProviderId): CredentialInfo | undefined {
  return credentials.find((credential) => credential.providerId === provider);
}

/**
 * Share the application's ModelRuntime so Live uses the same canonical AuthStorage as every other model.
 * The legacy live.env file is consulted only by importLiveEnv(), never by status() or loadKey().
 */
export function createLiveCredentialService(
  runtime: LiveCredentialRuntime,
  credentials: CredentialStore,
  provider: LiveProviderId = "google",
): LiveCredentialService {
  const status = async (signal?: AbortSignal): Promise<LiveCredentialStatus> => {
    signal?.throwIfAborted();
    const stored = storedProvider(await runtime.listCredentials({ signal }), provider);
    if (stored) {
      return stored.type === "api_key"
        ? { state: "stored_api_key", canImport: false }
        : { state: "oauth", canImport: false };
    }

    // OpenAI Live accepts only the canonical stored openai API key, not ambient
    // credentials, the distinct openai-codex OAuth provider, or subscriptions.
    if (provider === OPENAI_PROVIDER) return { state: "missing", canImport: false };
    const configured = await runtime.checkAuth(provider, { signal });
    if (!configured) return { state: "missing", canImport: true };
    return configured.type === "api_key"
      ? { state: "configured_api_key", canImport: false }
      : { state: "oauth", canImport: false };
  };

  return {
    status,
    async loadKey(signal?: AbortSignal): Promise<string> {
      const current = await status(signal);
      if (current.state === "oauth") {
        throw new Error(
          `Live requires a ${provider === "google" ? "Google" : "OpenAI"} API key; OAuth credentials cannot be used.`,
        );
      }
      if (provider === OPENAI_PROVIDER && current.state !== "stored_api_key") {
        throw new Error("Live requires a configured OpenAI API key in canonical auth storage.");
      }
      const result = await runtime.getAuth(provider, { signal });
      const key = result?.auth.apiKey;
      if (typeof key !== "string" || key.length === 0) {
        throw new Error(`Live requires a configured ${provider === "google" ? "Google" : "OpenAI"} API key.`);
      }
      return key;
    },
    async importLiveEnv(path = liveCredentialsPath(), signal?: AbortSignal): Promise<LiveCredentialImportResult> {
      signal?.throwIfAborted();
      let current = await status(signal);
      if (provider !== "google" || !current.canImport) return { imported: false, status: current };

      // Reading is deliberately after the guard: an existing provider credential means the
      // migration file is not touched at all.
      const key = await loadLiveKey(path);
      current = await status(signal);
      if (!current.canImport) return { imported: false, status: current };

      let imported = false;
      // ModelRuntime.login replaces a provider credential. Import is deliberately a
      // conditional AuthStorage.modify instead: its lock also protects against other
      // runtimes/processes installing Google OAuth or a key after our review.
      await credentials.modify(
        GOOGLE_PROVIDER,
        async (existing) => {
          signal?.throwIfAborted();
          if (existing !== undefined) return existing;
          imported = true;
          return { type: "api_key", key };
        },
        { signal },
      );
      return { imported, status: await status(signal) };
    },
  };
}

/** Lazy call-site factory: same canonical auth.json, stock Google provider, no catalogue/network refresh. */
export async function createDefaultLiveCredentialService(
  signal?: AbortSignal,
  provider: LiveProviderId = "google",
): Promise<LiveCredentialService> {
  signal?.throwIfAborted();
  const credentials = AuthStorage.create(
    join(process.env.DIE_CODING_AGENT_DIR ?? join(homedir(), ".die", "agent"), "auth.json"),
  );
  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
    signal,
  });
  return createLiveCredentialService(runtime, credentials, provider);
}
