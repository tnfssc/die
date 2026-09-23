import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthPrompt, CredentialInfo } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const GOOGLE_PROVIDER = "google";

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
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o777) !== 0o600 ||
      (process.getuid && stat.uid !== process.getuid()) ||
      stat.size > 16_384
    ) {
      throw new Error("unsafe");
    }
    return parseLiveKey(await file.readFile("utf8"));
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
  | { state: "missing"; canImport: true };

export interface LiveCredentialImportResult {
  imported: boolean;
  status: LiveCredentialStatus;
}

type LiveCredentialRuntime = Pick<ModelRuntime, "checkAuth" | "getAuth" | "listCredentials" | "login">;

export interface LiveCredentialService {
  /** Credential state suitable for UI; this never returns key or token material. */
  status(): Promise<LiveCredentialStatus>;
  /** Resolve Google's API key through ModelRuntime. OAuth access tokens are never returned. */
  loadKey(): Promise<string>;
  /** Explicitly migrate live.env into the runtime's existing AuthStorage, if Google is unconfigured. */
  importLiveEnv(path?: string): Promise<LiveCredentialImportResult>;
}

class ExistingGoogleCredentialError extends Error {}

function storedGoogle(credentials: readonly CredentialInfo[]): CredentialInfo | undefined {
  return credentials.find((credential) => credential.providerId === GOOGLE_PROVIDER);
}

/**
 * Share the application's ModelRuntime so Live uses the same canonical AuthStorage as every other model.
 * The legacy live.env file is consulted only by importLiveEnv(), never by status() or loadKey().
 */
export function createLiveCredentialService(runtime: LiveCredentialRuntime): LiveCredentialService {
  const status = async (): Promise<LiveCredentialStatus> => {
    const stored = storedGoogle(await runtime.listCredentials());
    if (stored) {
      return stored.type === "api_key"
        ? { state: "stored_api_key", canImport: false }
        : { state: "oauth", canImport: false };
    }

    const configured = await runtime.checkAuth(GOOGLE_PROVIDER);
    if (!configured) return { state: "missing", canImport: true };
    return configured.type === "api_key"
      ? { state: "configured_api_key", canImport: false }
      : { state: "oauth", canImport: false };
  };

  return {
    status,
    async loadKey(): Promise<string> {
      const current = await status();
      if (current.state === "oauth") {
        throw new Error("Live requires a Google API key; OAuth credentials cannot be used.");
      }
      const result = await runtime.getAuth(GOOGLE_PROVIDER);
      const key = result?.auth.apiKey;
      if (typeof key !== "string" || key.length === 0) {
        throw new Error("Live requires a configured Google API key.");
      }
      return key;
    },
    async importLiveEnv(path = liveCredentialsPath()): Promise<LiveCredentialImportResult> {
      let current = await status();
      if (!current.canImport) return { imported: false, status: current };

      // Reading is deliberately after the guard: an existing provider credential means the
      // migration file is not touched at all.
      const key = await loadLiveKey(path);
      current = await status();
      if (!current.canImport) return { imported: false, status: current };

      try {
        await runtime.login(GOOGLE_PROVIDER, "api_key", {
          async prompt(prompt: AuthPrompt): Promise<string> {
            if (prompt.type !== "secret") throw new Error("Unexpected Google API-key login prompt.");
            // login() serializes provider credential operations. Recheck from inside it so a
            // login that won the race after file reading is never replaced by this import.
            if (!(await status()).canImport) throw new ExistingGoogleCredentialError();
            return key;
          },
          notify() {},
        });
      } catch (error) {
        if (!(error instanceof ExistingGoogleCredentialError)) throw error;
        return { imported: false, status: await status() };
      }
      return { imported: true, status: { state: "stored_api_key", canImport: false } };
    },
  };
}
