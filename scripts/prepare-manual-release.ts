import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function nextReleaseVersion(version: string, latestTag?: string): string {
  const valid = /^v?(\d+)\.(\d+)\.(\d+)$/;
  const current = valid.exec(version);
  if (!current || version.startsWith("v")) throw new Error("package version must be stable semver");
  const last = latestTag ? valid.exec(latestTag) : undefined;
  if (latestTag && (!last || !latestTag.startsWith("v"))) throw new Error("invalid latest stable tag");
  const compare = (a: RegExpExecArray, b: RegExpExecArray) => {
    for (let i = 1; i <= 3; i++) {
      const difference = Number(a[i]) - Number(b[i]);
      if (difference) return difference;
    }
    return 0;
  };
  const base = last && compare(last, current) > 0 ? last : current;
  if (last && compare(current, last) > 0) return version; // Already prepared on develop.
  return [base[1], base[2], Number(base[3]) + 1].join(".");
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const pkgPath = resolve(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  const tags = git("tag", "-l", "v*")
    .split("\n")
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  tags.sort((a, b) => {
    const left = a.slice(1).split(".").map(Number);
    const right = b.slice(1).split(".").map(Number);
    for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return right[i] - left[i];
    return 0;
  });
  const latest = tags[0];
  const version = nextReleaseVersion(pkg.version, latest);
  const tag = "v" + version;
  if (tags.includes(tag)) throw new Error("release tag already exists: " + tag);
  const notesPath = resolve(root, "support", "release-" + tag + ".md");
  const range = latest ? latest + "..HEAD" : "HEAD";
  const subjects = git("log", "--format=%s", range).split("\n").filter(Boolean);
  if (!subjects.length) throw new Error("no changes since last release; refusing empty release");
  if (!existsSync(notesPath)) {
    const notes = subjects
      .filter((subject) => !/^Prepare v\d+\.\d+\.\d+ release$/.test(subject))
      .map((subject) => "- " + subject.replace(/[\r\n]/g, " "))
      .join("\n");
    if (!notes) throw new Error("no release changes to document");
    writeFileSync(notesPath, "# " + tag + "\n\n" + notes + "\n");
  }
  if (statSync(notesPath).size === 0) throw new Error("release notes are empty: " + notesPath);
  if (version !== pkg.version) {
    const original = readFileSync(pkgPath, "utf8");
    const updated = original.replace('"version": "' + pkg.version + '"', '"version": "' + version + '"');
    if (original === updated) throw new Error("could not update package version");
    writeFileSync(pkgPath, updated);
  }
  process.stdout.write(tag);
}
