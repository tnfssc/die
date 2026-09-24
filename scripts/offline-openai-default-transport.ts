/** Run after bun run build (scripts/build.ts): source and the FULL compiled CLI.
 * Neither invocation uses a voice device or external provider.
 */
import { resolve } from "node:path";
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--source-only")) {
  throw new Error("Usage: bun scripts/offline-openai-default-transport.ts [--source-only]");
}
const bun = process.execPath;
const exe = resolve(import.meta.dir, "../dist/die");
const source = resolve(import.meta.dir, "../src/cli.ts");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/(?:API_KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD)/i.test(key)),
);
env.DIE_OFFLINE_OPENAI_TRANSPORT_PROBE = "loopback-fake-key";
for (const [label, command] of [
  ["SOURCE", [bun, source, "--offline-openai-transport-probe"]],
  ["FULL compiled CLI", [exe, "--offline-openai-transport-probe"]],
] as const) {
  if (process.argv[2] === "--source-only" && label !== "SOURCE") continue;
  const denied = Bun.spawnSync([...command], {
    env: { ...env, DIE_OFFLINE_OPENAI_TRANSPORT_PROBE: "" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15000,
  });
  if (denied.exitCode === 0 || !new TextDecoder().decode(denied.stderr).includes("explicit loopback test gate")) {
    throw new Error(label + " probe is not gated");
  }
  const child = Bun.spawnSync([...command], { env, stdout: "pipe", stderr: "pipe", timeout: 15000 });
  const output = new TextDecoder().decode(child.stdout);
  const error = new TextDecoder().decode(child.stderr);
  if (child.exitCode !== 0 || !output.includes("full/mini session.updated and HTTP 401 passed")) {
    throw new Error(label + " offline probe failed (exit " + child.exitCode + "): " + error + output);
  }
  console.log(label + ": " + output.trim());
}
