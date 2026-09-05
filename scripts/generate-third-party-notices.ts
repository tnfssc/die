import { readdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const output = process.argv[2] ? resolve(process.argv[2]) : join(root, "dist/release/THIRD_PARTY_LICENSES.txt");
const rootPackage = await Bun.file(join(root, "package.json")).json() as { dependencies?: Record<string, string> };
const piLicense = await Bun.file(join(root, "third_party/pi/LICENSE")).text();
const bunLicense = await Bun.file(join(root, "third_party/bun/LICENSE.md")).text();
const MAX_PACKAGES = 1000;
const MAX_BYTES = 4 * 1024 * 1024;
const fallbackNotices: Record<string, string> = {
  "@mariozechner/clipboard": "clipboard.LICENSE",
  "@mariozechner/clipboard-linux-x64-gnu": "clipboard.LICENSE",
  "@mariozechner/clipboard-linux-x64-musl": "clipboard.LICENSE",
  "standardwebhooks": "standardwebhooks.LICENSE",
  "@aws-sdk/credential-provider-http": "aws-sdk-js-v3.LICENSE",
  "@aws-sdk/nested-clients": "aws-sdk-js-v3.LICENSE",
  "@aws-sdk/credential-provider-login": "aws-sdk-js-v3.LICENSE",
  "@esbuild/linux-x64": "esbuild.LICENSE",
  "data-uri-to-buffer": "data-uri-to-buffer.LICENSE",
};

type PackageInfo = { name: string; version: string; license?: unknown; repository?: unknown; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
type Entry = { info: PackageInfo; directory: string; notices: Array<{ name: string; text: string }> };

async function packageDirectory(name: string, from: string): Promise<string | undefined> {
  let directory = from;
  while (true) {
    const candidate = join(directory, "node_modules", name);
    if (await Bun.file(join(candidate, "package.json")).exists()) return realpath(candidate);
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

async function noticeFiles(directory: string): Promise<Array<{ name: string; text: string }>> {
  const names = (await readdir(directory)).filter((name) => /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i.test(name)).sort();
  return Promise.all(names.map(async (name) => ({ name, text: await Bun.file(join(directory, name)).text() })));
}

const entries = new Map<string, Entry>();
const queue = Object.keys(rootPackage.dependencies ?? {}).sort().map((name) => ({ name, from: root }));
while (queue.length > 0) {
  const next = queue.shift()!;
  const directory = await packageDirectory(next.name, next.from);
  if (!directory) throw new Error(`production dependency ${next.name} could not be resolved from ${next.from}`);
  const info = await Bun.file(join(directory, "package.json")).json() as PackageInfo;
  const key = `${info.name}@${info.version}`;
  if (entries.has(key)) continue;
  if (entries.size >= MAX_PACKAGES) throw new Error(`production dependency graph exceeds ${MAX_PACKAGES} packages`);
  const notices = await noticeFiles(directory);
  const fallback = fallbackNotices[info.name];
  if (notices.length === 0 && fallback) {
    notices.push({ name: `curated ${fallback}`, text: await Bun.file(join(root, "third_party/npm", fallback)).text() });
  }
  if (notices.length === 0 && !info.name.startsWith("@earendil-works/")) {
    throw new Error(`${key} has no packaged or curated LICENSE, COPYING, or NOTICE file`);
  }
  entries.set(key, { info, directory, notices });
  const dependencies = { ...info.dependencies, ...info.optionalDependencies, ...info.peerDependencies };
  for (const name of Object.keys(dependencies).sort()) {
    if (await packageDirectory(name, directory)) queue.push({ name, from: directory });
  }
}

const lines = [
  "DIE THIRD-PARTY LICENSE AND COPYRIGHT NOTICES",
  "",
  "Generated from the installed production dependency graph. This bundle reproduces",
  "packaged LICENSE/COPYING/NOTICE files; it is attribution information, not legal advice.",
  "",
];
for (const { info, notices } of [...entries.values()].sort((a, b) => (a.info.name + "@" + a.info.version).localeCompare(b.info.name + "@" + b.info.version))) {
  lines.push("=".repeat(78), `${info.name}@${info.version}`, `Declared license: ${typeof info.license === "string" ? info.license : "unspecified"}`, "");
  if (notices.length === 0) {
    lines.push("This @earendil-works/pi package is covered by the pinned Pi upstream license reproduced below.", "");
  } else {
    for (const notice of notices) lines.push(`--- ${notice.name} ---`, notice.text.trimEnd(), "");
  }
}
lines.push("=".repeat(78), "PI UPSTREAM LICENSE (applies to @earendil-works/pi packages)", "Source: https://github.com/earendil-works/pi/tree/v0.85.0", "", piLicense.trimEnd(), "");
lines.push("=".repeat(78), "BUN RUNTIME UPSTREAM LICENSING", "The standalone executable contains the Bun 1.4.1 runtime. Bun's upstream", "license and linked-library notices are reproduced below.", "Source: https://github.com/oven-sh/bun/tree/bun-v1.4.1", "", bunLicense.trimEnd(), "");
const content = lines.join("\n");
if (Buffer.byteLength(content) > MAX_BYTES) throw new Error(`notice bundle exceeds ${MAX_BYTES} bytes`);
await Bun.write(output, content);
console.log(`wrote ${output} with ${entries.size} production packages (${Buffer.byteLength(content)} bytes)`);
