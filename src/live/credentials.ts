import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const liveCredentialsPath = () => join(homedir(), ".die", "live.env");

/** Deliberately not a shell/dotenv evaluator. Never include the source in errors. */
export function parseLiveKey(source: string): string {
  const lines = source.split(/\r?\n/).filter((line) => /^\s*(?:export\s+)?GEMINI_API_KEY\s*=/.test(line));
  if (lines.length !== 1) throw new Error("live.env must contain exactly one GEMINI_API_KEY assignment.");
  let value = lines[0]!.replace(/^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*/, "").trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    value = value.slice(1, -1);
  if (!/^[A-Za-z0-9._-]{10,256}$/.test(value)) throw new Error("Invalid GEMINI_API_KEY in live.env.");
  return value;
}

/** Read only on explicit start. Does not mutate existing provider auth storage. */
export async function loadLiveKey(path = liveCredentialsPath()): Promise<string> {
  let file;
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
    // File and parser errors are intentionally opaque: source/key/path never reach logs.
    throw new Error("Live key unavailable. Use a user-owned ~/.die/live.env (0600) with GEMINI_API_KEY.");
  } finally {
    await file?.close();
  }
}
