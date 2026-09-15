import { createHash } from "node:crypto";
import { chmod, mkdtemp, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import diePackage from "../package.json";

export const RELEASES_URL = "https://api.github.com/repos/tnfssc/die/releases/latest";
export const UPDATE_ASSETS = {
  "linux-x64": "die-linux-x64",
  "darwin-x64": "die-darwin-x64",
  "darwin-arm64": "die-darwin-arm64",
} as const;
export type UpdateAssetKey = keyof typeof UPDATE_ASSETS;
export const UPDATE_ASSET = UPDATE_ASSETS["linux-x64"];
export function updateAssetFor(platform: NodeJS.Platform, arch: string): string | undefined {
  return UPDATE_ASSETS[`${platform}-${arch}` as UpdateAssetKey];
}
export type UpdateResult = { status: "updated" | "current" | "newer"; version: string; path?: string };
export type UpdateDeps = {
  fetch?: typeof fetch;
  executable?: string;
  currentVersion?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  compiled?: boolean;
  onDownload?: (version: string) => void;
};
function version(value: string): [number, number, number] | undefined {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return;
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
/** Only Bun's virtual compiled module namespace, not similarly named source directories. */
export function isCompiledInvocation(moduleUrl = import.meta.url): boolean {
  return moduleUrl.startsWith("file:///$bunfs/");
}
export async function updateDie(deps: UpdateDeps = {}): Promise<UpdateResult> {
  if (!(deps.compiled ?? isCompiledInvocation()))
    throw new Error("Refusing to self-update a source Bun invocation; run the compiled die executable.");
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const updateAsset = updateAssetFor(platform, arch);
  if (!updateAsset) throw new Error("Self-update is currently supported only on Linux x64 and macOS x64/arm64.");
  const current = deps.currentVersion ?? diePackage.version;
  const currentParts = version(current);
  if (!currentParts) throw new Error("Cannot self-update this development version: " + current);
  const http = deps.fetch ?? fetch;
  const request = (url: string, accept: string) =>
    http(url, {
      headers: { accept, "user-agent": "die/" + current },
      signal: AbortSignal.timeout(300_000),
    });
  let release: unknown;
  try {
    const response = await request(RELEASES_URL, "application/vnd.github+json");
    if (!response.ok) throw new Error("GitHub returned HTTP " + response.status);
    release = await response.json();
  } catch (error) {
    throw new Error("Unable to check for updates: " + errorMessage(error));
  }
  if (!isRecord(release) || typeof release.tag_name !== "string")
    throw new Error("GitHub returned an invalid stable release version.");
  const latestParts = version(release.tag_name);
  if (!latestParts || release.prerelease || release.draft)
    throw new Error("GitHub returned an invalid stable release version.");
  const tag = release.tag_name;
  const latest = tag.replace(/^v/, "");
  const relation =
    latestParts[0] - currentParts[0] || latestParts[1] - currentParts[1] || latestParts[2] - currentParts[2];
  if (relation === 0) return { status: "current", version: latest };
  if (relation < 0) return { status: "newer", version: current };
  const assets: unknown[] = Array.isArray(release.assets) ? release.assets : [];
  const assetUrl = (name: string): string => {
    const matches = assets.filter((asset): asset is Record<string, unknown> => isRecord(asset) && asset.name === name);
    const expected = "https://github.com/tnfssc/die/releases/download/" + encodeURIComponent(tag) + "/" + name;
    if (matches.length !== 1 || matches[0]?.browser_download_url !== expected)
      throw new Error("The release is missing a valid official " + name + " asset.");
    return expected;
  };
  const binaryUrl = assetUrl(updateAsset);
  const checksumUrl = assetUrl(updateAsset + ".sha256");
  let target: string;
  let original: Awaited<ReturnType<typeof stat>>;
  try {
    target = await realpath(deps.executable ?? process.execPath);
    original = await stat(target);
    if (!original.isFile()) throw new Error("not a regular file");
  } catch (error) {
    throw new Error("Cannot locate or inspect die executable: " + errorMessage(error));
  }
  deps.onDownload?.(latest);
  let bytes: Uint8Array;
  try {
    const response = await request(binaryUrl, "application/octet-stream");
    if (!response.ok) throw new Error("HTTP " + response.status);
    bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error("empty download");
  } catch (error) {
    throw new Error("Unable to download die " + latest + ": " + errorMessage(error));
  }
  try {
    const response = await request(checksumUrl, "text/plain");
    if (!response.ok) throw new Error("HTTP " + response.status);
    const escapedAsset = updateAsset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp("^([a-fA-F0-9]{64})[ \t]+\\*?" + escapedAsset + "$").exec((await response.text()).trim());
    if (!match) throw new Error("invalid checksum format or filename");
    if (createHash("sha256").update(bytes).digest("hex") !== match[1]!.toLowerCase())
      throw new Error("download does not match the release SHA256");
  } catch (error) {
    throw new Error("Checksum verification failed: " + errorMessage(error));
  }
  let stage: string | undefined;
  try {
    stage = await mkdtemp(join(dirname(target), ".die-update-"));
    const stagedBinary = join(stage, "die");
    const mode = (Number(original.mode) & 0o777) | 0o100;
    await writeFile(stagedBinary, bytes, { mode, flag: "wx" });
    await chmod(stagedBinary, mode);
    const now = await stat(target);
    if (
      now.dev !== original.dev ||
      now.ino !== original.ino ||
      now.size !== original.size ||
      now.mtimeMs !== original.mtimeMs ||
      now.ctimeMs !== original.ctimeMs
    )
      throw new Error("die executable changed during the update; run die update again");
    await rename(stagedBinary, target);
  } catch (error) {
    throw new Error(
      "Could not replace die at " + target + "; check installation-directory permissions: " + errorMessage(error),
    );
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true }).catch(() => undefined);
  }
  return { status: "updated", version: latest, path: target };
}
