/** Device-free local release gate: compile exact v0.7.1 updater, update a private
 * executable using staged release bytes, then run the replacement --version.
 * Never contacts GitHub or replaces the user's installed die. Run on target host.
 */
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { updateAssetFor } from "../src/update";

const [input, version] = process.argv.slice(2);
if (!input || !version || !/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Usage: bun scripts/verify-v071-update.ts <staged-raw-asset> <version>");
const asset = updateAssetFor(process.platform, process.arch);
if (!asset || basename(input) !== asset) throw new Error("Use the raw asset for this host: " + asset);
const bytes = await readFile(resolve(input));
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const expected = hash(bytes);
const checksum = (await readFile(resolve(input) + ".sha256", "utf8")).trim();
if (checksum !== expected + "  " + asset) throw new Error("Staged release checksum mismatch");
const git = (path: string) => {
  const result = spawnSync("git", ["show", "v0.7.1:" + path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
  return result.stdout;
};
const source = git("src/update.ts");
if (hash(source) !== "589cf75c8bf9dc20f537128ca10ae84b90b7b7a03e9c4f0014578d61e4d4a259")
  throw new Error("Unexpected v0.7.1 updater source");
const directory = await mkdtemp(join(tmpdir(), "die-old-update-gate-"));
try {
  await mkdir(join(directory, "src"));
  await writeFile(join(directory, "src/update.ts"), source);
  await writeFile(join(directory, "package.json"), git("package.json"));
  await writeFile(join(directory, "candidate"), bytes);
  const root = "https://github.com/tnfssc/die/releases/download/v" + version + "/";
  await writeFile(
    join(directory, "runner.ts"),
    'import { updateDie } from "./src/update";\n' +
      "const root = " +
      JSON.stringify(root) +
      ";\n" +
      "const asset = " +
      JSON.stringify(asset) +
      ";\n" +
      "const bytes = await Bun.file(" +
      JSON.stringify(join(directory, "candidate")) +
      ").arrayBuffer();\n" +
      "const result = await updateDie({ fetch: async (input) => {\n" +
      "const url = String(input);\n" +
      'if (url === "https://api.github.com/repos/tnfssc/die/releases/latest") return Response.json({tag_name: ' +
      JSON.stringify("v" + version) +
      ', prerelease:false, draft:false, assets:[asset,asset+".sha256"].map(name=>({name,browser_download_url:root+name}))});\n' +
      "if (url === root+asset) return new Response(bytes);\n" +
      'if (url === root+asset+".sha256") return new Response((process.argv.includes("--corrupt") ? "0".repeat(64) : ' +
      JSON.stringify(expected) +
      ') + "  " + asset);\n' +
      'throw new Error("Unexpected request: " + url); }}); console.log(JSON.stringify(result));\n',
  );
  const executable = join(directory, "die");
  const build = await Bun.build({ entrypoints: [join(directory, "runner.ts")], compile: { outfile: executable } });
  if (!build.success) throw new Error("Could not compile exact old updater: " + build.logs.join("\n"));
  const original = hash(await readFile(executable));
  const failed = spawnSync(executable, ["--corrupt"], { encoding: "utf8" });
  if (
    failed.status === 0 ||
    !failed.stderr.includes("Checksum verification failed") ||
    hash(await readFile(executable)) !== original
  )
    throw new Error("Old compiled updater failed rollback gate");
  const updated = spawnSync(executable, [], { encoding: "utf8" });
  if (updated.status !== 0 || hash(await readFile(executable)) !== expected)
    throw new Error("Old compiled updater failed replacement: " + updated.stderr);
  const home = join(directory, "home");
  await mkdir(home);
  const actual = spawnSync(executable, ["--version"], { encoding: "utf8", env: { HOME: home, PATH: "/usr/bin:/bin" } });
  if (actual.status !== 0 || actual.stdout.trim() !== version)
    throw new Error("Replacement version mismatch: " + actual.stdout + actual.stderr);
  console.log(
    "Exact compiled v0.7.1 updater: checksum failure preserved executable; replacement SHA256 and --version " +
      version +
      " passed (" +
      asset +
      ")",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
