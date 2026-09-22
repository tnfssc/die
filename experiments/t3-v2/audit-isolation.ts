/** Check protected shipped artifacts against this run's before-state. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "../..");
const baseline = await Bun.file(resolve(import.meta.dir, "protected-baseline.json")).json();
let failed = false;
for (const entry of baseline.files) {
  const file = Bun.file(resolve(root, entry.path));
  const hash = (await file.exists()) ? createHash("sha256").update(new Uint8Array(await file.arrayBuffer())).digest("hex") : "missing";
  const ok = hash === entry.sha256;
  console.log(`${ok ? "PASS" : "FAIL"} protected ${entry.path}`);
  failed ||= !ok;
}
if (failed) process.exitCode = 1;
