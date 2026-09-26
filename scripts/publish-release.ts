import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export const assetNames = [
  "die-linux-x64",
  "die-linux-x64.sha256",
  "die-linux-arm64",
  "die-linux-arm64.sha256",
  "die-darwin-arm64",
  "die-darwin-arm64.sha256",
  "die-android-arm64",
  "die-android-arm64.sha256",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY_LICENSES.txt",
  "SOURCE.txt",
] as const;

type Asset = { name: string; size: number; digest: string | null };
type Release = { draft: boolean; assets: Asset[] };

/** Fail closed on extras, duplicates or different bytes; only absent draft assets are repairable. */
export function missingReleaseAssets(release: Release, expected: Map<string, Asset>): string[] {
  const seen = new Set<string>();
  for (const asset of release.assets) {
    const local = expected.get(asset.name);
    if (!local || seen.has(asset.name) || asset.size !== local.size || asset.digest !== local.digest)
      throw new Error("Release asset differs from verified build: " + asset.name);
    seen.add(asset.name);
  }
  const missing = [...expected.keys()].filter((name) => !seen.has(name));
  if (missing.length && !release.draft) throw new Error("Published release is incomplete; refusing to change it");
  return missing;
}

export function tagAction(remoteSha: string | undefined, expectedSha: string): "push" | "reuse" {
  if (!remoteSha) return "push";
  if (remoteSha !== expectedSha) throw new Error("Release tag points to a different commit");
  return "reuse";
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gh = (...args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: "inherit" });

// Draft releases can return 404 from /releases/tags even after gh release create succeeds.
// The authenticated releases list includes drafts for the workflow's write-capable token.
export async function findRelease(repo: string, tag: string, token: string): Promise<Release | undefined> {
  const base = "https://api.github.com/repos/" + repo + "/releases";
  const headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };
  const response = await fetch(base + "/tags/" + encodeURIComponent(tag), { headers });
  if (response.ok) return parseRelease(await response.json());
  if (response.status !== 404) throw new Error("GitHub release lookup failed: HTTP " + response.status);
  // Check all pages so a hidden draft cannot trigger a duplicate creation.
  for (let page = 1; ; page++) {
    const list = await fetch(base + "?per_page=100&page=" + page, { headers });
    if (!list.ok) throw new Error("GitHub release list failed: HTTP " + list.status);
    const entries: unknown = await list.json();
    if (!Array.isArray(entries)) throw new Error("Invalid release list response");
    const matches = entries.filter(
      (entry) => entry && typeof entry === "object" && "tag_name" in entry && entry.tag_name === tag,
    );
    if (matches.length > 1) throw new Error("Multiple releases for tag " + tag);
    if (matches.length) return parseRelease(matches[0]);
    if (entries.length < 100) return undefined;
  }
}

function parseRelease(data: unknown): Release {
  if (
    !data ||
    typeof data !== "object" ||
    !("draft" in data) ||
    !("assets" in data) ||
    typeof data.draft !== "boolean" ||
    !Array.isArray(data.assets)
  )
    throw new Error("Invalid release response");
  return data as Release;
}

async function main() {
  const {
    RELEASE_TAG: tag,
    RELEASE_SHA: sha,
    GH_TOKEN: token,
    GITHUB_REPOSITORY: repo,
    GITHUB_EVENT_NAME: event,
  } = process.env;
  if (
    !tag ||
    !sha ||
    !token ||
    !repo ||
    !event ||
    !/^v[0-9]+[.][0-9]+[.][0-9]+$/.test(tag) ||
    !/^[a-f0-9]{40}$/.test(sha)
  )
    throw new Error("Missing or invalid release environment");
  // ls-remote includes a peeled line for annotated tags; always compare the commit, not tag object.
  const refs = git("ls-remote", "--tags", "origin", "refs/tags/" + tag, "refs/tags/" + tag + "^{}");
  const lines = refs.split("\n").filter(Boolean);
  const peeled = lines.find((line) => line.endsWith("refs/tags/" + tag + "^{}"));
  const plain = lines.find((line) => line.endsWith("refs/tags/" + tag));
  const remote = (peeled ?? plain)?.split("	")[0];
  const action = tagAction(remote, sha);
  if (event === "workflow_dispatch") {
    git("fetch", "origin", "develop");
    if (git("rev-parse", "origin/develop") !== sha)
      throw new Error("develop advanced during verification; refusing stale publication");
    if (action === "push") git("push", "origin", sha + ":refs/tags/" + tag);
  } else if (action !== "reuse") {
    throw new Error("Push-triggered release requires the remote tag");
  }
  // Also cover a concurrent creation between lookup and push. No release API mutation before this check.
  const confirmed = git("ls-remote", "--tags", "origin", "refs/tags/" + tag, "refs/tags/" + tag + "^{}");
  const confirmedLines = confirmed.split("\n");
  const actual = (
    confirmedLines.find((line) => line.endsWith("refs/tags/" + tag + "^{}")) ??
    confirmedLines.find((line) => line.endsWith("refs/tags/" + tag))
  )?.split("	")[0];
  tagAction(actual, sha);
  if (!actual) throw new Error("Tag push did not create the remote tag");

  const expected = new Map<string, Asset>();
  for (const name of assetNames) {
    const bytes = await readFile(join("dist/release", name));
    expected.set(name, {
      name,
      size: bytes.length,
      digest: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const getRelease = () => findRelease(repo, tag, token);
  const notes = execFileSync("bun", ["scripts/select-release-notes.ts", tag], { encoding: "utf8" }).trim();
  let release = await getRelease();
  if (!release) {
    gh(
      "release",
      "create",
      tag,
      "--verify-tag",
      "--draft",
      "--generate-notes",
      "--notes-file",
      notes,
      "--title",
      tag,
      ...assetNames.map((name) => join("dist/release", name)),
    );
    release = await getRelease();
  }
  if (!release) throw new Error("Release was not created");
  const missing = missingReleaseAssets(release, expected);
  if (missing.length) {
    gh("release", "upload", tag, ...missing.map((name) => join("dist/release", name)));
    release = await getRelease();
    if (!release || missingReleaseAssets(release, expected).length) throw new Error("Release assets still incomplete");
  }
  if (release.draft) gh("release", "edit", tag, "--draft=false");
  const final = await getRelease();
  if (!final || final.draft || missingReleaseAssets(final, expected).length)
    throw new Error("Release publication not verified");
  console.log("Published " + tag + " from " + sha + " with verified release assets.");
}

if (import.meta.main) await main();
