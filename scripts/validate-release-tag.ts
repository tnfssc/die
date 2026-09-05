export function validateReleaseTag(tag: string, version: unknown): string | undefined {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    return "package.json contains an unsupported version";
  }
  const expected = "v" + version;
  if (tag !== expected)
    return "release tag " + JSON.stringify(tag) + " does not match package.json version; expected " + expected;
}

if (import.meta.main) {
  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
  if (!tag) {
    console.error("usage: bun scripts/validate-release-tag.ts <vVERSION>");
    process.exit(2);
  }
  const pkg = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as { version?: unknown };
  const error = validateReleaseTag(tag, pkg.version);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log("validated release " + tag);
}
