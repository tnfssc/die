const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tag) {
  console.error("usage: bun scripts/validate-release-tag.ts <vVERSION>");
  process.exit(2);
}

const pkg = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as { version?: unknown };
if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
  console.error("package.json contains an unsupported version");
  process.exit(1);
}
const expected = "v" + pkg.version;
if (tag !== expected) {
  console.error("release tag " + JSON.stringify(tag) + " does not match package.json version; expected " + expected);
  process.exit(1);
}
console.log("validated release " + tag);
