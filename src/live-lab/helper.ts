import { createHash } from "node:crypto";
import { open, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { embeddedHelper } from "./embedded";

export type ExtractedHelper = { path: string; cleanup: () => Promise<void> };
/** No shared executable cache: each launch owns one private, disposable directory. */
export async function extractNativeHelper(
  bytes: Uint8Array,
  expectedSha256: string,
  temporaryRoot = tmpdir(),
): Promise<ExtractedHelper> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) ||
      createHash("sha256").update(bytes).digest("hex") !== expectedSha256)
    throw new Error("Embedded audio helper failed integrity check");
  const directory = await mkdtemp(join(temporaryRoot, "die-live-lab-"));
  const path = join(directory, "live-lab-audio");
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
      if (createHash("sha256").update(await readFile(path)).digest("hex") !== expectedSha256)
        throw new Error("Extracted audio helper failed integrity check");
      await file.chmod(0o700);
    } finally {
      await file.close();
    }
    return { path, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Explicit developer paths take priority; all other platforms retain their existing sibling resolution. */
export async function resolveEmbeddedNativeHelper(
  platform = process.platform,
  arch = process.arch,
  payload: { path: string; sha256: string } | null = embeddedHelper,
): Promise<ExtractedHelper | undefined> {
  if (platform !== "darwin" || arch !== "arm64" || !payload) return undefined;
  return extractNativeHelper(await Bun.file(payload.path).bytes(), payload.sha256);
}
