import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { validateReleaseTag } from "./validate-release-tag";

/** Return only the notes for a tag validated against the package version. */
export async function selectReleaseNotes(tag: string, version: unknown, root: string): Promise<string> {
  const error = validateReleaseTag(tag, version);
  if (error) throw new Error(error);
  const path = resolve(root, "support", "release-v" + version + ".md");
  const file = await stat(path).catch(() => undefined);
  if (!file?.isFile() || file.size === 0) throw new Error("Missing or empty release notes: " + path);
  return path;
}

if (import.meta.main) {
  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
  if (!tag) throw new Error("usage: bun scripts/select-release-notes.ts <vVERSION>");
  const root = resolve(import.meta.dir, "..");
  const pkg = (await Bun.file(resolve(root, "package.json")).json()) as { version?: unknown };
  console.log(await selectReleaseNotes(tag, pkg.version, root));
}
