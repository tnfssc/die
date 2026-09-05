import { readdir, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const MAX_PACKAGES = 1000;
const MAX_BYTES = 4 * 1024 * 1024;
const PI_VERSION = "0.85.0";
const pinnedPiPackages = new Set([
  "@earendil-works/chord",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-client",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-protocol",
  "@earendil-works/pi-server",
  "@earendil-works/pi-telemetry",
  "@earendil-works/pi-tui",
]);
const fallbackNotices: Record<string, string> = {
  "@mariozechner/clipboard": "clipboard.LICENSE",
  "@mariozechner/clipboard-linux-x64-gnu": "clipboard.LICENSE",
  "@mariozechner/clipboard-linux-x64-musl": "clipboard.LICENSE",
  standardwebhooks: "standardwebhooks.LICENSE",
  "@aws-sdk/credential-provider-http": "aws-sdk-js-v3.LICENSE",
  "@aws-sdk/nested-clients": "aws-sdk-js-v3.LICENSE",
  "@aws-sdk/credential-provider-login": "aws-sdk-js-v3.LICENSE",
  "@esbuild/linux-x64": "esbuild.LICENSE",
  "data-uri-to-buffer": "data-uri-to-buffer.LICENSE",
};

type PackageInfo = {
  name: string;
  version: string;
  license?: unknown;
  repository?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
type Entry = { info: PackageInfo; directory: string; notices: Array<{ name: string; text: string }> };
type ByteBudget = { used: number; maximum: number };

async function readLicense(path: string, budget: ByteBudget): Promise<string> {
  const size = (await stat(path)).size;
  if (size > budget.maximum - budget.used) {
    throw new Error(`license input exceeds ${budget.maximum} byte budget before reading ${path}`);
  }
  const text = await Bun.file(path).text();
  const bytes = Buffer.byteLength(text);
  if (bytes > budget.maximum - budget.used) {
    throw new Error(`license input exceeds ${budget.maximum} byte budget while reading ${path}`);
  }
  budget.used += bytes;
  return text;
}

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

async function noticeFiles(directory: string, budget: ByteBudget): Promise<Array<{ name: string; text: string }>> {
  const names = (await readdir(directory))
    .filter((name) => /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i.test(name))
    .sort();
  const notices = [];
  for (const name of names) notices.push({ name, text: await readLicense(join(directory, name), budget) });
  return notices;
}

export async function generateThirdPartyNotices(
  root: string,
  output: string,
  maximumBytes = MAX_BYTES,
): Promise<number> {
  const rootPackage = (await Bun.file(join(root, "package.json")).json()) as { dependencies?: Record<string, string> };
  const budget = { used: 0, maximum: maximumBytes };
  const piLicense = await readLicense(join(root, "third_party/pi/LICENSE"), budget);
  const bunLicense = await readLicense(join(root, "third_party/bun/LICENSE.md"), budget);
  const entries = new Map<string, Entry>();
  const queue = Object.keys(rootPackage.dependencies ?? {})
    .sort()
    .map((name) => ({ name, from: root, required: true }));
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const directory = await packageDirectory(next.name, next.from);
    if (!directory) {
      if (next.required) throw new Error(`production dependency ${next.name} could not be resolved from ${next.from}`);
      continue;
    }
    const info = (await Bun.file(join(directory, "package.json")).json()) as PackageInfo;
    const key = `${info.name}@${info.version}`;
    if (entries.has(key)) continue;
    if (entries.size >= MAX_PACKAGES) throw new Error(`production dependency graph exceeds ${MAX_PACKAGES} packages`);
    const notices = await noticeFiles(directory, budget);
    const fallback = fallbackNotices[info.name];
    if (notices.length === 0 && fallback) {
      notices.push({
        name: `curated ${fallback}`,
        text: await readLicense(join(root, "third_party/npm", fallback), budget),
      });
    }
    const pinnedPiFallback = pinnedPiPackages.has(info.name) && info.version === PI_VERSION;
    if (notices.length === 0 && !pinnedPiFallback) {
      throw new Error(`${key} has no packaged or curated LICENSE, COPYING, or NOTICE file`);
    }
    entries.set(key, { info, directory, notices });
    for (const name of Object.keys(info.dependencies ?? {}).sort())
      queue.push({ name, from: directory, required: true });
    const optional = { ...info.optionalDependencies, ...info.peerDependencies };
    for (const name of Object.keys(optional).sort()) queue.push({ name, from: directory, required: false });
  }

  const lines = [
    "DIE THIRD-PARTY LICENSE AND COPYRIGHT NOTICES",
    "",
    "Generated from the installed production dependency graph. This bundle reproduces",
    "packaged LICENSE/COPYING/NOTICE files; it is attribution information, not legal advice.",
    "",
  ];
  for (const { info, notices } of [...entries.values()].sort((a, b) =>
    (a.info.name + "@" + a.info.version).localeCompare(b.info.name + "@" + b.info.version),
  )) {
    lines.push(
      "=".repeat(78),
      `${info.name}@${info.version}`,
      `Declared license: ${typeof info.license === "string" ? info.license : "unspecified"}`,
      "",
    );
    if (notices.length === 0) {
      lines.push(
        `This pinned ${info.name}@${PI_VERSION} package is covered by the Pi upstream license reproduced below.`,
        "",
      );
    } else {
      for (const notice of notices) lines.push(`--- ${notice.name} ---`, notice.text.trimEnd(), "");
    }
  }
  lines.push(
    "=".repeat(78),
    "PI UPSTREAM LICENSE (applies only to pinned Pi packages identified above)",
    "Source: https://github.com/earendil-works/pi/tree/v0.85.0",
    "",
    piLicense.trimEnd(),
    "",
  );
  lines.push(
    "=".repeat(78),
    "BUN RUNTIME UPSTREAM LICENSING",
    "The standalone executable contains the Bun 1.4.1 runtime. Bun's upstream",
    "license and linked-library notices are reproduced below.",
    "Source: https://github.com/oven-sh/bun/tree/bun-v1.4.1",
    "",
    bunLicense.trimEnd(),
    "",
  );
  const content = lines.join("\n");
  if (Buffer.byteLength(content) > maximumBytes) throw new Error(`notice bundle exceeds ${maximumBytes} bytes`);
  await Bun.write(output, content);
  console.log(`wrote ${output} with ${entries.size} production packages (${Buffer.byteLength(content)} bytes)`);
  return entries.size;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const output = process.argv[2] ? resolve(process.argv[2]) : join(root, "dist/release/THIRD_PARTY_LICENSES.txt");
  await generateThirdPartyNotices(root, output);
}
